/**
 * T-013-A 音效节流实测（scripts/t013-sfx-throttle.mjs）
 *
 * 背景：SfxController 目前在全项目零调用点，靠正常试玩测不到。
 * 因此本脚本用 esbuild 把真实的 src/systems/SfxController.ts 转译后直接 import，
 * 注入假的 AudioContext 计数 createOscillator 调用次数，在 Node 里精确测量节流行为。
 *
 * 判定口径：
 *   请求数（play 调用次数） vs 实际起振数（createOscillator 次数）
 *   + 相邻两次实际起振的最小间隔是否 ≥ 配置阈值
 * 结果写入 reports/t010/sfx-throttle.txt
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const OUT = join(projectRoot, 'reports', 't010', 'sfx-throttle.txt');
const lines = [];
const log = (...a) => {
  lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
};

// ── 假 AudioContext：只统计 createOscillator 与起振时刻 ──
let oscCount = 0;
const oscStarts = [];
const oscFreqs = [];

class FakeParam {
  setValueAtTime(v) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}
class FakeOsc {
  constructor() {
    this.type = 'sine';
    this.frequency = new FakeParam();
  }
  connect() {}
  start() {
    oscCount++;
    oscStarts.push(performance.now());
    oscFreqs.push(this.frequency.value);
  }
  stop() {}
}
class FakeGain {
  constructor() {
    this.gain = new FakeParam();
  }
  connect() {}
}
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {}
  createOscillator() {
    return new FakeOsc();
  }
  createGain() {
    return new FakeGain();
  }
}

globalThis.window = { AudioContext: FakeAudioContext };

const workDir = mkdtempSync(join(tmpdir(), 'kb-sfx-'));
const outFile = join(workDir, 'sfx.mjs');
await build({
  entryPoints: [join(projectRoot, 'src', 'systems', 'SfxController.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const { sfx } = await import(pathToFileURL(outFile).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KILL_MS = 70; // 与 SfxController.DEFAULT_MIN_INTERVAL_MS.kill 一致

/**
 * 清空计数并等待足够长时间，让上一个用例留下的 lastPlayedAt 滑出节流窗口。
 * 不加这段的话用例之间会互相串扰（上一个用例的最后一次播放还落在 70ms 内）。
 */
async function reset() {
  await sleep(120);
  oscCount = 0;
  oscStarts.length = 0;
  oscFreqs.length = 0;
}

/** 相邻起振的最小间隔 */
function minGap() {
  let m = Infinity;
  for (let i = 1; i < oscStarts.length; i++) {
    m = Math.min(m, oscStarts[i] - oscStarts[i - 1]);
  }
  return oscStarts.length < 2 ? null : +m.toFixed(2);
}

log('=== T-013-A 音效节流实测 ===');
log('阈值来源：SfxController.DEFAULT_MIN_INTERVAL_MS（未 bind 配置时的兜底表）');
log('kill = 70ms（与 DEFAULT_MIN_INTERVAL_MS.kill 一致）');
log('');

// ── 用例 1：同帧爆发（霰弹枪 5 颗弹丸同帧击杀 5 只）──
await reset();
for (let i = 0; i < 5; i++) sfx.play('kill');
log('[用例1 同帧爆发] 请求 5 次 kill（同步连发，间隔 ~0ms）');
log('  实际起振 =', oscCount, ' 期望 = 1  判定 =', oscCount === 1 ? 'PASS' : 'FAIL');
log('');

// ── 用例 2：持续连杀 5 杀/秒（间隔 200ms，实测节奏）──
await reset();
const N2 = 25;
for (let i = 0; i < N2; i++) {
  sfx.play('kill');
  await sleep(200);
}
log('[用例2 持续连杀] 请求', N2, '次 kill，间隔 200ms（≈5 杀/秒，实测节奏）');
log('  实际起振 =', oscCount, ' 期望 =', N2, '（不应被压）  判定 =', oscCount === N2 ? 'PASS' : 'FAIL');
log('  相邻起振最小间隔 =', minGap(), 'ms（阈值 70ms）');
log('');

// ── 用例 3：极限连杀 20 杀/秒（间隔 50ms，压力测试）──
await reset();
const N3 = 60;
for (let i = 0; i < N3; i++) {
  sfx.play('kill');
  await sleep(50);
}
log('[用例3 极限连杀] 请求', N3, '次 kill，间隔 50ms（20 杀/秒）');
log('  实际起振 =', oscCount, ' 抑制率 =', `${(((N3 - oscCount) / N3) * 100).toFixed(1)}%`);
log('  相邻起振最小间隔 =', minGap(), 'ms（阈值 70ms，应恒 >= 70）');
const gaps = [];
for (let i = 1; i < oscStarts.length; i++) gaps.push(oscStarts[i] - oscStarts[i - 1]);
log('  违反 70ms 阈值的间隔数 =', gaps.filter((g) => g < KILL_MS - 0.5).length, '（期望 0）');
log('');

// ── 用例 4：不同音效互不干扰（击杀受伤同帧）──
await reset();
sfx.play('kill');
sfx.play('hurt');
log('[用例4 跨音效] 同帧 kill + hurt 各 1 次');
log('  实际起振 =', oscCount, ' 期望 = 2（不同音效不互相压制）  判定 =', oscCount === 2 ? 'PASS' : 'FAIL');
log('  起振频率 =', oscFreqs, '（880=kill, 240=hurt）');
log('');

// ── 用例 5：bind({kill:0}) 可关闭节流（证明阈值真的来自配置注入）──
await reset();
sfx.bind({ minIntervalMs: { kill: 0 } });
for (let i = 0; i < 5; i++) sfx.play('kill');
log('[用例5 配置生效] bind({kill:0}) 后同帧连发 5 次');
log('  实际起振 =', oscCount, ' 期望 = 5（阈值为 0 即不节流）  判定 =', oscCount === 5 ? 'PASS' : 'FAIL');
log('');

// ── 用例 6：bind 回 70ms 后恢复节流 ──
await reset();
sfx.bind({ minIntervalMs: { kill: 70 } });
for (let i = 0; i < 5; i++) sfx.play('kill');
log('[用例6 配置生效] bind({kill:70}) 后同帧连发 5 次');
log('  实际起振 =', oscCount, ' 期望 = 1  判定 =', oscCount === 1 ? 'PASS' : 'FAIL');

writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
process.exit(0);
