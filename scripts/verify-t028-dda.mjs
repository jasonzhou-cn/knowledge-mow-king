/**
 * T-028 实测 1：动态难度下调（DDA）菜鸟存活验证
 * 场景：L9（最难的非 Boss math 关），「会走位会攻击但答题很菜」的模拟玩家，
 *      DDA ON / OFF 各跑一局（运行时翻转 assistSettings.enabled，不动 JSON），
 *      对比存活时间 / 剩余 HP / 死亡时间点；并采样 assistFactor 证明机制在工作。
 * 视口 1152×648（swiftshader 提速）；游戏时长压缩到 15s（运行时改 gameTime + minGameTimeLimit）。
 */

import fs from 'node:fs';
import { serveDir, launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const SHOTS = 'reports/t028-shots';
fs.mkdirSync(SHOTS, { recursive: true });

// dev 服务器（5174）由外部启动；这里直接连
const URL = 'http://127.0.0.1:5174/';
const PORT = 9377;

const browser = await launchBrowser({ port: PORT, width: 1152, height: 648 });
const page = await newPage(PORT, URL);
await page.send('Page.bringToFront');

const errors = [];
await page.send('Runtime.enable');
await page.send('Page.enable');
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  }
});

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1152, height: 648, deviceScaleFactor: 1, mobile: false,
});

const sleepMs = sleep;

async function activeSceneKey() {
  return await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    if (!g) return 'none';
    const s = g.scene.scenes.find(s => s && s.scene && s.scene.isActive());
    return s ? s.scene.key : 'none';
  })()`);
}

async function waitForScene(key, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const k = await activeSceneKey();
    if (k === key) return true;
    await sleepMs(300);
  }
  return false;
}

/** 在 MenuScene 设置运行时参数并进入指定关卡的割草阶段 */
async function runLevel({ level, assistEnabled }) {
  await page.evaluate(`localStorage.clear()`);
  await page.evaluate(`location.reload()`);
  await sleepMs(400);
  await page.send('Page.bringToFront');
  await waitForScene('MenuScene', 30000);
  await sleepMs(800);

  // 运行时参数（不动 JSON 文件）：assist 开关 + 关卡时长压缩 + 时长下限
  await page.evaluate(`(async () => {
    const { ConfigLoader } = await import('/src/config/ConfigLoader.ts');
    const loader = ConfigLoader.getInstance();
    const grass = loader.getConfig('grassCuttingConfig');
    grass.assistSettings.enabled = ${assistEnabled};
    const gs = loader.getConfig('gameSettings');
    gs.otherSettings.minGameTimeLimit = 3;
    const lv = loader.getConfig('levelConfig');
    const entry = lv.levels.find(l => l.level === ${level});
    if (entry) entry.gameTime = 15;
    // 选关到目标关（LevelSelectPanel 跟随 selectedLevel；直接改 MenuScene 内部状态 + refresh）
    const menu = window.__KB_GAME__.scene.getScene('MenuScene');
    if (menu) { menu.selectedLevel = ${level}; }
  })()`);

  // 开始答题（空格；首次有 3 步新手引导，点击跳过）
  await page.key(' ', 'Space', 32, 80);
  await sleepMs(600);
  for (let i = 0; i < 4; i++) {
    const k = await activeSceneKey();
    if (k !== 'MenuScene') break;
    await page.click(576, 324);
    await sleepMs(500);
  }
  if (!(await waitForScene('QuestionScene', 20000))) throw new Error('未进入答题');
  await sleepMs(400);

  // 答题：乱按空格（正确率天然偏低 = 菜鸟），直到进入割草
  //（高关卡题多，L20 有 15 题；350ms 节奏 + 120 次上限覆盖全部分支）
  for (let i = 0; i < 120; i++) {
    await page.key(' ', 'Space', 32, 80);
    await sleepMs(350);
    const k = await activeSceneKey();
    if (k === 'GrassCuttingScene') break;
    if (i % 20 === 19) {
      const num = await page.evaluate(`(() => { const qs = window.__QS__; return qs && qs.engine ? qs.engine.currentNumber + '/' + qs.engine.total + ':' + qs.state : 'no-qs'; })()`);
      console.log('  答题进度', num);
    }
  }
  if (!(await waitForScene('GrassCuttingScene', 15000))) throw new Error('未进入割草');

  const quizAccuracy = await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    const grass = g.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
    return grass && grass.data0 ? grass.data0.quiz.accuracy : null;
  })()`);

  // 割草：按住 J（自动瞄准攻击）+ 方向键走位（每 1.2s 换向模拟笨拙走位）
  await page.keyDown('J', 'KeyJ', 74);
  const moves = [
    ['d', 'KeyD', 68], ['s', 'KeyS', 83], ['a', 'KeyA', 65], ['w', 'KeyW', 87],
  ];
  let moveIdx = 0;
  let heldMove = -1;
  const samples = [];
  const start = Date.now();
  let ended = false;
  let endScene = '';
  while (Date.now() - start < 240000) {
    const st = await page.evaluate(`(() => {
      const g = window.__KB_GAME__;
      if (!g) return null;
      const grass = g.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
      const d = window.__KB_DEBUG__;
      const active = g.scene.scenes.find(s => s && s.scene && s.scene.isActive());
      return {
        activeKey: active ? active.scene.key : 'none',
        debugScene: d ? d.scene : null,
        hp: d ? d.hp : null, maxHp: grass ? grass.maxHp : null,
        timeLeft: d ? d.timeLeft : null,
        alive: d ? d.aliveMonsters : null,
        assist: d ? d.assistFactor : null,
        effProg: d ? d.effectiveProgress : null,
        kills: d ? d.kills : null,
      };
    })()`);
    if (!st || st.activeKey !== 'GrassCuttingScene') {
      endScene = st ? st.activeKey : 'none';
      ended = true;
      break;
    }
    samples.push(st);
    // 每 1.2s 换一个方向键
    const step = Math.floor((Date.now() - start) / 1200);
    if (step !== moveIdx) {
      if (heldMove >= 0) {
        const prev = moves[heldMove];
        await page.keyUp(prev[0], prev[1], prev[2]).catch(() => {});
      }
      const nxt = moves[step % 4];
      await page.keyDown(nxt[0], nxt[1], nxt[2]).catch(() => {});
      heldMove = step % 4;
      moveIdx = step;
    }
    await sleepMs(400);
  }
  if (heldMove >= 0) {
    const prev = moves[heldMove];
    await page.keyUp(prev[0], prev[1], prev[2]).catch(() => {});
  }
  await page.keyUp('J', 'KeyJ', 74).catch(() => {});

  const last = samples[samples.length - 1] || {};
  const died = ended && endScene === 'ResultScene' && (last.hp ?? 1) <= 0.001;
  return {
    quizAccuracy,
    survivedToEnd: !ended,
    endScene,
    samples: samples.length,
    finalHp: last.hp,
    maxHp: last.maxHp,
    finalAlive: last.alive,
    kills: last.kills,
    assistSeries: samples.filter((_, i) => i % 5 === 0).map((s) => Math.round((s.assist ?? 0) * 100) / 100),
    effProgSeries: samples.filter((_, i) => i % 5 === 0).map((s) => Math.round((s.effProg ?? 0) * 100) / 100),
    diedInRun: samples.some((s) => s.hp === 0),
  };
}

console.log('=== Run 1: DDA ON（红线 3 修复后）===');
const on = await runLevel({ level: 9, assistEnabled: true });
console.log(JSON.stringify(on, null, 1));
await page.shot(`${SHOTS}/dda-on-end.png`);

console.log('=== Run 2: DDA OFF（旧行为，纯时间驱动）===');
const off = await runLevel({ level: 9, assistEnabled: false });
console.log(JSON.stringify(off, null, 1));
await page.shot(`${SHOTS}/dda-off-end.png`);

console.log('=== 对比结论 ===');
console.log(JSON.stringify({
  on: { diedInRun: on.diedInRun, finalHp: on.finalHp, finalAlive: on.finalAlive, kills: on.kills, accuracy: on.quizAccuracy, assistAvg: on.assistSeries.reduce((a, b) => a + b, 0) / Math.max(1, on.assistSeries.length) },
  off: { diedInRun: off.diedInRun, finalHp: off.finalHp, finalAlive: off.finalAlive, kills: off.kills, accuracy: off.quizAccuracy },
}, null, 1));

console.log('=== JS 异常 ===');
console.log(errors.length === 0 ? '0 条' : errors.slice(0, 5).join('\n'));

await closePage(PORT, page.id);
page.close();
browser.proc.kill();
process.exit(0);
