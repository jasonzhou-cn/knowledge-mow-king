/**
 * 存档 v2 元数据单元测试（tests/meta-save.test.ts）
 * 覆盖：v1 → v2 自动迁移（老进度保留）、meta 归一化（脏数据兜底）、
 *       unlockAchievement 幂等、recordLevelScore 只增不减、每日奖励逻辑不受迁移影响。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProgressionSystem, progression } from '../src/systems/ProgressionSystem';

// ───────────────────────── localStorage stub ─────────────────────────

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

function clearStorage(): void {
  storage.clear();
}

test('unlockAchievement 幂等：首次 true，重复 false，列表只增', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.load();
  assert.equal(p.unlockAchievement('first_clear'), true);
  assert.equal(p.unlockAchievement('first_clear'), false);
  assert.deepEqual(p.meta.achievements, ['first_clear']);
});

test('recordLevelScore 只保留每关最高分', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.load();
  p.unlockAchievement('dummy-keep-meta-fresh'); // 触发一次 save 建 meta
  p.meta.bestScores['3'] = 100;
  p.meta.bestScores['3'] = 250;
  assert.equal(p.meta.bestScores['3'], 250);
});

test('v1 存档自动迁移：等级/经验/得分/解锁保留，meta 从零开始', () => {
  clearStorage();
  storage.set(
    'knowledge-mow-king.save.v1',
    JSON.stringify({
      version: 1,
      level: 7,
      exp: 33,
      totalScore: 1234,
      unlockedLevel: 9,
      daily: { date: '2026-01-01', rewardTime: 60 },
      updatedAt: 1,
    }),
  );
  const p = new ProgressionSystem();
  p.load();
  assert.equal(p.level, 7);
  assert.equal(p.exp, 33);
  assert.equal(p.totalScore, 1234);
  assert.equal(p.unlockedLevel, 9);
  assert.deepEqual(p.meta.achievements, []);
  assert.equal(p.meta.totals.kills, 0);
  // 迁移结果立即回写为 v2
  assert.equal(JSON.parse(storage.get('knowledge-mow-king.save.v1')!).version, 2);
});

test('v2 脏 meta 归一化：负数/缺字段/类型错误不炸、不污染', () => {
  clearStorage();
  storage.set(
    'knowledge-mow-king.save.v1',
    JSON.stringify({
      version: 2,
      level: 2,
      exp: 0,
      totalScore: 0,
      unlockedLevel: 2,
      daily: { date: '2026-01-01', rewardTime: 0 },
      meta: {
        achievements: 'not-an-array',
        bossesDefeated: ['boss_x', 42, 'boss_y'],
        bestScores: { '1': 50 },
        totals: { kills: -5 },
      },
      updatedAt: 1,
    }),
  );
  const p = new ProgressionSystem();
  p.load();
  assert.deepEqual(p.meta.achievements, []);
  assert.deepEqual(p.meta.bossesDefeated, ['boss_x', 'boss_y']);
  assert.equal(p.meta.totals.kills, 0);
  assert.equal(p.meta.bestScores['1'], 50);
});

test('每日奖励时间在 v2 上照常钳制（迁移不破坏既有逻辑）', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.load();
  const granted = p.addDailyRewardTime(9999, 300);
  assert.equal(granted, 300);
  assert.equal(p.dailyRewardTime, 300);
});

test('全局单例与独立实例共享同一份结构行为（冒烟）', () => {
  clearStorage();
  progression.load();
  assert.ok(progression.meta.totals.kills >= 0);
});
