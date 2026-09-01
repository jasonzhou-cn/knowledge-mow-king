/**
 * 三模式 Canvas 适配验证（scripts/verify-canvas-modes.mjs）
 * 模拟 19.5:9 viewport（2340×1080），
 * 对比方案 A / C / D 三种 canvas 模式在 HUD 位置、黑边、变形上的表现。
 * 用法：node scripts/verify-canvas-modes.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/canvas-modes';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9366 });
const page = await newPage(9366, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
  screenWidth: 2340, screenHeight: 1080,
});

await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 1, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

await page.send('Page.navigate', { url: DEV_URL });
await sleep(3500);

const info = await page.evaluate(`(() => {
  const bg = document.getElementById('bg-canvas');
  const phaser = document.querySelector('#game-root canvas:not(#bg-canvas)');
  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    bg: bg ? { cssW: bg.clientWidth, cssH: bg.clientHeight } : null,
    phaser: phaser ? { cssW: phaser.clientWidth, cssH: phaser.clientHeight, physW: phaser.width, physH: phaser.height } : null,
    canvasCount: document.querySelectorAll('canvas').length,
  };
})()`);

const fmt = (n) => n == null ? '—' : `${n}x${Math.round((n * 1080) / 2340)}`;

console.log('=== 19.5:9 viewport (2340x1080) ===');
console.log(`viewport 物理: ${info.winW}x${info.winH}`);
console.log(`canvas 元素数: ${info.canvasCount}（A/D=2，C=1）`);
console.log(`背景 canvas: ${info.bg ? info.bg.cssW + 'x' + info.bg.cssH : '不存在（方案 C）'}`);
console.log(`Phaser canvas: CSS ${info.phaser?.cssW}x${info.phaser?.cssH}  物理 ${info.phaser?.physW}x${info.phaser?.physH}`);
const fills = info.phaser && info.phaser.cssW >= info.winW - 4 && info.phaser.cssH >= info.winH - 4;
console.log(`Phaser canvas 填满 viewport: ${fills ? '✅ 是' : '❌ 否（有黑边）'}`);

await page.shot(path.join(OUT, 'menu.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');

await closePage(9366, page.id); page.close(); browser.proc.kill(); process.exit(0);