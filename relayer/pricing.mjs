export function validatePriceRound(round, decimals, now, maxAge) {
  const [roundId, answer, , updatedAt, answeredInRound] = round.map(BigInt);
  decimals = BigInt(decimals); now = BigInt(now); maxAge = BigInt(maxAge);
  if (decimals < 0n || decimals > 36n || maxAge <= 0n || answer <= 0n || updatedAt <= 0n
    || updatedAt > now || now - updatedAt > maxAge || answeredInRound < roundId) {
    throw new Error('Oracle unavailable, stale, or invalid');
  }
  return { answer, decimals };
}

export function minimumOutput({ amount, inputDecimals, outputDecimals, inputPrice, outputPrice, slippageBps }) {
  for (const value of [amount, inputDecimals, outputDecimals, inputPrice.answer, inputPrice.decimals,
    outputPrice.answer, outputPrice.decimals, slippageBps]) {
    if (typeof value !== 'bigint' || value < 0n) throw new Error('Expected nonnegative bigint');
  }
  if (amount === 0n || inputPrice.answer === 0n || outputPrice.answer === 0n || slippageBps > 300n
    || [inputDecimals, outputDecimals, inputPrice.decimals, outputPrice.decimals].some(n => n > 36n)) {
    throw new Error('Invalid quote bounds');
  }
  const numerator = amount * inputPrice.answer * (10n ** outputDecimals) * (10n ** outputPrice.decimals);
  const denominator = outputPrice.answer * (10n ** inputDecimals) * (10n ** inputPrice.decimals);
  const minOut = numerator * (10000n - slippageBps) / (denominator * 10000n);
  if (minOut === 0n) throw new Error('Trade rounds to zero');
  return minOut;
}
