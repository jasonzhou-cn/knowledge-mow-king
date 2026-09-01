/**
 * 方案 C 实机验证（scripts/verify-canvas-c.mjs）
 * 模拟 19.5:9 全面屏视口，截图 MenuScene 对比方案 A 与方案 C 的视觉差异。
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5180/';
const OUT = 'reports/canvas-c';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9367 });
const page = await newPage(9367, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'log') {
    const text = (msg.params.args || []).map((a) => a.value || a.description).join(' ');
    if (text.includes('[KB Canvas Mode]')) console.log('日志:', text);
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 触屏模拟 + 19.5:9 viewport
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
  screenWidth: 2340, screenHeight: 1080,
});

await page.send('Page.navigate', { url: URL });
await sleep(3500);

const info = await page.evaluate(`(() => {
  const bg = document.getElementById('bg-canvas');
  const phaser = document.querySelector('#game-root canvas:not(#bg-canvas)');
  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    bg: bg ? { cssW: bg.clientWidth, cssH: bg.clientHeight, physW: bg.width, physH: bg.height } : null,
    phaser: phaser ? { cssW: phaser.clientWidth, cssH: phaser.clientHeight, physW: phaser.width, physH: phaser.height } : null,
    canvasCount: document.querySelectorAll('canvas').length,
  };
})()`);

console.log('=== 19.5:9 viewport (2340x1080) ===');
console.log(`viewport: ${info.winW}x${info.winH}`);
console.log(`canvas 元素数: ${info.canvasCount}`);
console.log(`背景 canvas: ${info.bg ? `${info.bg.cssW}x${info.bg.cssH} (物理 ${info.bg.physW}x${info.bg.physH})` : '不存在'}`);
console.log(`Phaser canvas: CSS ${info.phaser.cssW}x${info.phaser.cssH}  物理 ${info.phaser.physW}x${info.phaser.physH}`);

const phaserFill = info.phaser.cssW >= info.winW - 4 && info.phaser.cssH >= info.winH - 4;
console.log(`Phaser canvas 填满 viewport: ${phaserFill ? '✅ 是（方案 C 特征）' : '❌ 否'}`);

// 检测变形：怪物应该变椭圆（如果有怪物场景）
// 这里只截 MenuScene 给你看效果
await page.shot(path.join(OUT, 'menu-19-5-9.png'));

// 再截图割草场景看怪物变形
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 1, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

// 重新加载让存档生效
await page.send('Page.reload');
await sleep(3500);

await page.key(' ', 'Space', 32, 80);
await sleep(2500);
for (let i = 0; i < 12; i++) {
  await sleep(250);
  await page.key(' ', 'Space', 32, 60);
  await sleep(1100);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
  if (sc === 'GrassCuttingScene') break;
  await sleep(1000);
}
await sleep(800);
await page.shot(path.join(OUT, 'grass-19-5-9.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
console.log('\n截图:', path.resolve(OUT));

await closePage(9367, page.id); page.close(); browser.proc.kill(); process.exit(0);