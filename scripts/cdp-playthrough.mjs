/**
 * 无头实机主循环回归（scripts/cdp-playthrough.mjs）
 * 不依赖 puppeteer/playwright，直接驱动本机 Edge。
 * 通过截图 + Phaser 内部状态钩子（main.ts 在构建时临时暴露 window.__game__）
 * 验证：菜单 → 答题 → 割草 三阶段切换，以及武器切换/攻击生效。
 * 用法：node scripts/cdp-playthrough.mjs [outDir]
 */

import fs from 'node:fs';
import path from 'node:path';
import { serveDir, launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const OUT = process.argv[2] || 'reports/cdp';
const DIST = 'dist-cdp2';
const WIDTH = 960;
const HEIGHT = 640;

fs.mkdirSync(OUT, { recursive: true });

const server = await serveDir(path.resolve(DIST));
const browser = await launchBrowser({ port: 9351 });
const page = await newPage(9351, server.url);

const errors = [];
const logs = [];
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
page.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
      .join(' ');
    const line = `[console.${msg.params.type}] ${text}`;
    logs.push(line);
    if (msg.params.type === 'error') errors.push(line);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const line = `[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`;
    errors.push(line);
    logs.push(line);
  }
  if (msg.method === 'Log.entryAdded') {
    const { level, text, source } = msg.params.entry;
    if (level === 'error' || level === 'warning') {
      errors.push(`[log.${level}] ${text} ${source ? `(${source})` : ''}`);
    }
  }
});

await page.send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});

function sleepMs(ms) {
  return sleep(ms);
}

async function snap(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.shot(file);
  console.log('截图:', file);
  return file;
}

async function info() {
  return await page.evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = document.getElementById('fatal-error');
    return {
      title: document.title,
      url: location.href,
      canvas: c ? { width: c.width, height: c.height } : null,
      fatalVisible: r ? (r.style.display !== 'none' && getComputedStyle(r).display !== 'none') : false,
    };
  })()`);
}

/** 通过 window.__game__ 钩子读取当前 Phaser 场景关键状态 */
async function gameState() {
  try {
    return await page.evaluate(`(() => {
      const game = window.__game__;
      if (!game) return { ok: false, reason: 'no __game__ hook' };
      const scenes = game.scene.scenes;
      const active = scenes.find(s => s && s.scene && s.scene.settings && s.scene.settings.active && s.scene.isActive());
      const key = active?.scene?.key || 'none';
      const ws = active?.weaponSystem;
      const bar = active?.weaponBar;
      const proj = active?.projectiles;
      const spawner = active?.spawner;
      return {
        ok: true,
        scene: key,
        weapon: ws ? { index: ws.currentIndex, name: ws.current.name } : null,
        bar: bar ? { index: bar.currentIndex } : null,
        projectiles: proj ? proj.aliveCount : -1,
        monsters: spawner ? { alive: spawner.monsters.filter(m => m.alive).length, total: spawner.monsters.length } : null,
      };
    })()`);
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

async function waitForScene(targetKey, timeoutMs = 30000, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await gameState();
    if (s.ok && s.scene === targetKey) return s;
    await sleepMs(stepMs);
  }
  return await gameState();
}

async function waitStableScene(stepMs = 300) {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const s = await gameState();
    if (s.ok && s.scene && s.scene === prev) return s;
    prev = s.ok ? s.scene : prev;
    await sleepMs(stepMs);
  }
  return await gameState();
}

console.log('--- 阶段 1：菜单 ---');
await sleepMs(3000);
console.log('页面:', JSON.stringify(await info()));
console.log('场景:', JSON.stringify(await gameState()));
await snap('01-menu');

console.log('--- 阶段 2：空格进入答题 ---');
await page.key(' ', 'Space', 32);
const questionState = await waitForScene('QuestionScene', 10000);
console.log('答题场景:', JSON.stringify(questionState));
await snap('02-question');

console.log('--- 阶段 3：空格连续答题，直到进入割草 ---');
for (let i = 0; i < 40; i++) {
  await page.key(' ', 'Space', 32);
  await sleepMs(700);
  const s = await gameState();
  if (s.ok && s.scene === 'GrassCuttingScene') {
    console.log('已进入割草:', JSON.stringify(s));
    break;
  }
  if (i === 15) {
    console.log('答题中（ midway ）:', JSON.stringify(s));
    await snap('03-question-midway');
  }
}
const grassEnter = await waitStableScene();
console.log('割草进入状态:', JSON.stringify(grassEnter));
await snap('04-grasscutting-enter');

console.log('--- 阶段 4：大刀普攻 + 切换 SMG + 切换霰弹枪 ---');
// 大刀普攻一次，确认出手（顿帧）
await page.key('J', 'KeyJ', 74);
await sleepMs(300);
console.log('大刀后:', JSON.stringify(await gameState()));

// 数字键 2 切 SMG
console.log('按 2 切 SMG');
await page.key('2', 'Digit2', 50);
await sleepMs(300);
let st = await gameState();
console.log('按 2 后状态:', JSON.stringify(st));
await snap('05-after-key2');

// 开火 SMG
for (let i = 0; i < 10; i++) {
  await page.key('J', 'KeyJ', 74);
  await sleepMs(120);
}
st = await gameState();
console.log('SMG 连发后:', JSON.stringify(st));
await snap('06-grasscutting-smg');

// 数字键 3 切霰弹
console.log('按 3 切霰弹枪');
await page.key('3', 'Digit3', 51);
await sleepMs(300);
st = await gameState();
console.log('按 3 后状态:', JSON.stringify(st));
await snap('07-after-key3');
for (let i = 0; i < 4; i++) {
  await page.key('J', 'KeyJ', 74);
  await sleepMs(300);
}
st = await gameState();
console.log('霰弹开火后:', JSON.stringify(st));
await snap('08-grasscutting-scatter');

// 测试武器栏点击切回 1
console.log('点击武器栏槽位 1');
await page.click(366, 602);
await sleepMs(300);
st = await gameState();
console.log('点击槽 1 后:', JSON.stringify(st));
await snap('09-bar-click-slot1');

console.log('--- 阶段 5：等待关卡结束，验证结算场景 ---');
await sleepMs(55000); // 等待时间耗尽或死亡触发结算
st = await gameState();
console.log('结算前状态:', JSON.stringify(st));
await snap('10-result-or-gameover');

console.log('--- 控制台异常汇总 ---');
if (errors.length === 0) {
  console.log('无 error 级别日志');
} else {
  console.log(`发现 ${errors.length} 条 error：`);
  for (const e of errors) console.log('  ' + e);
}

console.log('--- 全部 console 输出（仅最后 30 条）---');
for (const l of logs.slice(-30)) console.log('  ' + l);

await closePage(9351, page.id);
page.close();
browser.proc.kill();
await server.close();
process.exit(0);
