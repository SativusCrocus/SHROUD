import { createCoverRoutes } from '../client/notes.mjs';

// The relayer receives public withdrawal data and a proof, never the secret note or Merkle witness.
// Replaying this payload cannot change its proof-bound recipient or relayer fee recipient.
export async function relayWithdrawal(pool, withdrawal) {
  const routes = createCoverRoutes();
  await pool.withdraw.staticCall(withdrawal, routes);
  return (await pool.withdraw(withdrawal, routes)).wait();
}

// Each maintenance action has its own transaction; failure cannot roll back a user withdrawal.
// A scheduler must call this function. Smart contracts do not wake themselves up.
export async function maintainYield(vault, treasury, { maxHarvest, quoteBuyback }) {
  const results = [];
  for (const [name, action] of [
    ['invest', () => vault.investIdle()],
    ['harvest', () => vault.harvest(maxHarvest)],
    ['buyback', async () => {
      const { amount, minOut, deadline } = await quoteBuyback();
      return treasury.buyback(amount, minOut, deadline);
    }],
  ]) {
    try { results.push({ name, receipt: await (await action()).wait() }); }
    catch (error) { results.push({ name, error: error.shortMessage ?? error.message }); }
  }
  return results;
}
