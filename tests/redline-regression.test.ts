/**
 * 红线修复回归测试（tests/redline-regression.test.ts）
 * 用单测钉死三条红线修复的行为，防止未来调参时悄然回退：
 *  - 红线 2-A：击杀连击不得再提供伤害加成（comboDamageGrowth=0 / 上限=1 时恒为 1）；
 *  - 红线 2-B：等级经验公式不再吃击杀（rewardConfig 无 expPerKill，计算只在 ResultScene）——
 *    这里改验 computeGrassCuttingBonus 的速度权重梯度（P1-1 强化后快慢差距拉大）。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ComboSystem } from '../src/systems/ComboSystem';
import { computeGrassCuttingBonus, type QuizResult } from '../src/config/resolve';
import type { GrassCuttingBonusSettings } from '../src/config/types';

test('红线 2-A：comboDamageGrowth=0 + 上限=1 时，连击对伤害无任何加成', () => {
  // 与 public/config/grassCuttingConfig.json comboSettings 的红线取值一致
  const combo = new ComboSystem({ timeWindow: 2, damageGrowth: 0, maxDamageMultiplier: 1 });
  for (let i = 0; i < 50; i++) combo.registerKill();
  assert.equal(combo.damageMultiplier, 1, '连击 50 也必须是 1.0×：答题是唯一战力来源');
});

test('红线 2-A 对照：growth>0 时连击仍能提供加成（配置开关行为未破坏）', () => {
  const combo = new ComboSystem({ timeWindow: 2, damageGrowth: 0.1, maxDamageMultiplier: 3 });
  for (let i = 0; i < 21; i++) combo.registerKill();
  assert.equal(combo.damageMultiplier, 3);
});

/** 与 public/config/gameSettings.json grassCuttingBonusSettings 同构（P1-1 调参后） */
const bonusSettings: GrassCuttingBonusSettings = {
  baseBonusGrowthPerLevel: 0.1,
  accuracyBaseline: 0.5,
  accuracyWeight: 1,
  accuracyTermMin: 0.4,
  accuracyTermMax: 1.6,
  speedFactorBase: 1,
  speedFactorWeight: 0.8,
  speedFactorMin: 0.8,
  speedFactorMax: 1.5,
  comboFactorPerCombo: 0.05,
  comboFactorMax: 1.5,
  multiplierFloor: { damage: 0.6, range: 0.6, duration: 0.6 },
  multiplierCeiling: { damage: 3, range: 3, duration: 3 },
};

function quiz(accuracy: number, avgTime: number): QuizResult {
  return {
    totalQuestions: 5,
    correctCount: Math.round(accuracy * 5),
    missCount: 0,
    timeoutCount: 0,
    accuracy,
    maxCombo: 0,
    averageAnswerTime: avgTime,
    totalAnswerTime: avgTime * 5,
    records: [],
  };
}

test('P1-1：答得快（耗时占比 20%）吃到 1.5× 速度项上限', () => {
  const bonus = computeGrassCuttingBonus(quiz(1, 2), 1, 1, bonusSettings, 10);
  assert.ok(Math.abs(bonus.breakdown.speedFactor - 1.5) < 1e-9, `speedFactor=${bonus.breakdown.speedFactor}`);
});

test('P1-1：慢慢答（吃满限时）速度项回落到 1.0，快慢差距 ≥ 50%', () => {
  const slow = computeGrassCuttingBonus(quiz(1, 10), 1, 1, bonusSettings, 10);
  const fast = computeGrassCuttingBonus(quiz(1, 2), 1, 1, bonusSettings, 10);
  assert.ok(Math.abs(slow.breakdown.speedFactor - 1.0) < 1e-9);
  assert.ok(
    fast.breakdown.speedFactor / slow.breakdown.speedFactor >= 1.5,
    `快/慢 = ${fast.breakdown.speedFactor / slow.breakdown.speedFactor}`,
  );
});

test('保底仍然生效：全错 + 超慢的最终伤害不低于 multiplierFloor', () => {
  const bonus = computeGrassCuttingBonus(quiz(0, 10), 1, 1, bonusSettings, 10);
  assert.ok(bonus.damageMultiplier >= bonusSettings.multiplierFloor.damage - 1e-9);
});
