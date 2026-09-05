/**
 * 动态难度下调（DifficultyAssist）单元测试（tests/difficulty-assist.test.ts）
 * 覆盖：computeAssistTarget 加权与钳制、applyAssistToProgress「只降不升」、
 *       smoothAssist 指数平滑方向。红线 3（软失败保护）的核心算法必须可回归。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAssistToProgress,
  computeAssistTarget,
  smoothAssist,
} from '../src/systems/DifficultyAssist';
import type { AssistSettings } from '../src/config/types';

/** 与 public/config/grassCuttingConfig.json assistSettings 同构的 fixture */
const settings: AssistSettings = {
  enabled: true,
  accuracyWeight: 0.4,
  hpWeight: 0.35,
  lossWeight: 0.25,
  lossRefHpPerSec: 4,
  lossWindowSec: 5,
  pullMin: 0.55,
  smoothingSec: 1.5,
};

function target(accuracy: number, hpRatio: number, lossPerSec: number): number {
  return computeAssistTarget({ accuracy, hpRatio, recentLossPerSec: lossPerSec }, settings);
}

test('assist 表现完美时为 1（难度保持原曲线）', () => {
  assert.ok(Math.abs(target(1, 1, 0) - 1) < 1e-9);
});

test('assist 表现极差（全错 + 残血 + 掉血拉满）时接近 0', () => {
  assert.ok(target(0, 0.05, 4) < 0.2);
});

test('assist 永远落在 [0,1]', () => {
  for (const [a, hp, loss] of [[0, 0, 100], [1, 1, 0], [0.5, 0.5, 2]] as const) {
    const v = target(a, hp, loss);
    assert.ok(v >= 0 && v <= 1, `assist=${v} 应在 [0,1] 内`);
  }
});

test('表现越好 assist 越高（单调性）', () => {
  const worse = target(0.2, 0.3, 3);
  const better = target(0.8, 0.9, 0.2);
  assert.ok(better > worse);
});

test('掉血速率超过 lossRefHpPerSec 后不再加重惩罚（钳制）', () => {
  assert.equal(target(1, 1, 4), target(1, 1, 40));
});

test('effectiveT 永远 ≤ 原始 t（只降不升，红线 3 核心）', () => {
  for (const t of [0, 0.25, 0.5, 0.9, 1]) {
    for (const assist of [0, 0.3, 0.7, 1]) {
      const effective = applyAssistToProgress(t, assist, settings.pullMin);
      assert.ok(effective <= t + 1e-12, `t=${t}, assist=${assist} 时 effective=${effective} 超过了原进度`);
    }
  }
});

test('assist=0 时 effectiveT = t × pullMin（最强保护档）', () => {
  assert.ok(Math.abs(applyAssistToProgress(0.8, 0, settings.pullMin) - 0.8 * settings.pullMin) < 1e-9);
});

test('assist=1 时 effectiveT = t（无回拉，零回归）', () => {
  assert.ok(Math.abs(applyAssistToProgress(0.8, 1, settings.pullMin) - 0.8) < 1e-9);
});

test('smoothAssist 向目标方向收敛且不会越过目标', () => {
  const next = smoothAssist(0.2, 1, 0.5, settings.smoothingSec);
  assert.ok(next > 0.2 && next < 1);
  const down = smoothAssist(0.9, 0.3, 0.5, settings.smoothingSec);
  assert.ok(down < 0.9 && down > 0.3);
});

test('weights 全 0 时 assist 兜底为 1（不误伤难度）', () => {
  const v = computeAssistTarget(
    { accuracy: 0, hpRatio: 0, recentLossPerSec: 99 },
    { ...settings, accuracyWeight: 0, hpWeight: 0, lossWeight: 0 },
  );
  assert.equal(v, 1);
});
