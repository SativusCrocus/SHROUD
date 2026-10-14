import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumOutput, validatePriceRound } from '../relayer/pricing.mjs';

test('quote scales 6-decimal asset, 18-decimal token and unequal USD-feed decimals', () => {
  const quote = minimumOutput({ amount: 1_000_000n, inputDecimals: 6n, outputDecimals: 18n,
    inputPrice: { answer: 100_000_000n, decimals: 8n },
    outputPrice: { answer: 2_000_000_000_000_000_000n, decimals: 18n }, slippageBps: 50n });
  assert.equal(quote, 497_500_000_000_000_000n);
});

test('invalid, future, missing, stale or nonpositive oracle data cannot authorize a quote', () => {
  assert.deepEqual(validatePriceRound([2n, 100n, 90n, 99n, 2n], 8n, 100n, 10n), { answer: 100n, decimals: 8n });
  for (const round of [[2n, 100n, 1n, 89n, 2n], [2n, 100n, 1n, 101n, 2n],
    [2n, 100n, 1n, 0n, 2n], [2n, 0n, 1n, 99n, 2n], [2n, -1n, 1n, 99n, 2n], [2n, 100n, 1n, 99n, 1n]]) {
    assert.throws(() => validatePriceRound(round, 8n, 100n, 10n));
  }
});

test('quote rejects excessive slippage and amounts that round to zero', () => {
  const args = { amount: 1n, inputDecimals: 18n, outputDecimals: 6n,
    inputPrice: { answer: 1n, decimals: 8n }, outputPrice: { answer: 1n, decimals: 8n }, slippageBps: 0n };
  assert.throws(() => minimumOutput(args), /rounds to zero/);
  assert.throws(() => minimumOutput({ ...args, slippageBps: 301n }), /bounds/);
});
