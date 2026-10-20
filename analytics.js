(function attachAnalytics(root) {
  function getLastDigit(quote, pipSize) {
    const decimals = Number.isInteger(pipSize) ? Math.max(0, Math.min(pipSize, 8)) : 2;
    const normalized = Number(quote).toFixed(decimals);
    const digits = normalized.replace(/\D/g, "");
    return Number(digits.at(-1));
  }

  function analyzeTicks(ticks, pipSize = 2, threshold = 5) {
    const digits = ticks
      .map((tick) => getLastDigit(tick.quote, tick.pip_size ?? pipSize))
      .filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const counts = Array(10).fill(0);
    for (const digit of digits) counts[digit] += 1;
    const total = digits.length;
    const sorted = counts
      .map((count, digit) => ({ digit, count }))
      .sort((left, right) => right.count - left.count || left.digit - right.digit);
    const over = digits.filter((digit) => digit > threshold).length;
    const last = digits.slice(-30);
    return {
      digits,
      counts,
      percentages: counts.map((count) => (total ? (count / total) * 100 : 0)),
      total,
      highest: sorted[0] || null,
      lowest: sorted.at(-1) || null,
      even: digits.filter((digit) => digit % 2 === 0).length,
      odd: digits.filter((digit) => digit % 2 === 1).length,
      over,
      under: total - over,
      last,
      currentDigit: digits.at(-1) ?? null,
      prices: ticks.slice(-120).map((tick) => Number(tick.quote)).filter(Number.isFinite),
      pipSize,
    };
  }

  function calculateRiskPlan({ balance, riskPercent, martingale, lossCount, takeProfitPercent }) {
    if (
      ![balance, riskPercent, martingale, lossCount, takeProfitPercent].every(Number.isFinite) ||
      balance <= 0 ||
      riskPercent <= 0 ||
      riskPercent > 100 ||
      !Number.isInteger(lossCount) ||
      lossCount < 1 ||
      lossCount > 10 ||
      martingale < 1 ||
      martingale > 2 ||
      takeProfitPercent <= 0 ||
      takeProfitPercent > 100
    ) {
      throw new RangeError("Risk planner inputs are outside the supported range.");
    }
    const stopLoss = balance * (riskPercent / 100);
    const takeProfit = stopLoss * (takeProfitPercent / 100);
    const factor = martingale;
    const stake =
      Math.abs(factor - 1) < 1e-9
        ? stopLoss / lossCount
        : (stopLoss * (factor - 1)) / (Math.pow(factor, lossCount) - 1);
    if (!Number.isFinite(stake) || stake < 0.01) {
      throw new RangeError("The loss limit is too small for a one-cent minimum stake.");
    }
    let cumulative = 0;
    const stakes = Array.from({ length: lossCount }, (_, index) => {
      const amount = Math.floor(stake * Math.pow(factor, index) * 100 + 1e-9) / 100;
      cumulative = Math.round((cumulative + amount) * 100) / 100;
      return { loss: index + 1, stake: amount, cumulative };
    });
    return {
      startingStake: stakes[0]?.stake ?? 0,
      stopLoss: Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      stakes,
    };
  }

  function replayDirection(ticks) {
    const prices = ticks.map((tick) => Number(tick.quote)).filter(Number.isFinite);
    let wins = 0;
    let losses = 0;
    for (let index = 1; index < prices.length - 1; index += 1) {
      const signal = Math.sign(prices[index] - prices[index - 1]);
      const nextMove = Math.sign(prices[index + 1] - prices[index]);
      if (signal === 0 || nextMove === 0) continue;
      if (signal === nextMove) wins += 1;
      else losses += 1;
    }
    const total = wins + losses;
    return { wins, losses, total, winRate: total ? (wins / total) * 100 : 0 };
  }

  const api = { analyzeTicks, calculateRiskPlan, replayDirection };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VortextrederAnalytics = api;
})(typeof window !== "undefined" ? window : null);
