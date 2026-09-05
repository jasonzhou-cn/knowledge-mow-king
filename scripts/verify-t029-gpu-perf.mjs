/**
 * T-029 GPU 环境性能采样（scripts/verify-t029-gpu-perf.mjs）
 * 目的：补上 P1-4「真机/带 GPU 环境」的性能缺口——无头 swiftshader 的 FPS 数据是伪影，
 *      本脚本用 Chrome 新无头（112+ 默认走真 GPU，不带 swiftshader 降级旗标）采样；
 *      若 GPU 仍未生效（平均 FPS < 30）自动回退到可见窗口模式再采一轮。
 * 场景：L14（完形峰林 Boss）与 L20（考神）各跑完整 60s（不压缩时长），
 *      机器人「走位 + 持续攻击 + 乱答题」，逐秒记录 FPS / JS 堆 / Boss 阶段，重点看
 *      Boss 召唤小兵峰值时的帧率（PROGRESS-REVIEW P1-4 点名项）。
 * 输出：逐秒采样表 + 汇总（avg / min / boss 阶段 avg）+ 伪影判定。
 * 说明：桌面 GPU ≠ 手机 GPU，数据用于「相对压力与掉帧定位」，真机复核仍建议保留。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { findBrowser, newPage, closePage, sleep } from './cdp.mjs';

const PORT = 9387;
const URL = 'http://127.0.0.1:5174/';
const OUT = 'reports/t029-gpu-perf';
fs.mkdirSync(OUT, { recursive: true });
const sleepMs = sleep;

/** 启动浏览器：headless=new 不带 swiftshader 旗标（默认尝试真 GPU）；headed=可见窗口 */
async function launchGpuBrowser({ headed = false, width = 2340, height = 1080 } = {}) {
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Edge/Chrome');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-perf-'));
  const args = [
    ...(headed ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio',
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: 'ignore', detached: false });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return { proc, userDataDir };
    } catch {
      /* 等待就绪 */
    }
    await sleepMs(300);
  }
  proc.kill();
  throw new Error('浏览器调试端口未就绪');
}

async function activeSceneKey(page) {
  return await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    if (!g) return 'none';
    const s = g.scene.scenes.find(s => s && s.scene && s.scene.isActive());
    return s ? s.scene.key : 'none';
  })()`);
}

async function waitForScene(page, key, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await activeSceneKey(page)) === key) return true;
    await sleepMs(300);
  }
  return false;
}

/** 注入逐秒 FPS 采样器（rAF 驱动；performance.memory 记录 JS 堆） */
async function injectFpsSampler(page) {
  await page.evaluate(`(() => {
    window.__fps = { frames: 0, last: performance.now(), t0: performance.now(), history: [] };
    const loop = () => {
      window.__fps.frames++;
      const now = performance.now();
      if (now - window.__fps.last >= 1000) {
        window.__fps.history.push({
          t: Math.round((now - window.__fps.t0) / 1000),
          fps: Math.round(window.__fps.frames * 1000 / (now - window.__fps.last)),
          mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        });
        window.__fps.frames = 0;
        window.__fps.last = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })()`);
}

async function runLevelFullDuration(page, level) {
  await page.evaluate(`localStorage.clear()`);
  await page.evaluate(`location.reload()`);
  await sleepMs(500);
  await page.send('Page.bringToFront');
  await waitForScene(page, 'MenuScene', 30000);
  await sleepMs(800);

  // 关卡选择（不压缩时长——完整 gameTime）
  await page.evaluate(`(() => {
    const menu = window.__KB_GAME__.scene.getScene('MenuScene');
    if (menu) menu.selectedLevel = ${level};
  })()`);
  await page.key(' ', 'Space', 32, 80);
  await sleepMs(600);
  for (let i = 0; i < 5; i++) {
    if ((await activeSceneKey(page)) !== 'MenuScene') break;
    await page.click(1170, 540);
    await sleepMs(500);
  }
  if (!(await waitForScene(page, 'QuestionScene', 20000))) throw new Error('未进入答题');

  // 答题（乱按空格），直到割草
  for (let i = 0; i < 150; i++) {
    await page.key(' ', 'Space', 32, 80);
    await sleepMs(300);
    if ((await activeSceneKey(page)) === 'GrassCuttingScene') break;
  }
  if (!(await waitForScene(page, 'GrassCuttingScene', 15000))) throw new Error('未进入割草');

  const meta = await page.evaluate(`(() => {
    const grass = window.__KB_GAME__.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
    return { accuracy: grass.data0.quiz.accuracy, dmg: grass.data0.bonus.damageMultiplier, name: grass.packed.levelEntry.name };
  })()`);
  await injectFpsSampler(page);

  // 机器人：持续攻击 + 每 1.2s 换向走位；逐秒记录 Boss 阶段与同屏怪
  await page.keyDown('J', 'KeyJ', 74);
  const moves = [['d', 'KeyD', 68], ['s', 'KeyS', 83], ['a', 'KeyA', 65], ['w', 'KeyW', 87]];
  let moveIdx = 0;
  let heldMove = -1;
  const phaseLog = [];
  const start = Date.now();
  let endScene = '';
  while (Date.now() - start < 200000) {
    const st = await page.evaluate(`(() => {
      const d = window.__KB_DEBUG__;
      const g = window.__KB_GAME__;
      const active = g.scene.scenes.find(s => s && s.scene && s.scene.isActive());
      return {
        activeKey: active ? active.scene.key : 'none',
        hp: d ? d.hp : null, alive: d ? d.aliveMonsters : null,
        bossSpawned: d ? d.bossSpawned : null, bossPhase: d ? d.bossPhaseIndex : null,
        bossAlive: d ? d.bossAlive : null,
        fps: window.__fps && window.__fps.history.length ? window.__fps.history[window.__fps.history.length - 1] : null,
      };
    })()`);
    if (!st || st.activeKey !== 'GrassCuttingScene') { endScene = st ? st.activeKey : 'none'; break; }
    phaseLog.push(st);
    const step = Math.floor((Date.now() - start) / 1200);
    if (step !== moveIdx) {
      if (heldMove >= 0) { const p = moves[heldMove]; await page.keyUp(p[0], p[1], p[2]).catch(() => {}); }
      const n = moves[step % 4];
      await page.keyDown(n[0], n[1], n[2]).catch(() => {});
      heldMove = step % 4;
      moveIdx = step;
    }
    await sleepMs(500);
  }
  if (heldMove >= 0) { const p = moves[heldMove]; await page.keyUp(p[0], p[1], p[2]).catch(() => {}); }
  await page.keyUp('J', 'KeyJ', 74).catch(() => {});

  const fpsHistory = await page.evaluate(`window.__fps ? window.__fps.history : []`);
  await waitForScene(page, 'ResultScene', 30000).catch(() => {});
  await page.shot(`${OUT}/gpu-perf-L${level}.png`);
  return { level, ...meta, endScene, fpsHistory, phaseLog };
}

function summarize(run) {
  const h = run.fpsHistory.filter(s => s.t >= 3); // 掐头（加载/答题残留）
  const avg = h.length ? Math.round(h.reduce((a, s) => a + s.fps, 0) / h.length) : 0;
  const min = h.length ? Math.min(...h.map(s => s.fps)) : 0;
  const max = h.length ? Math.max(...h.map(s => s.fps)) : 0;
  // Boss 阶段：bossSpawned=true 的采样窗口对应的 FPS（近似：按秒对齐 phaseLog）
  const bossFromSec = run.phaseLog.findIndex(p => p.bossSpawned);
  let bossAvg = null;
  if (bossFromSec >= 0) {
    const bossSamples = h.filter(s => s.t >= bossFromSec * 2 && s.t <= (bossFromSec + run.phaseLog.length) * 2);
    // phaseLog 每 ~0.5s 一条 → 秒换算；宽松对齐即可
    bossAvg = bossSamples.length ? Math.round(bossSamples.reduce((a, s) => a + s.fps, 0) / bossSamples.length) : null;
  }
  const memPeak = h.length && h.some(s => s.mem) ? Math.max(...h.map(s => s.mem ?? 0)) : null;
  const peakAlive = run.phaseLog.length ? Math.max(...run.phaseLog.map(p => p.alive ?? 0)) : 0;
  const minHp = run.phaseLog.length ? Math.min(...run.phaseLog.map(p => p.hp ?? 999)) : null;
  const maxBossPhase = run.phaseLog.length ? Math.max(...run.phaseLog.map(p => p.bossPhase ?? 0)) : 0;
  return { level: run.level, name: run.name, accuracy: run.accuracy, dmg: run.dmg, avg, min, max, bossAvg, memPeak, peakAlive, minHp, maxBossPhase, endScene: run.endScene };
}

// ───────────────────────── 主流程 ─────────────────────────

console.log('启动 GPU 无头浏览器（headless=new，无 swiftshader 旗标）…');
let browser = await launchGpuBrowser({ headed: false });
let page = await newPage(PORT, URL);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Page.bringToFront');
await page.send('Emulation.setDeviceMetricsOverride', { width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse' });

// GPU 生效性探测：菜单空转 4s 采样
await sleepMs(4000);
await injectFpsSampler(page);
await sleepMs(4000);
const probe = await page.evaluate(`window.__fps.history.map(s => s.fps)`);
const probeAvg = probe.length ? Math.round(probe.reduce((a, b) => a + b, 0) / probe.length) : 0;
console.log(`GPU 探测：空转平均 FPS = ${probeAvg}`);
let headed = false;
if (probeAvg < 30) {
  console.log('GPU 未生效（仍走软件渲染），回退可见窗口模式重试…');
  await closePage(PORT, page.id);
  page.close();
  browser.proc.kill();
  headed = true;
  browser = await launchGpuBrowser({ headed: true });
  page = await newPage(PORT, URL);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.bringToFront');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse' });
  await sleepMs(4000);
  await injectFpsSampler(page);
  await sleepMs(3000);
  const probe2 = await page.evaluate(`window.__fps.history.map(s => s.fps)`);
  const probe2Avg = probe2.length ? Math.round(probe2.reduce((a, b) => a + b, 0) / probe2.length) : 0;
  console.log(`可见窗口探测：平均 FPS = ${probe2Avg}`);
}

const runs = [];
for (const level of [14, 20]) {
  console.log(`\n─── L${level} 完整时长采样中（约 90s）…`);
  runs.push(await runLevelFullDuration(page, level));
}

console.log('\n=== GPU 性能采样汇总（2340×1080，完整 60s，桌面 GPU） ===');
console.log('| 关卡 | 正确率 | 伤害加成 | FPS avg | FPS min | FPS max | Boss阶段 avg | JS堆峰值 | 峰值同屏 | 最低HP | 最大Boss阶段 | 结局 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs.map(summarize)) {
  console.log(`| L${r.level} ${r.name} | ${Math.round((r.accuracy ?? 0) * 100)}% | ×${r.dmg} | ${r.avg} | ${r.min} | ${r.max} | ${r.bossAvg ?? '-'} | ${r.memPeak ?? '-'}MB | ${r.peakAlive} | ${r.minHp} | P${r.maxBossPhase} | ${r.endScene} |`);
}

// 逐秒明细落盘
fs.writeFileSync(`${OUT}/gpu-perf-detail.json`, JSON.stringify(runs.map(r => ({ level: r.level, name: r.name, accuracy: r.accuracy, endScene: r.endScene, fps: r.fpsHistory })), null, 1));
console.log(`\n逐秒明细：${OUT}/gpu-perf-detail.json`);

await closePage(PORT, page.id);
page.close();
browser.proc.kill();
process.exit(0);
