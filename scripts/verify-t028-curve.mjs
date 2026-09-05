/**
 * T-028 实测 2：20 关难度曲线批量实测（P0-3）
 * 代表关：L1（基线）/ L5 / L10 / L14 / L17 / L20（全部 5 个 Boss 关）。
 * 统一条件：同一「会走位会攻击、答题靠乱按」的机器人；游戏时长压缩 15s（运行时改配置）；
 * DDA 保持开启（当前正式行为）。每关采集：正确率 / 伤害加成 / 峰值同屏怪 / 击杀 / 剩余HP / 结局。
 * 目的：横向对比各关压力曲线是否合理（L20 相对 L1 的压力倍数），并验证 L17 喘息关（scale=1.0）。
 */

import fs from 'node:fs';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const SHOTS = 'reports/t028-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const PORT = 9378;
const browser = await launchBrowser({ port: PORT, width: 1152, height: 648 });
const page = await newPage(PORT, 'http://127.0.0.1:5174/');
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Page.bringToFront');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1152, height: 648, deviceScaleFactor: 1, mobile: false });

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
    if ((await activeSceneKey()) === key) return true;
    await sleepMs(300);
  }
  return false;
}

async function runLevel(level) {
  await page.evaluate(`localStorage.clear()`);
  await page.evaluate(`location.reload()`);
  await sleepMs(400);
  await page.send('Page.bringToFront');
  await waitForScene('MenuScene', 30000);
  await sleepMs(800);

  await page.evaluate(`(async () => {
    const { ConfigLoader } = await import('/src/config/ConfigLoader.ts');
    const loader = ConfigLoader.getInstance();
    const gs = loader.getConfig('gameSettings');
    gs.otherSettings.minGameTimeLimit = 3;
    const lv = loader.getConfig('levelConfig');
    const entry = lv.levels.find(l => l.level === ${level});
    if (entry) entry.gameTime = 15;
    const menu = window.__KB_GAME__.scene.getScene('MenuScene');
    if (menu) menu.selectedLevel = ${level};
  })()`);

  await page.key(' ', 'Space', 32, 80);
  await sleepMs(600);
  for (let i = 0; i < 5; i++) {
    if ((await activeSceneKey()) !== 'MenuScene') break;
    await page.click(576, 324);
    await sleepMs(500);
  }
  if (!(await waitForScene('QuestionScene', 20000))) throw new Error('未进入答题');

  // 答题（乱按）；高关卡题多，给足预算
  for (let i = 0; i < 150; i++) {
    await page.key(' ', 'Space', 32, 80);
    await sleepMs(300);
    if ((await activeSceneKey()) === 'GrassCuttingScene') break;
  }
  if (!(await waitForScene('GrassCuttingScene', 15000))) throw new Error('未进入割草');

  const meta = await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    const grass = g.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
    return {
      accuracy: grass && grass.data0 ? grass.data0.quiz.accuracy : null,
      dmg: grass && grass.data0 ? grass.data0.bonus.damageMultiplier : null,
      levelName: grass && grass.packed ? grass.packed.levelEntry.name : null,
      isBoss: grass && grass.packed ? grass.packed.isBossLevel : null,
    };
  })()`);

  await page.keyDown('J', 'KeyJ', 74);
  const moves = [['d', 'KeyD', 68], ['s', 'KeyS', 83], ['a', 'KeyA', 65], ['w', 'KeyW', 87]];
  let moveIdx = 0;
  let heldMove = -1;
  let peakAlive = 0;
  let hpMin = 999;
  const start = Date.now();
  let endScene = '';
  while (Date.now() - start < 240000) {
    const st = await page.evaluate(`(() => {
      const g = window.__KB_GAME__;
      const d = window.__KB_DEBUG__;
      const active = g.scene.scenes.find(s => s && s.scene && s.scene.isActive());
      return {
        activeKey: active ? active.scene.key : 'none',
        hp: d ? d.hp : null, alive: d ? d.aliveMonsters : null, kills: d ? d.kills : null,
      };
    })()`);
    if (!st || st.activeKey !== 'GrassCuttingScene') { endScene = st ? st.activeKey : 'none'; break; }
    if (typeof st.alive === 'number' && st.alive > peakAlive) peakAlive = st.alive;
    if (typeof st.hp === 'number' && st.hp < hpMin) hpMin = st.hp;
    const step = Math.floor((Date.now() - start) / 1200);
    if (step !== moveIdx) {
      if (heldMove >= 0) { const p = moves[heldMove]; await page.keyUp(p[0], p[1], p[2]).catch(() => {}); }
      const n = moves[step % 4];
      await page.keyDown(n[0], n[1], n[2]).catch(() => {});
      heldMove = step % 4;
      moveIdx = step;
    }
    await sleepMs(400);
  }
  if (heldMove >= 0) { const p = moves[heldMove]; await page.keyUp(p[0], p[1], p[2]).catch(() => {}); }
  await page.keyUp('J', 'KeyJ', 74).catch(() => {});

  const final = await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    const d = window.__KB_DEBUG__;
    const result = g.scene.getScene && g.scene.scenes.find(s => s && s.scene.key === 'ResultScene');
    return { kills: d ? d.kills : null, score: d ? d.score : null };
  })()`);

  await page.shot(`${SHOTS}/curve-L${level}.png`);
  return {
    level, name: meta.levelName, isBoss: meta.isBoss,
    accuracy: meta.accuracy, dmgMult: meta.dmg,
    outcome: endScene === 'ResultScene' ? (hpMin <= 0 ? 'died' : 'timeUp') : 'timeout-wait',
    hpMin: Math.round(hpMin * 10) / 10,
    peakAlive, kills: final.kills,
  };
}

const results = [];
for (const lv of [1, 5, 10, 14, 17, 20]) {
  console.log(`--- L${lv} ---`);
  const r = await runLevel(lv);
  results.push(r);
  console.log(JSON.stringify(r));
}

console.log('\n=== 难度曲线汇总（15s 压缩时长，同一机器人）===');
console.log('| 关卡 | 名称 | Boss | 正确率 | 伤害加成 | 峰值同屏 | 击杀 | 最低HP | 结局 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| L${r.level} | ${r.name} | ${r.isBoss ? '是' : '否'} | ${Math.round((r.accuracy ?? 0) * 100)}% | ×${r.dmgMult} | ${r.peakAlive} | ${r.kills} | ${r.hpMin} | ${r.outcome} |`);
}

await closePage(PORT, page.id);
page.close();
browser.proc.kill();
process.exit(0);
