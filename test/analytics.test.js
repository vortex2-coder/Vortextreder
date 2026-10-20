const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeTicks, calculateRiskPlan, replayDirection } = require("../analytics");

test("analyzes digit frequencies and parity from displayed quote precision", () => {
  const result = analyzeTicks(
    [
      { quote: 1.23, pip_size: 2 },
      { quote: 1.24, pip_size: 2 },
      { quote: 1.29, pip_size: 2 },
      { quote: 1.20, pip_size: 2 },
    ],
    2,
    5,
  );

  assert.equal(result.total, 4);
  assert.equal(result.currentDigit, 0);
  assert.equal(result.counts[3], 1);
  assert.equal(result.counts[4], 1);
  assert.equal(result.even, 2);
  assert.equal(result.odd, 2);
  assert.equal(result.over, 1);
  assert.equal(result.under, 3);
  assert.equal(result.percentages.reduce((sum, value) => sum + value, 0), 100);
});

test("calculates a fixed-stake risk ladder that stays within the loss limit", () => {
  const plan = calculateRiskPlan({
    balance: 100,
    riskPercent: 5,
    martingale: 1,
    lossCount: 3,
    takeProfitPercent: 50,
  });

  assert.equal(plan.stopLoss, 5);
  assert.equal(plan.takeProfit, 2.5);
  assert.equal(plan.startingStake, 1.66);
  assert.equal(plan.stakes.length, 3);
  assert.ok(plan.stakes.at(-1).cumulative <= plan.stopLoss);
});

test("rejects risk settings that cannot support the minimum stake", () => {
  assert.throws(
    () =>
      calculateRiskPlan({
        balance: 0.01,
        riskPercent: 1,
        martingale: 1,
        lossCount: 10,
        takeProfitPercent: 50,
      }),
    RangeError,
  );
});

test("replays adjacent tick direction without claiming payout or profit", () => {
  const result = replayDirection([
    { quote: 10 },
    { quote: 11 },
    { quote: 12 },
    { quote: 11 },
    { quote: 10 },
  ]);

  assert.deepEqual(result, { wins: 2, losses: 1, total: 3, winRate: (2 / 3) * 100 });
});
