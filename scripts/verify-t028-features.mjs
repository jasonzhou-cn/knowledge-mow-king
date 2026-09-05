/**
 * T-028 实测 3：新功能走查（小米 2340×1080 标准视口）
 *  1. 防沉迷：伪造超时记录 → 主菜单弹全屏休息遮罩 + 入口阻断 → finishRest 后恢复；
 *  2. 成就/图鉴面板：主菜单入口打开/关闭；
 *  3. BGM：menu → question → grass 轨道跟随切换（AudioContext 状态检查）；
 *  4. 穿透去重（P0-0D）：机关枪单发弹丸对同一只怪不再重复结算；
 *  5. 成就解锁链路：通关 L1 → first_clear 解锁 + 每关最佳得分落盘。
 */

import fs from 'node:fs';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const SHOTS = 'reports/t028-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9384;
const URL = 'http://127.0.0.1:5174/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launchBrowser({ port: PORT, width: 2340, height: 1080 });
const page = await newPage(PORT, URL);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Page.bringToFront');
await page.send('Emulation.setDeviceMetricsOverride', { width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse' });
const sleepMs = sleep;

async function activeSceneKey() {
  return await page.evaluate(`(() => { const g = window.__KB_GAME__; if (!g) return 'none'; const s = g.scene.scenes.find(s => s && s.scene && s.scene.isActive()); return s ? s.scene.key : 'none'; })()`);
}
async function waitForScene(key, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await activeSceneKey()) === key) return true;
    await sleepMs(300);
  }
  return false;
}

// ═══ 1. 防沉迷 ═══
console.log('\n── 防沉迷 ──');
await page.evaluate(`localStorage.clear()`);
// 预置「已连玩 31 分钟」的防沉迷记录（默认上限 30 分钟）
await page.evaluate(`localStorage.setItem('knowledge-mow-king.playtime.v1', JSON.stringify({ sessionStart: Date.now() - 31 * 60000, restUntil: 0 }))`);
await page.evaluate(`location.reload()`);
await sleepMs(500);
await page.send('Page.bringToFront');
await waitForScene('MenuScene', 30000);
await sleepMs(800);
const restState = await page.evaluate(`(() => {
  const menu = window.__KB_GAME__.scene.getScene('MenuScene');
  return { overlay: !!menu.restOverlay, blocked: menu.isBlocked() };
})()`);
check('超时后主菜单弹出全屏休息遮罩', restState.overlay && restState.blocked);
await page.shot(`${SHOTS}/feat-rest-overlay.png`);

// 遮罩期间空格 / 点击不应离开主菜单
await page.key(' ', 'Space', 32, 80);
await sleepMs(500);
await page.click(1170, 540);
await sleepMs(500);
check('遮罩期间开始/切关入口被阻断', (await activeSceneKey()) === 'MenuScene');

await page.evaluate(`(async () => {
  const { playtime } = await import('/src/systems/PlaytimeSystem.ts');
  playtime.finishRest();
})()`);
// 遮罩的关闭定时器走游戏内时钟（无头 swiftshader 下明显慢于墙钟），轮询等待
let restGone = { overlay: true, blocked: true };
for (let i = 0; i < 40; i++) {
  await sleepMs(500);
  restGone = await page.evaluate(`(() => {
    const menu = window.__KB_GAME__.scene.getScene('MenuScene');
    return { overlay: !!menu.restOverlay, blocked: menu.isBlocked() };
  })()`);
  if (!restGone.overlay) break;
}
check('finishRest 后遮罩关闭、入口恢复', !restGone.overlay && !restGone.blocked);

// ═══ 2. 成就/图鉴面板 ═══
console.log('\n── 成就/图鉴面板 ──');
// 入口按钮位置与 MenuScene.create 的公式一致（s = min(w/960, h/640)）
const achPos = await page.evaluate(`(() => {
  const w = 2340, h = 1080;
  const s = Math.min(w / 960, h / 640);
  const cx = w / 2, cy = h / 2;
  const btnW = 300 * s, btnH = 66 * s, btnY = cy + 104 * s;
  return { x: cx - btnW / 2, y: btnY + btnH + 34 * s };
})()`);
await page.click(Math.round(achPos.x), Math.round(achPos.y));
await sleepMs(700);
const panelOpen = await page.evaluate(`(() => {
  const menu = window.__KB_GAME__.scene.getScene('MenuScene');
  return { open: !!menu.achievementsPanel, blocked: menu.isBlocked() };
})()`);
check('成就·图鉴面板打开', panelOpen.open && panelOpen.blocked);
await page.shot(`${SHOTS}/feat-achievements-panel.png`);
// 说明：无头浏览器在首次交互后进入全屏（main.ts 行为），ESC 被浏览器拦截退出全屏，
// 改走用户同样可用的「关闭按钮」路径验证关闭逻辑
const closePos = await page.evaluate(`(() => {
  const w = 2340, h = 1080;
  const s = Math.min(w / 960, h / 640);
  const panelW = Math.min(w * 0.94, 1240), panelH = h * 0.88;
  const left = (w - panelW) / 2, top = (h - panelH) / 2;
  const cbW = 92 * s, cbH = 40 * s;
  return { x: left + panelW - cbW - 20 * s + cbW / 2, y: top + 16 * s + cbH / 2 };
})()`);
await page.click(Math.round(closePos.x), Math.round(closePos.y));
await sleepMs(600);
const panelClosed = await page.evaluate(`(() => {
  const menu = window.__KB_GAME__.scene.getScene('MenuScene');
  return { open: !!menu.achievementsPanel };
})()`);
check('关闭按钮关闭成就面板', !panelClosed.open);

// ═══ 3. BGM 轨道 ═══
console.log('\n── BGM ──');
await page.click(1170, 540); // 一次手势，解锁 AudioContext
await sleepMs(600);
await page.evaluate(`(async () => {
  const { bgm } = await import('/src/systems/BgmController.ts');
  bgm.play('menu');
})()`);
await sleepMs(600);
const bgmMenu = await page.evaluate(`(async () => {
  const { bgm } = await import('/src/systems/BgmController.ts');
  return { track: bgm.current, enabled: bgm.isEnabled, ctxState: bgm.ctx ? bgm.ctx.state : 'none' };
})()`);
check('BGM menu 轨道播放中（context running）', bgmMenu.track === 'menu' && bgmMenu.enabled && bgmMenu.ctxState === 'running', JSON.stringify(bgmMenu));

// ═══ 4+5. L1 通关链路（BGM 切轨 + 穿透去重 + 成就解锁） ═══
console.log('\n── L1 通关链路 ──');
await page.evaluate(`(async () => {
  const { ConfigLoader } = await import('/src/config/ConfigLoader.ts');
  const gs = ConfigLoader.getInstance().getConfig('gameSettings');
  gs.otherSettings.minGameTimeLimit = 3;
  const lv = ConfigLoader.getInstance().getConfig('levelConfig');
  const entry = lv.levels.find(l => l.level === 1);
  if (entry) entry.gameTime = 20;
  const menu = window.__KB_GAME__.scene.getScene('MenuScene');
  if (menu) menu.selectedLevel = 1;
})()`);
await page.key(' ', 'Space', 32, 80);
await sleepMs(700);
for (let i = 0; i < 5; i++) {
  if ((await activeSceneKey()) !== 'MenuScene') break;
  await page.click(1170, 540);
  await sleepMs(500);
}
if (!(await waitForScene('QuestionScene', 20000))) throw new Error('未进入答题');
const bgmQuestion = await page.evaluate(`(async () => {
  const { bgm } = await import('/src/systems/BgmController.ts');
  return bgm.current;
})()`);
check('BGM 切到 question 轨道', bgmQuestion === 'question', String(bgmQuestion));

for (let i = 0; i < 150; i++) {
  await page.key(' ', 'Space', 32, 80);
  await sleepMs(300);
  if ((await activeSceneKey()) === 'GrassCuttingScene') break;
}
if (!(await waitForScene('GrassCuttingScene', 15000))) throw new Error('未进入割草');

const bgmGrass = await page.evaluate(`(async () => {
  const { bgm } = await import('/src/systems/BgmController.ts');
  return bgm.current;
})()`);
check('BGM 切到 grass 轨道', bgmGrass === 'grass', String(bgmGrass));

// 穿透去重（P0-0D）：
// A. 确定性微测——在真实场景上另建小对象池，一发 pierce=1 弹丸正对挡道假怪；
//    修复前同一只怪会被子步进重复命中 3~7 次，修复后必须恰好 1 次。
console.log('\n── 穿透去重（P0-0D）──');
const micro = await page.evaluate(`(async () => {
  const g = window.__KB_GAME__;
  const grass = g.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
  const { ProjectileSystem } = await import('/src/systems/ProjectileSystem.ts');
  const ps = new ProjectileSystem(grass, { poolSize: 4, viewWidth: 2340, viewHeight: 1080, despawnMargin: 60 });
  const fake = (uid, x, y, r) => ({ uid, alive: true, radius: r, sprite: { x, y } });
  const hits = [];
  const hitFn = (p) => hits.push({ uid: p.monster.uid, x: Math.round(p.x) });
  // 场景 1：单怪挡道
  ps.fire({ x: 1000, y: 540, angle: 0, speed: 600, damage: 9, pierce: 1, knockback: 0, range: 900, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'micro-test' });
  ps.update(1 / 60, [fake(101, 1500, 540, 14)], hitFn);
  for (let i = 0; i < 90; i++) ps.update(1 / 60, [fake(101, 1500, 540, 14)], hitFn);
  // 场景 2：两只怪排成一列（pierce=1 应贯穿正好 2 只，各吃 1 次）
  ps.fire({ x: 1000, y: 640, angle: 0, speed: 600, damage: 9, pierce: 1, knockback: 0, range: 900, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'micro-test' });
  ps.update(1 / 60, [fake(201, 1300, 640, 14), fake(202, 1700, 640, 14)], hitFn);
  for (let i = 0; i < 90; i++) ps.update(1 / 60, [fake(201, 1300, 640, 14), fake(202, 1700, 640, 14)], hitFn);
  ps.destroy();
  return hits;
})()`);
const microByUid = {};
for (const h of micro) microByUid[h.uid] = (microByUid[h.uid] || 0) + 1;
check('微测：单怪挡道时一枚弹丸只结算 1 次（修复前 3~7 次）', (microByUid[101] || 0) === 1, JSON.stringify(microByUid));
check('微测：pierce=1 贯穿两只怪且各结算 1 次', (microByUid[201] || 0) === 1 && (microByUid[202] || 0) === 1, JSON.stringify(microByUid));

// B. 实弹抽查：真实武器路径（自动瞄准 + 真实小怪）
await page.evaluate(`(() => {
  const g = window.__KB_GAME__;
  const grass = g.scene.scenes.find(s => s && s.scene.key === 'GrassCuttingScene');
  window.__hitLog = [];
  const orig = grass.spawner.applyDamage.bind(grass.spawner);
  grass.spawner.applyDamage = (m, amount) => {
    window.__hitLog.push({ uid: m.uid, amount, t: performance.now() });
    return orig(m, amount);
  };
})()`);
let hitsSeen = 0;
let dupFound = 0;
for (let burst = 0; burst < 8; burst++) {
  await page.key('2', 'Digit2', 50, 60); // 切机关枪（pierce=1）
  await sleepMs(300);
  await page.key('J', 'KeyJ', 74, 60); // 单发点射（按住 60ms < 冷却，确保 1 发）
  await sleepMs(700);
  const log = await page.evaluate(`window.__hitLog.splice(0)`);
  const byUid = {};
  for (const h of log) byUid[h.uid] = (byUid[h.uid] || 0) + 1;
  const dups = Object.entries(byUid).filter(([, n]) => n > 1);
  if (log.length > 0) hitsSeen++;
  dupFound += dups.length;
  check(`点射 ${burst + 1}: 每只怪单发内至多结算一次`, dups.length === 0, `${log.length} 次命中 / ${Object.keys(byUid).length} 只怪${dups.length ? '，重复: ' + JSON.stringify(dups) : ''}`);
}
check('穿透去重有效性（至少一轮实际命中，非空转断言）', hitsSeen > 0, `${hitsSeen}/8 轮出现命中；重复结算 ${dupFound} 次`);

// 走位+攻击到时间结束（20s 压缩），等结算
await page.keyDown('J', 'KeyJ', 74);
const moves = [['d', 'KeyD', 68], ['s', 'KeyS', 83], ['a', 'KeyA', 65], ['w', 'KeyW', 87]];
let heldMove = -1;
let moveIdx = 0;
const start = Date.now();
while (Date.now() - start < 120000) {
  if ((await activeSceneKey()) !== 'GrassCuttingScene') break;
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
await waitForScene('ResultScene', 20000);
await sleepMs(1000);
await page.shot(`${SHOTS}/feat-result-toast.png`);

const meta = await page.evaluate(`(async () => {
  const { progression } = await import('/src/systems/ProgressionSystem.ts');
  const result = window.__KB_GAME__.scene.scenes.find(s => s && s.scene.key === 'ResultScene');
  let toastVisible = 'no-scene';
  try {
    const texts = result ? result.children.getChildren().filter(c => c.text).map(c => String(c.text)) : [];
    toastVisible = JSON.stringify(texts.filter(t => t.includes('成就解锁')));
  } catch (e) { toastVisible = 'err ' + e.message; }
  return {
    achievements: progression.meta.achievements,
    bestScore1: progression.meta.bestScores['1'] ?? null,
    totals: progression.meta.totals,
    toast: toastVisible,
    saveVersion: progression.data ? progression.data.version : null,
  };
})()`);
check('通关后 first_clear 成就解锁', (meta.achievements || []).includes('first_clear'), JSON.stringify(meta.achievements));
check('L1 最佳得分落盘（本地排行榜）', (meta.bestScore1 ?? 0) > 0, String(meta.bestScore1));
check('结算页展示成就 toast', /成就解锁/.test(String(meta.toast)), String(meta.toast).slice(0, 80));

console.log('\n── 汇总 ──');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 项通过`);
if (failed.length > 0) {
  console.log('失败项:');
  for (const f of failed) console.log('  ❌ ' + f.name + ' ' + f.detail);
}

await closePage(PORT, page.id);
page.close();
browser.proc.kill();
process.exit(failed.length === 0 ? 0 : 1);
