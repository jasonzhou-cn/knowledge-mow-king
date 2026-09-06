/**
 * 武器渐进解锁单元测试（tests/weapon-unlock.test.ts，T-033）
 * 覆盖：初始只有大刀、unlockWeapon 幂等、老 v2 存档按已达关卡推导补全、
 *       解锁链配置消费（afterLevel 门槛）、存档往返。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProgressionSystem } from '../src/systems/ProgressionSystem';
import type { GameSettings } from '../src/config/types';

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

function makeSettings(): GameSettings {
  return {
    version: 'test',
    levelSettings: {
      maxLevel: 50,
      levelUpGradeBase: 100,
      levelUpGradeGrowth: 1.2,
      levelUpGradeGrowthType: 'exponential',
    },
    rewardSettings: {} as GameSettings['rewardSettings'],
    otherSettings: { defaultGameTime: 60, maxGameTimeLimit: 300, minGameTimeLimit: 30, subjectUnlockLevel: {} },
    grassCuttingBonusSettings: {
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
    },
    playtimeSettings: { enabled: false, sessionLimitMin: 30, restMin: 10 },
    weaponUnlockSettings: [
      { id: 'smg', afterLevel: 2, minAccuracy: 0.6 },
      { id: 'scatter', afterLevel: 4, minAccuracy: 0.6 },
      { id: 'boomerang', afterLevel: 7, minAccuracy: 0.6 },
      { id: 'acid', afterLevel: 10, minAccuracy: 0.6 },
      { id: 'homing', afterLevel: 13, minAccuracy: 0.6 },
    ],
  } as GameSettings;
}

test('新存档初始只解锁大刀', () => {
  storage.clear();
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  assert.deepEqual(p.meta.weaponUnlocks, ['blade']);
});

test('unlockWeapon 幂等且落盘', () => {
  storage.clear();
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  assert.equal(p.unlockWeapon('smg'), true);
  assert.equal(p.unlockWeapon('smg'), false);
  assert.deepEqual(p.meta.weaponUnlocks, ['blade', 'smg']);
  const saved = JSON.parse(storage.get('knowledge-mow-king.save.v1')!);
  assert.ok(saved.meta.weaponUnlocks.includes('smg'));
});

test('老 v2 存档（无 weaponUnlocks）按已达关卡推导补全', () => {
  storage.clear();
  storage.set(
    'knowledge-mow-king.save.v1',
    JSON.stringify({
      version: 2,
      level: 5,
      exp: 0,
      totalScore: 0,
      unlockedLevel: 5, // 已解锁到第 5 关 → 通过了 L2（smg）与 L4（scatter），未到 L7（boomerang）
      daily: { date: '2026-01-01', rewardTime: 0 },
      meta: { achievements: [], bossesDefeated: [], bestScores: {}, totals: {} },
      updatedAt: 1,
    }),
  );
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  assert.deepEqual(p.meta.weaponUnlocks.sort(), ['blade', 'scatter', 'smg']);
});

test('已到第 14 关的老玩家推导出全链武器', () => {
  storage.clear();
  storage.set(
    'knowledge-mow-king.save.v1',
    JSON.stringify({
      version: 2,
      level: 20,
      exp: 0,
      totalScore: 0,
      unlockedLevel: 14,
      daily: { date: '2026-01-01', rewardTime: 0 },
      meta: { achievements: [], bossesDefeated: [], bestScores: {}, totals: {} },
      updatedAt: 1,
    }),
  );
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  // unlockedLevel=14 > homing.afterLevel=13 → 全部 6 把
  assert.equal(p.meta.weaponUnlocks.length, 6);
  assert.ok(p.meta.weaponUnlocks.includes('homing'));
});

test('weaponUnlocks 不占用 progress 字段：reset 后回到只有大刀', () => {
  storage.clear();
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  p.unlockWeapon('scatter');
  p.reset();
  p.load();
  assert.deepEqual(p.meta.weaponUnlocks, ['blade']);
});

test('脏 weaponUnlocks 归一化：空数组回退为大刀', () => {
  storage.clear();
  storage.set(
    'knowledge-mow-king.save.v1',
    JSON.stringify({
      version: 2,
      level: 2,
      exp: 0,
      totalScore: 0,
      unlockedLevel: 2,
      daily: { date: '2026-01-01', rewardTime: 0 },
      meta: { achievements: [], bossesDefeated: [], bestScores: {}, totals: {}, weaponUnlocks: [] },
      updatedAt: 1,
    }),
  );
  const p = new ProgressionSystem();
  p.bind(makeSettings());
  p.load();
  assert.deepEqual(p.meta.weaponUnlocks, ['blade']);
});
