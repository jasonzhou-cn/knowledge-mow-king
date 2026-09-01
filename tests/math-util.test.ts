/**
 * MathUtil 单元测试（tests/math-util.test.ts）
 * 覆盖：钳制、插值、缓动、成长曲线、随机洗牌、距离平方、时间/数值格式化、颜色解析。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  clamp01,
  lerp,
  easeOutCubic,
  easeOutBack,
  damp,
  growthExponential,
  growthLinearPercent,
  randomInt,
  shuffle,
  distanceSquared,
  formatClock,
  formatOneDecimal,
  hexToColor,
} from '../src/utils/MathUtil';

test('clamp 钳制到闭区间', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

test('clamp 对 NaN 返回下限', () => {
  assert.equal(clamp(Number.NaN, 1, 2), 1);
});

test('clamp01 钳制到 [0,1]', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(7), 1);
});

test('lerp 线性插值', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
});

test('easeOutCubic 端点正确且单调不减', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = easeOutCubic(i / 20);
    assert.ok(v >= prev, `easeOutCubic 应单调不减，i=${i} 时 v=${v}`);
    prev = v;
  }
  assert.ok(easeOutCubic(0.5) > 0.5, '缓出曲线前半段应高于线性（先快后慢）');
});

test('easeOutBack 末端回弹超过目标再回落', () => {
  assert.equal(easeOutBack(1), 1);
  let max = 0;
  for (let i = 0; i <= 100; i++) {
    const v = easeOutBack(i / 100);
    max = Math.max(max, v);
  }
  assert.ok(max > 1.0, `回弹峰值应超过 1，实际 ${max}`);
  assert.ok(max < 1.2, `回弹不应过度，实际 ${max}`);
});

test('damp 指数阻尼：介于初值与目标之间，dt 越大越接近目标', () => {
  assert.ok(damp(0, 100, 1, 0.5) > 0 && damp(0, 100, 1, 0.5) < 100);
  assert.ok(
    damp(0, 100, 1, 10) > damp(0, 100, 1, 0.1),
    'dt 越大应越接近目标',
  );
});

test('growthExponential 指数成长曲线', () => {
  assert.equal(growthExponential(10, 2, 1), 10);
  assert.equal(growthExponential(10, 2, 3), 40);
  assert.equal(growthExponential(10, 2, 0), 10, 'level<1 按 level=1 处理');
});

test('growthLinearPercent 线性百分比成长曲线', () => {
  assert.equal(growthLinearPercent(100, 0.1, 1), 100);
  assert.equal(growthLinearPercent(100, 0.1, 3), 120);
});

test('randomInt 落在 [min, max) 区间', () => {
  for (let i = 0; i < 500; i++) {
    const v = randomInt(3, 7);
    assert.ok(v >= 3 && v < 7, `randomInt(3,7) 得到 ${v}`);
  }
});

test('shuffle 保持元素集合不变（Fisher-Yates 无偏性前提）', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = 0; i < 20; i++) {
    const arr = input.slice();
    shuffle(arr);
    assert.deepEqual([...arr].sort((a, b) => a - b), input, '洗牌后元素集合必须一致');
  }
});

test('distanceSquared 距离平方（碰撞判定禁用开方）', () => {
  assert.equal(distanceSquared(0, 0, 3, 4), 25);
  assert.equal(distanceSquared(1, 1, 1, 1), 0);
});

test('formatClock 秒转 M:SS', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(60), '1:00');
  assert.equal(formatClock(61), '1:01');
  assert.equal(formatClock(599), '9:59');
  assert.equal(formatClock(-5), '0:00');
});

test('formatOneDecimal 保留一位小数', () => {
  assert.equal(formatOneDecimal(2), '2.0');
  assert.equal(formatOneDecimal(1.24), '1.2');
  assert.equal(formatOneDecimal(1.25), '1.3');
});

test('hexToColor 解析与非法回退', () => {
  assert.equal(hexToColor('#ff00ff'), 0xff00ff);
  assert.equal(hexToColor('ff00ff'), 0xff00ff);
  assert.equal(hexToColor('not-a-color'), 0xff00ff, '默认回退粉色');
  assert.equal(hexToColor('not-a-color', 0x123456), 0x123456, '自定义回退');
  assert.equal(hexToColor('#fff'), 0xff00ff, '短格式 #RGB 不支持，回退');
  assert.equal(hexToColor(null as unknown as string), 0xff00ff, '非字符串回退');
});
