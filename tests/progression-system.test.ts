/**
 * ProgressionSystem 单元测试（tests/progression-system.test.ts）
 * 覆盖：默认存档、addExp 升级（含多级连升与满级）、addScore 累加、
 *       unlockLevel 只增不减、每日奖励时间钳制、存档 load/save 往返、reset 清空。
 * 说明：Node 环境无 localStorage，测试用内存 stub 注入 globalThis。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProgressionSystem } from '../src/systems/ProgressionSystem';
import type { GameSettings } from '../src/config/types';

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

/** 与 public/config/gameSettings.json levelSettings 同构的最小 fixture */
const settings = {
  version: 'test',
  levelSettings: {
    maxLevel: 50,
    levelUpGradeBase: 100,
    levelUpGradeGrowth: 1.2,
    levelUpGradeGrowthType: 'exponential' as const,
  },
} as GameSettings;

// ──────────────────────────── 基础状态 ────────────────────────────

test('默认存档：1 级、无经验、解锁第 1 关', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  assert.equal(p.level, 1);
  assert.equal(p.exp, 0);
  assert.equal(p.totalScore, 0);
  assert.equal(p.unlockedLevel, 1);
});

test('未 bind 配置时 addExp 不生效', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.load();
  const evt = p.addExp(500);
  assert.equal(evt, null, '未绑定配置应拒绝加经验');
  assert.equal(p.level, 1);
});

test('expToNextLevel 与 levelProgress 联动', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  assert.equal(p.expToNextLevel, 100, '1 级升 2 级需 100 exp（指数曲线）');
  assert.equal(p.levelProgress, 0);
});

// ──────────────────────────── 经验升级 ────────────────────────────

test('addExp 达阈值触发单级升级', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  const evt = p.addExp(100);
  assert.deepEqual(evt, { from: 1, to: 2, levelsGained: 1 });
  assert.equal(p.exp, 0, '升级后经验扣除阈值');
  assert.equal(p.level, 2);
});

test('addExp 大量经验支持多级连升', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  // 100 + 120 = 220 → 连升 2 级
  const evt = p.addExp(220);
  assert.equal(evt?.levelsGained, 2);
  assert.equal(p.level, 3);
});

test('addExp 不足阈值时只累积经验不升级', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  p.addExp(99);
  assert.equal(p.level, 1);
  assert.equal(p.exp, 99);
  assert.equal(p.levelProgress, 0.99);
});

test('满级后 expToNextLevel 为 Infinity 且 progress 为 1', () => {
  clearStorage();
  const maxSettings = { ...settings, levelSettings: { ...settings.levelSettings, maxLevel: 2 } };
  const p = new ProgressionSystem();
  p.bind(maxSettings);
  p.load();
  p.addExp(100);
  assert.equal(p.level, 2);
  assert.equal(p.expToNextLevel, Number.POSITIVE_INFINITY);
  assert.equal(p.levelProgress, 1);
});

// ──────────────────────────── 得分与解锁 ────────────────────────────

test('addScore 只累加正数', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  p.addScore(100);
  p.addScore(-50);
  p.addScore(0);
  assert.equal(p.totalScore, 100);
});

test('unlockLevel 只增不减', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  p.unlockLevel(5);
  assert.equal(p.unlockedLevel, 5);
  p.unlockLevel(3);
  assert.equal(p.unlockedLevel, 5, '低关卡号不应回退解锁进度');
  p.unlockLevel(8);
  assert.equal(p.unlockedLevel, 8);
});

// ──────────────────────── 每日奖励时间钳制 ────────────────────────

test('addDailyRewardTime 按每日上限钳制', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  const first = p.addDailyRewardTime(100, 300);
  assert.equal(first, 100);
  const second = p.addDailyRewardTime(250, 300);
  assert.equal(second, 200, '剩余 200s，超出的 50s 被钳制');
  assert.equal(p.dailyRewardTime, 300);
  assert.equal(p.dailyRewardRemaining(300), 0);
});

test('addDailyRewardTime 负值与上限为 0 时不发放', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  assert.equal(p.addDailyRewardTime(50, 0), 0);
  assert.equal(p.addDailyRewardTime(-5, 300), 0);
});

// ──────────────────────────── 存档往返 ────────────────────────────

test('save 后新实例 load 恢复进度', () => {
  clearStorage();
  const p1 = new ProgressionSystem();
  p1.bind(settings);
  p1.load();
  p1.addExp(220);
  p1.addScore(375);
  p1.unlockLevel(4);
  p1.save();

  const p2 = new ProgressionSystem();
  p2.bind(settings);
  p2.load();
  assert.equal(p2.level, 3);
  assert.equal(p2.totalScore, 375);
  assert.equal(p2.unlockedLevel, 4);
});

test('损坏存档回退默认且不抛错', () => {
  clearStorage();
  storage.set('knowledge-mow-king.save.v1', '{broken json!!');
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  assert.equal(p.level, 1, '损坏存档应静默回退默认值');
});

test('reset 清空存档并回到默认进度', () => {
  clearStorage();
  const p = new ProgressionSystem();
  p.bind(settings);
  p.load();
  p.addExp(220);
  p.unlockLevel(4);
  p.reset();
  assert.equal(p.level, 1);
  assert.equal(p.exp, 0);
  assert.equal(p.unlockedLevel, 1);
  assert.equal(storage.has('knowledge-mow-king.save.v1'), false, 'reset 应删除本地存档');
});
