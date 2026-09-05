/**
 * ComboSystem 单元测试（tests/combo-system.test.ts）
 * 覆盖：连击递增、窗口计时超时清零、伤害乘数计算与上限钳制、
 *       isActive / remainingWindow 状态、reset 复位。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ComboSystem } from '../src/systems/ComboSystem';

function makeSystem(overrides?: Partial<ConstructorParameters<typeof ComboSystem>[0]>) {
  return new ComboSystem({
    timeWindow: 5,
    damageGrowth: 0.5,
    maxDamageMultiplier: 3,
    ...overrides,
  });
}

test('初始状态：无连击、不活跃、乘数为 1', () => {
  const c = makeSystem();
  assert.equal(c.current, 0);
  assert.equal(c.max, 0);
  assert.equal(c.isActive, false);
  assert.equal(c.damageMultiplier, 1);
  assert.equal(c.remainingWindow, 0);
});

test('registerKill 递增连击并记录最佳', () => {
  const c = makeSystem();
  c.registerKill();
  assert.equal(c.current, 1);
  assert.equal(c.max, 1);
  c.registerKill();
  assert.equal(c.current, 2);
  assert.equal(c.max, 2);
  // 2 连击起才算「活跃」（UI 高亮条件）
  assert.equal(c.isActive, true);
});

test('isActive 在连击数小于 2 时不生效', () => {
  const c = makeSystem();
  c.registerKill();
  assert.equal(c.isActive, false, '单杀不应触发连击 UI 高亮');
});

test('伤害乘数随连击线性提升', () => {
  const c = makeSystem();
  c.registerKill();
  assert.equal(c.damageMultiplier, 1, '1 连击无加成');
  c.registerKill();
  assert.equal(c.damageMultiplier, 1.5, '2 连击 = 1 + 0.5');
  c.registerKill();
  assert.equal(c.damageMultiplier, 2);
});

test('伤害乘数受 maxDamageMultiplier 上限钳制', () => {
  const c = makeSystem({ damageGrowth: 1, maxDamageMultiplier: 3 });
  for (let i = 0; i < 6; i++) c.registerKill();
  assert.equal(c.current, 6);
  assert.equal(c.damageMultiplier, 3, '理论 1+5=6，应钳制到 3');
});

test('update 在窗口内推进不归零，超时归零并返回 true', () => {
  const c = makeSystem({ timeWindow: 5 });
  c.registerKill();
  c.registerKill();
  // 窗口内推进
  assert.equal(c.update(3), false);
  assert.equal(c.current, 2, '窗口内连击保留');
  assert.equal(c.remainingWindow, 2, '剩余 5-3=2 秒');
  // 超时清零
  assert.equal(c.update(3), true, '超时应返回 true 表示连击断掉');
  assert.equal(c.current, 0);
  assert.equal(c.isActive, false);
});

test('update 在无连击或结束后不产生副作用', () => {
  const c = makeSystem();
  assert.equal(c.update(1), false, '从未击杀时 update 不返回 true');
  c.registerKill();
  c.reset();
  assert.equal(c.update(1), false);
});

test('reset 清空连击与窗口', () => {
  const c = makeSystem();
  c.registerKill();
  c.registerKill();
  c.registerKill();
  assert.equal(c.current, 3);
  c.reset();
  assert.equal(c.current, 0);
  assert.equal(c.max, 3, 'reset 不清空本局最高连击记录');
  assert.equal(c.isActive, false);
  assert.equal(c.remainingWindow, 0);
});

test('registerKill 刷新窗口：击杀后剩余时间恢复满窗', () => {
  const c = makeSystem({ timeWindow: 5 });
  c.registerKill();
  c.update(4);
  assert.equal(c.remainingWindow, 1);
  c.registerKill();
  assert.equal(c.remainingWindow, 5, '新击杀应重置窗口倒计时');
});
