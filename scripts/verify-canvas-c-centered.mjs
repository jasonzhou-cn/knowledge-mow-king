/**
 * 方案 C UI 居中验证（scripts/verify-canvas-c-centered.mjs）
 * 模拟窄屏视口（接近 1024x540，像手机浏览器去掉 UI 后的实际渲染区），
 * 截图三个场景，验证 UI 真正居中、铺满、合理布局。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5180/';
const OUT = 'reports/canvas-c-centered';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9368 });
const page = await newPage(9368, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 模拟手机浏览器去 UI 后的视口（接近你的截图比例）
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1024, height: 540, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
  screenWidth: 1024, screenHeight: 540,
});

await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 1, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

await page.send('Page.navigate', { url: URL });
await sleep(3500);

console.log('=== MenuScene 截图 ===');
await page.shot(path.join(OUT, 'menu-1024x540.png'));

// 空格进答题
await page.key(' ', 'Space', 32, 80);
await sleep(2200);
for (let i = 0; i < 10; i++) {
  await sleep(250);
  await page.key(' ', 'Space', 32, 60);
  await sleep(1100);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
  if (sc === 'GrassCuttingScene') break;
  await sleep(1000);
}
await sleep(800);

console.log('=== 答题场景截图 ===');
await page.shot(path.join(OUT, 'question-1024x540.png'));

// 等待进入割草
for (let i = 0; i < 8; i++) {
  await sleep(250);
  await page.key(' ', 'Space', 32, 60);
  await sleep(1100);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
  if (sc === 'GrassCuttingScene') break;
  await sleep(1200);
}
await sleep(1200);
console.log('=== 割草场景截图 ===');
await page.shot(path.join(OUT, 'grass-1024x540.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
console.log('\n截图路径:', path.resolve(OUT));

await closePage(9368, page.id); page.close(); browser.proc.kill(); process.exit(0);