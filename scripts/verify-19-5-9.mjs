/**
 * 19.5:9 全面屏视口验证（scripts/verify-19-5-9.mjs）
 * 模拟小米手机（19.5:9 ≈ 2340x1080）横屏 viewport，
 * 检查双 canvas 方案：背景 canvas 物理 = viewport，Phaser canvas FIT 居中。
 * 截图 MenuScene 看四周是否仍有留白。
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/19-5-9';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9364 });
const page = await newPage(9364, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});

await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 触屏模拟 + 小米手机横屏（19.5:9 ≈ 2340×1080，去掉浏览器 UI 后视口 ≈ 2340×920）
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
  screenWidth: 2340, screenHeight: 1080,
});

await page.send('Page.navigate', { url: DEV_URL });
await sleep(3500);

const info = await page.evaluate(`(() => {
  const bg = document.getElementById('bg-canvas');
  const phaser = document.querySelector('#game-root canvas:not(#bg-canvas)');
  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    dpr: window.devicePixelRatio,
    bg: bg ? { cssW: bg.clientWidth, cssH: bg.clientHeight, physW: bg.width, physH: bg.height } : null,
    phaser: phaser ? { cssW: phaser.clientWidth, cssH: phaser.clientHeight, physW: phaser.width, physH: phaser.height } : null,
    canvasCount: document.querySelectorAll('canvas').length,
  };
})()`);

console.log('=== 视口 / Canvas 尺寸 ===');
console.log(`viewport: ${info.winW}x${info.winH}, dpr=${info.dpr}`);
console.log(`背景 canvas:  CSS ${info.bg?.cssW}x${info.bg?.cssH}  物理 ${info.bg?.physW}x${info.bg?.physH}`);
console.log(`Phaser canvas: CSS ${info.phaser?.cssW}x${info.phaser?.cssH}  物理 ${info.phaser?.physW}x${info.phaser?.physH}`);
console.log(`canvas 元素总数: ${info.canvasCount}`);
console.log('');
const bgCovers = info.bg && info.bg.cssW >= info.winW && info.bg.cssH >= info.winH;
console.log(`背景 canvas CSS 覆盖视口: ${bgCovers ? '✅ 是' : '❌ 否'}`);
const phaserIn = info.phaser && (info.phaser.cssW + 4 >= info.winW || info.phaser.cssH + 4 >= info.winH);
console.log(`Phaser canvas 占满某一边（FIT 按 height）: ${phaserIn ? '✅ 是' : '❌ 否（应有黑边）'}`);

// 截图 MenuScene 看整体效果
await page.shot(path.join(OUT, 'menu-19-5-9.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
console.log('\n截图:', path.resolve(OUT, 'menu-19-5-9.png'));

await closePage(9364, page.id); page.close(); browser.proc.kill(); process.exit(0);