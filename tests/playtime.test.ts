/**
 * 防沉迷系统单元测试（tests/playtime.test.ts）
 * 覆盖：shouldRest 阈值判定（连玩超时 / 休息倒计时内 / 关闭开关）、
 *       startRest / finishRest 状态迁移、localStorage 持久化往返（刷新不可绕过）。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlaytimeSystem } from '../src/systems/PlaytimeSystem';
import type { PlaytimeSettings } from '../src/config/types';

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

const settings: PlaytimeSettings = { enabled: true, sessionLimitMin: 30, restMin: 10 };

function fresh(record?: { sessionStart: number; restUntil: number }): PlaytimeSystem {
  storage.clear();
  const p = new PlaytimeSystem();
  p.bind(settings);
  if (record) {
    storage.set('knowledge-mow-king.playtime.v1', JSON.stringify(record));
  }
  p.load();
  return p;
}

test('未超时（连玩 1 分钟）不触发休息', () => {
  const p = fresh({ sessionStart: Date.now() - 60_000, restUntil: 0 });
  assert.equal(p.shouldRest, false);
});

test('连玩达到上限（30 分钟）触发休息', () => {
  const p = fresh({ sessionStart: Date.now() - 31 * 60_000, restUntil: 0 });
  assert.equal(p.shouldRest, true);
});

test('休息倒计时内触发休息（sessionStart 是新的也不放行）', () => {
  const p = fresh({ sessionStart: Date.now(), restUntil: Date.now() + 5 * 60_000 });
  assert.equal(p.shouldRest, true);
  assert.ok(p.restRemainingSec > 0 && p.restRemainingSec <= 300);
});

test('enabled=false 时全部检查短路', () => {
  storage.clear();
  const p = new PlaytimeSystem();
  p.bind({ enabled: false, sessionLimitMin: 30, restMin: 10 });
  storage.set(
    'knowledge-mow-king.playtime.v1',
    JSON.stringify({ sessionStart: Date.now() - 999 * 60_000, restUntil: 0 }),
  );
  p.load();
  assert.equal(p.shouldRest, false);
});

test('startRest 设置休息截止并重置连续起点（幂等取较大值）', () => {
  const p = fresh({ sessionStart: Date.now() - 31 * 60_000, restUntil: 0 });
  p.startRest();
  assert.equal(p.shouldRest, true);
  const first = p.restRemainingSec;
  p.startRest(); // 重复调用不应缩短剩余时间
  assert.ok(p.restRemainingSec >= Math.min(first, 600) - 1);
  assert.equal(p.playedSec, 0); // 起点已重置
  // 已持久化
  const saved = JSON.parse(storage.get('knowledge-mow-king.playtime.v1')!);
  assert.ok(saved.restUntil > Date.now());
});

test('finishRest 清空休息并重新计时', () => {
  const p = fresh({ sessionStart: Date.now(), restUntil: Date.now() + 60_000 });
  p.finishRest();
  assert.equal(p.shouldRest, false);
  assert.equal(p.restRemainingSec, 0);
  assert.ok(p.playedSec <= 1);
});

test('损坏的持久化记录静默回退为「刚开局」', () => {
  storage.clear();
  storage.set('knowledge-mow-king.playtime.v1', '{not-json');
  const p = new PlaytimeSystem();
  p.bind(settings);
  p.load();
  assert.equal(p.shouldRest, false);
  assert.ok(p.playedSec <= 5);
});

test('sessionLimitMin 边界：恰好 30 分钟即触发（≥ 语义）', () => {
  const p = fresh({ sessionStart: Date.now() - 30 * 60_000, restUntil: 0 });
  assert.equal(p.shouldRest, true);
});
