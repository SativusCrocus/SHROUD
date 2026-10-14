import { Contract, JsonRpcProvider, Wallet, NonceManager, isAddress } from 'ethers';
import { validatePriceRound, minimumOutput } from '../relayer/pricing.mjs';

function required(name) {
  const value = process.env[name];
  if (!value || /PLACEHOLDER|YOUR_NEW/.test(value)) throw new Error(`Set ${name}`);
  return value;
}
function address(name) {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`Invalid ${name}`);
  return value;
}
const provider = new JsonRpcProvider(required('EVM_RPC_URL'));
const signer = new NonceManager(new Wallet(required('KEEPER_PRIVATE_KEY'), provider));
const expectedChain = BigInt(required('EXPECTED_CHAIN_ID'));
const maxBuyback = BigInt(required('MAX_BUYBACK_BASE_UNITS'));
const maxAge = BigInt(process.env.MAX_ORACLE_AGE_SECONDS ?? '3600');
const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
const interval = Number(process.env.KEEPER_INTERVAL_SECONDS ?? '60');
if (maxBuyback <= 0n || maxAge <= 0n || maxAge > 86400n || slippageBps < 0n || slippageBps > 300n
  || !Number.isSafeInteger(interval) || interval < 10) throw new Error('Invalid keeper bounds');
const vault = new Contract(address('VAULT_ADDRESS'), [
  'function investIdle() returns (uint256)', 'function harvest(uint256) returns (uint256)',
  'function treasury() view returns (address)', 'function asset() view returns (address)',
], signer);
const treasury = new Contract(address('TREASURY_ADDRESS'), [
  'function buyback(uint256,uint256,uint256) returns (uint256)', 'function keeper() view returns (address)',
  'function asset() view returns (address)', 'function shroud() view returns (address)',
], signer);
const feedABI = ['function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'];
const assetFeed = new Contract(address('ASSET_USD_FEED'), feedABI, provider);
const shroudFeed = new Contract(address('SHROUD_USD_FEED'), feedABI, provider);
const tokenABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
let stopping = false;
let wake;
const stop = () => { stopping = true; wake?.(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);

async function price(feed, now) {
  return validatePriceRound(await feed.latestRoundData(), await feed.decimals(), now, maxAge);
}

try {
  if ((await provider.getNetwork()).chainId !== expectedChain) throw new Error('Chain mismatch');
  if ((await vault.treasury()).toLowerCase() !== treasury.target.toLowerCase()) throw new Error('Treasury mismatch');
  if ((await treasury.keeper()).toLowerCase() !== (await signer.getAddress()).toLowerCase()) throw new Error('Unauthorized keeper');
  const assetAddress = await treasury.asset();
  if ((await vault.asset()).toLowerCase() !== assetAddress.toLowerCase()) throw new Error('Asset mismatch');
  const asset = new Contract(assetAddress, tokenABI, provider);
  const shroud = new Contract(await treasury.shroud(), tokenABI, provider);
  const assetDecimals = BigInt(await asset.decimals()), shroudDecimals = BigInt(await shroud.decimals());
  if (assetDecimals > 36n || shroudDecimals > 36n) throw new Error('Unsupported token decimals');
  while (!stopping) {
    for (const [name, action] of [['invest', () => vault.investIdle()], ['harvest', () => vault.harvest(maxBuyback)]]) {
      try { await (await action()).wait(); console.log(`${name}: confirmed`); }
      catch { signer.reset(); console.error(`${name}: failed; will retry next cycle`); }
    }
    try {
      const balance = await asset.balanceOf(treasury.target);
      const amount = balance < maxBuyback ? balance : maxBuyback;
      if (amount > 0n) {
        const now = BigInt((await provider.getBlock('latest')).timestamp);
        const inPrice = await price(assetFeed, now), outPrice = await price(shroudFeed, now);
        const minOut = minimumOutput({ amount, inputDecimals: assetDecimals, outputDecimals: shroudDecimals,
          inputPrice: inPrice, outputPrice: outPrice, slippageBps });
        await (await treasury.buyback(amount, minOut, now + 120n)).wait();
        console.log('buyback: confirmed');
      }
    } catch { signer.reset(); console.error('buyback: failed or quote invalid; will retry next cycle'); }
    if (!stopping) await new Promise(resolve => {
      const timer = setTimeout(() => { wake = undefined; resolve(); }, interval * 1000);
      wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
    });
  }
} finally {
  provider.destroy();
}
