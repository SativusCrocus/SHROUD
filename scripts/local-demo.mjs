import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, parseEther, ZeroAddress } from 'ethers';
import { poseidonContract } from 'circomlibjs';
import { groth16, wtns } from 'snarkjs';
import { createNote, noteHashes, createCoverRoutes, proveWithdrawal, merkleWitness } from '../client/notes.mjs';
import { relayWithdrawal } from '../relayer/submit.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile('build/circuit/manifest.json'));
assert.equal(manifest.mode, 'local-development-only');
for (const [file, expected] of Object.entries(manifest.hashes)) {
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), expected, `artifact mismatch: ${file}`);
}
// Bind a fresh loopback port, then launch an isolated ephemeral local chain.
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--accounts', '0', '--silent'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError;
anvil.on('error', error => { launchError = error; });
const stderr = [];
anvil.stderr.on('data', chunk => stderr.push(chunk.toString()));
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true, cacheTimeout: -1 });
provider.pollingInterval = 50;
const onSignal = () => { anvil.kill('SIGTERM'); process.exitCode = 1; };
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
const checks = [];
const checked = label => { checks.push(label); console.log(`PASS ${label}`); };

try {
  let ready = false;
  for (let i = 0; i < 100; ++i) {
    if (launchError || anvil.exitCode !== null) throw launchError ?? new Error(stderr.join(''));
    try { await provider.send('eth_chainId', []); ready = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Anvil startup timed out');
  assert.equal(await provider.send('eth_chainId', []), '0x7a69');
  const wallet = Wallet.createRandom().connect(provider);
  await provider.send('anvil_setBalance', [wallet.address, '0x3635c9adc5dea00000']);
  const signer = new NonceManager(wallet);
  const artifact = async (file, name) => JSON.parse(await readFile(`out/${file}/${name}.json`));
  const deploy = async (file, name, args = []) => {
    const data = await artifact(file, name);
    const contract = await new ContractFactory(data.abi, data.bytecode.object, signer).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const hasher = await new ContractFactory(poseidonContract.generateABI(2), poseidonContract.createCode(2), signer).deploy();
  await hasher.waitForDeployment();
  const verifier = await deploy('WithdrawalVerifier.sol', 'Groth16Verifier');
  const asset = await deploy('Mocks.sol', 'MockAsset');
  const lending = await deploy('Mocks.sol', 'MockAave', [asset.target]);
  const router = await deploy('Mocks.sol', 'MockRouter');
  const shroud = await deploy('ShroudToken.sol', 'ShroudToken', [wallet.address, parseEther('1000000')]);
  const treasury = await deploy('BuybackTreasury.sol', 'BuybackTreasury', [asset.target, shroud.target, router.target, 3000, wallet.address]);
  const pool = await deploy('CipherShroudPool.sol', 'CipherShroudPool', [asset.target, parseEther('100'), hasher.target,
    verifier.target, lending.target, await lending.aToken(), treasury.target, 2000]);
  const vault = new Contract(await pool.vault(), (await artifact('PrincipalVault.sol', 'PrincipalVault')).abi, signer);
  await (await asset.mint(wallet.address, parseEther('300'))).wait();
  await (await asset.approve(vault.target, parseEther('300'))).wait();
  await (await shroud.transfer(router.target, parseEther('10000'))).wait();
  const notes = [], commitments = [];
  for (let i = 0; i < 3; ++i) {
    const note = createNote(31337, pool.target);
    const { commitment } = noteHashes(note);
    const receipt = await (await pool.deposit(commitment, createCoverRoutes())).wait();
    const covers = receipt.logs.map(log => { try { return pool.interface.parseLog(log); } catch { return null; } })
      .filter(log => log?.name === 'CoverTraffic');
    assert.ok(covers.length >= 2 && covers.length <= 3);
    notes.push(note); commitments.push(commitment);
    assert.equal(await pool.latestRoot(), BigInt(merkleWitness(commitments, i).root));
  }
  checked('three deposits: real Poseidon roots match client tree; padding count is bounded');
  await (await vault.investIdle()).wait();
  assert.equal(await vault.principal(), parseEther('300'));
  assert.equal(await asset.balanceOf(vault.target), parseEther('60'));
  await (await lending.addYield(vault.target, parseEther('10'))).wait();
  await (await vault.harvest(parseEther('10'))).wait();
  const initialSupply = await shroud.totalSupply();
  const timestamp = (await provider.getBlock('latest')).timestamp;
  await (await treasury.buyback(parseEther('10'), parseEther('20'), timestamp + 120)).wait();
  assert.equal(await shroud.totalSupply(), initialSupply - parseEther('20'));
  assert.equal(await vault.totalAssets(), parseEther('300'));
  checked('mock lending yield harvested and SHROUD burned with principal fully backed');

  const recipient = Wallet.createRandom().address;
  console.log('Generating an actual Groth16 proof locally...');
  const { proof, publicSignals, withdrawal } = await proveWithdrawal({ note: notes[1], commitments, leafIndex: 1,
    recipient, relayer: wallet.address, fee: 0n, wasm: 'build/circuit/withdraw_js/withdraw.wasm', zkey: 'build/circuit/withdraw.zkey' });
  const vk = JSON.parse(await readFile('build/circuit/verification_key.json'));
  assert.equal(await groth16.verify(vk, publicSignals, proof), true);
  checked('real client Groth16 proof verifies against generated verification key');
  const note = notes[1];
  const input = { ...merkleWitness(commitments, 1), nullifierHash: String(noteHashes(note).nullifierHash),
    recipient: String(BigInt(recipient)), relayer: String(BigInt(wallet.address)), fee: '0', chainId: note.chainId,
    pool: String(BigInt(note.pool)), nullifier: note.nullifier, secret: note.secret };
  for (const altered of [
    { ...input, secret: String(BigInt(input.secret) + 1n) },
    { ...input, siblings: input.siblings.map((v, i) => i === 0 ? String(BigInt(v) + 1n) : v) },
    { ...input, pathIndices: input.pathIndices.map((v, i) => i === 0 ? 2 : v) },
    { ...input, recipient: String(2n ** 160n) },
  ]) {
    await assert.rejects(wtns.calculate(altered, 'build/circuit/withdraw_js/withdraw.wasm', { type: 'mem' }));
  }
  checked('circuit rejects a wrong note secret, bad path, nonbinary path index, and oversized recipient');
  for (let i = 0; i < 7; ++i) {
    const modified = [...publicSignals]; modified[i] = String(BigInt(modified[i]) + 1n);
    assert.equal(await verifier.verifyProof(withdrawal.a, withdrawal.b, withdrawal.c, modified), false, `unbound signal ${i}`);
  }
  checked('on-chain verifier rejects tampering with each of the seven public inputs');
  const cover = createCoverRoutes();
  await assert.rejects(pool.withdraw.staticCall({ ...withdrawal, recipient: wallet.address }, cover));
  await assert.rejects(pool.withdraw.staticCall({ ...withdrawal, fee: 1n }, cover));
  await assert.rejects(pool.withdraw.staticCall({ ...withdrawal, relayer: ZeroAddress }, cover));
  checked('pool rejects recipient, fee, and relayer substitution');
  await (await lending.setIlliquid(true)).wait();
  // Send a reverting transaction to exercise state rollback, not merely eth_call.
  await assert.rejects(async () => {
    const tx = await pool.withdraw(withdrawal, cover, { gasLimit: 2_000_000 });
    await tx.wait();
  });
  assert.equal(await pool.spent(withdrawal.nullifierHash), false);
  assert.equal(await vault.principal(), parseEther('300'));
  await (await lending.setIlliquid(false)).wait();
  await relayWithdrawal(pool, withdrawal);
  assert.equal(await asset.balanceOf(recipient), parseEther('100'));
  assert.equal(await vault.principal(), parseEther('200'));
  checked('illiquidity rolls back the nullifier; the same proof succeeds when liquidity returns');
  await assert.rejects(pool.withdraw.staticCall(withdrawal, createCoverRoutes()));
  checked('double spend rejected after successful withdrawal');

  await mkdir('build', { recursive: true });
  await writeFile('build/demo-results.json', JSON.stringify({ scope: 'ephemeral-local-chain', chainId: 31337,
    lending: 'mock', router: 'mock', proofSystem: 'real Groth16, development setup',
    checks, principalRemaining: String(await vault.principal()),
    circuitManifest: manifest }, null, 2) + '\n');
  console.log('Local demo passed. Results: build/demo-results.json. Ephemeral chain will stop.');
} finally {
  // snarkjs 0.7.6 retains its ffjavascript worker pool on this global cache.
  // Close it only at process shutdown, after all proofs and verifications finish.
  await globalThis.curve_bn128?.terminate();
  provider.destroy();
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  if (anvil.exitCode === null) {
    anvil.kill('SIGTERM');
    await Promise.race([once(anvil, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (anvil.exitCode === null) anvil.kill('SIGKILL');
  }
}
