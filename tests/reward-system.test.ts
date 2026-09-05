/**
 * RewardSystem 单元测试（tests/reward-system.test.ts）
 * 覆盖：连对奖励档位选择（只结算最高档）、各奖励来源判定（完美/极速/无伤）、
 *       单次上限钳制、每日上限钳制（applyDailyCap）、得分计算、结算文案格式化。
 * 铁律（GDD 1.3 奖励可控原则）：双上限钳制下不可能刷出无限游戏时间。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveComboTier,
  calculateRewards,
  applyDailyCap,
  calculateScore,
  formatRewardItems,
  type RewardInput,
} from '../src/systems/RewardSystem';
import type { RewardConfig } from '../src/config/types';
import type { QuizResult } from '../src/config/resolve';

/** 与 public/config/rewardConfig.json 同构的 fixture */
const config: RewardConfig = {
  version: 'test',
  comboRewards: [
    { combo: 3, rewardTime: 5, rewardSkillDuration: 1 },
    { combo: 5, rewardTime: 10, rewardSkillDuration: 2 },
    { combo: 10, rewardTime: 20, rewardSkillDuration: 3 },
  ],
  otherRewards: {
    perfectAnswerReward: 10,
    fastAnswerReward: 5,
    fastAnswerTimeThreshold: 4,
    noDamageReward: 15,
  },
  scoreSettings: {
    scorePerKill: 10,
    scorePerCorrectAnswer: 50,
    scoreComboBonusPerCombo: 5,
    expPerKill: 2,
    expPerCorrectAnswer: 5,
    expLevelClearBonus: 20,
  },
  rewardLimits: {
    dailyRewardTimeMax: 300,
    singleRewardTimeMax: 60,
    comboRewardTimeMax: 120,
  },
};

function makeQuiz(partial: Partial<QuizResult> = {}): QuizResult {
  return {
    totalQuestions: 5,
    correctCount: 5,
    missCount: 0,
    timeoutCount: 0,
    accuracy: 1,
    maxCombo: 5,
    averageAnswerTime: 3,
    totalAnswerTime: 15,
    records: [],
    ...partial,
  };
}

function makeInput(partial: Partial<RewardInput> = {}): RewardInput {
  return {
    quiz: makeQuiz(),
    kills: 10,
    noDamage: false,
    ...partial,
  };
}

// ─────────────────────── resolveComboTier ───────────────────────

test('resolveComboTier 无达标档返回 null', () => {
  const r = resolveComboTier(1, config.comboRewards);
  assert.equal(r.tier, null);
  assert.equal(r.seconds, 0);
  assert.equal(r.next, 3, '下一档应是第一个奖励档位');
});

test('resolveComboTier 只取达标的最高档（不累加）', () => {
  const r = resolveComboTier(5, config.comboRewards);
  assert.equal(r.tier, 5);
  assert.equal(r.seconds, 10);
  assert.equal(r.next, 10, '下一档应为 10 连对');
});

test('resolveComboTier 超过最高档后 next 为 null', () => {
  const r = resolveComboTier(12, config.comboRewards);
  assert.equal(r.tier, 10);
  assert.equal(r.seconds, 20);
  assert.equal(r.next, null, '满档后无下一档');
});

// ─────────────────────── calculateRewards ───────────────────────

test('calculateRewards 连对 + 完美 + 极速 + 无伤全部触发', () => {
  const input = makeInput({ noDamage: true });
  const r = calculateRewards(input, config);
  // 连对 5 题 10s + 完美 10s + 极速 5s + 无伤 15s = 40s
  assert.equal(r.rawTotal, 40);
  assert.equal(r.singleCapped, false);
  assert.equal(r.grantedTotal, 40);
  assert.equal(r.items.length, 4);
  assert.equal(r.reachedComboTier, 5);
});

test('calculateRewards 无伤触发；受伤则不触发', () => {
  const hit = calculateRewards(makeInput({ noDamage: false }), config);
  const clean = calculateRewards(makeInput({ noDamage: true }), config);
  assert.ok(clean.rawTotal > hit.rawTotal, '无伤应有额外 15s');
});

test('calculateRewards 极速判定使用平均耗时阈值', () => {
  const fast = calculateRewards(makeInput({ quiz: makeQuiz({ averageAnswerTime: 2 }) }), config);
  const slow = calculateRewards(makeInput({ quiz: makeQuiz({ averageAnswerTime: 8 }) }), config);
  assert.ok(fast.rawTotal > slow.rawTotal, '快答应有极速奖励');
});

test('calculateRewards 完美奖励要求正确率 100%', () => {
  const perfect = calculateRewards(
    makeInput({ quiz: makeQuiz({ accuracy: 1 }) }),
    config,
  );
  const notPerfect = calculateRewards(
    makeInput({ quiz: makeQuiz({ accuracy: 0.8, maxCombo: 0 }) }),
    config,
  );
  assert.ok(perfect.rawTotal > notPerfect.rawTotal);
});

test('calculateRewards 单次上限钳制', () => {
  // 全部触发时 40s < 60s 不会触发；构造高额 fixture 验证钳制
  const big: RewardConfig = {
    ...config,
    otherRewards: {
      perfectAnswerReward: 100,
      fastAnswerReward: 100,
      fastAnswerTimeThreshold: 4,
      noDamageReward: 100,
    },
    rewardLimits: { ...config.rewardLimits, singleRewardTimeMax: 60 },
  };
  const r = calculateRewards(makeInput({ noDamage: true }), big);
  assert.equal(r.singleCapped, true);
  assert.equal(r.singleCappedTotal, 60);
  assert.equal(r.grantedTotal, 60);
});

test('calculateRewards 无任何奖励时 items 为空且总额为 0', () => {
  const r = calculateRewards(
    makeInput({
      quiz: makeQuiz({ maxCombo: 1, accuracy: 0, averageAnswerTime: 9 }),
      noDamage: false,
    }),
    config,
  );
  assert.equal(r.rawTotal, 0);
  assert.equal(r.items.length, 0);
});

// ─────────────────────── applyDailyCap ───────────────────────

test('applyDailyCap 每日剩余充足时全额发放', () => {
  const calc = calculateRewards(makeInput(), config);
  const applied = applyDailyCap(calc, 0, 300);
  assert.equal(applied.grantedTotal, calc.singleCappedTotal);
  assert.equal(applied.dailyUsedAfter, calc.singleCappedTotal);
  assert.equal(applied.dailyCapped, false);
});

test('applyDailyCap 每日额度不足时钳制并标记 dailyCapped', () => {
  const calc = calculateRewards(makeInput(), config);
  const applied = applyDailyCap(calc, 290, 300);
  // 剩余 10s，发放额被钳制到 10
  assert.equal(applied.grantedTotal, Math.min(calc.singleCappedTotal, 10));
  assert.equal(applied.dailyCapped, true);
  assert.equal(applied.dailyUsedAfter, 300);
});

test('applyDailyCap 每日额度已用完时发放 0', () => {
  const calc = calculateRewards(makeInput(), config);
  const applied = applyDailyCap(calc, 300, 300);
  assert.equal(applied.grantedTotal, 0);
  assert.equal(applied.dailyCapped, true);
});

// ─────────────────────── calculateScore ───────────────────────

test('calculateScore 按击杀/答对/连对加权计分', () => {
  const score = calculateScore(
    makeInput({ kills: 10, quiz: makeQuiz({ correctCount: 5, maxCombo: 5 }) }),
    config,
    5,
  );
  // 10×10 + 5×50 + 5×5 = 100 + 250 + 25 = 375
  assert.equal(score, 375);
});

// ─────────────────────── formatRewardItems ───────────────────────

test('formatRewardItems 空列表给出引导文案', () => {
  assert.match(formatRewardItems([]), /暂无奖励/);
});

test('formatRewardItems 多行展示每条来源与秒数', () => {
  const text = formatRewardItems([
    { source: '连对 5 题阶梯奖励', seconds: 10 },
    { source: '无伤奖励', seconds: 15 },
  ]);
  assert.match(text, /连对 5 题阶梯奖励：\+10s/);
  assert.match(text, /无伤奖励：\+15s/);
});
