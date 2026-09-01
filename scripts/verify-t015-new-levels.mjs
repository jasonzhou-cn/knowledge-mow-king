/**
 * T-015 新关卡实测（scripts/verify-t015-new-levels.mjs）
 * 模拟 1024×472 手机视口，存档 unlockedLevel=20：
 *  1) Menu → 左方向键选到 L9 单词溪谷（english）→ 打完整关（答题+割草+结算）
 *  2) 回菜单 → 选 L20 元素火山（science）→ 确认答题场景渲染正常
 *  3) 全程采样 FPS（P0-5 轻量性能剖析）
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const OUT = 'reports/t015-new-levels';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9373 });
const page = await newPage(9373, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1024, height: 472, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
});

await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 20, exp: 3000, totalScore: 90000, unlockedLevel: 20, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

// FPS 采样器
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__fps = { frames: 0, last: performance.now(), min: 999, samples: [] };
    const loop = (t) => {
      const f = window.__fps; f.frames++;
      if (t - f.last >= 1000) {
        const fps = Math.round(f.frames * 1000 / (t - f.last));
        f.samples.push(fps); if (fps < f.min) f.min = fps;
        f.frames = 0; f.last = t;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();`,
});

await page.send('Page.navigate', { url: URL });
await sleep(3000);

// ── L9 english 完整流程 ──
// 默认选在第 20 关（unlockedLevel），左键 11 次到第 9 关
for (let i = 0; i < 11; i++) { await page.key('ArrowLeft', 'ArrowLeft', 37, 60); await sleep(120); }
await page.shot(path.join(OUT, 'menu-l9-selected.png'));
await page.key(' ', 'Space', 32, 80);
await sleep(2200);

// 答题阶段：随缘停游标（cursor 模式），最多 45 秒
for (let i = 0; i < 22; i++) {
  await page.key(' ', 'Space', 32, 60);
  await sleep(2000);
  await page.shot(path.join(OUT, `l9-question-${i}.png`));
  const html = await page.evaluate(`document.querySelector('#game-root') ? 'ok' : 'gone'`);
  if (html !== 'ok') break;
  // 粗略检测是否进入割草：连按后场景切换无法从 DOM 判断，靠截图确认；跑到一半先截几张
  if (i === 5) { await page.shot(path.join(OUT, 'l9-mid.png')); }
}

console.log('L9 答题阶段截图已存（question-*.png）');
// 割草阶段：等 65 秒拿全程 FPS
await sleep(65000);
await page.shot(path.join(OUT, 'l9-grass-or-result.png'));
const fps = await page.evaluate(`(() => { const f = window.__fps; return { min: f.min, avg: Math.round(f.samples.reduce((a,b)=>a+b,0)/Math.max(1,f.samples.length)), samples: f.samples.length }; })()`);
console.log('FPS（L9 全程）:', JSON.stringify(fps));

// ── L20 science 快速验证 ──
// 结算后回菜单：截结算图
await page.shot(path.join(OUT, 'l9-result.png'));
// 结算按钮在底部，点「返回主菜单」（按钮 x = w/2 + 130*s, y = h-32*s）→ 直接键盘不行，ResultScene 按钮点击。用坐标点击：
// w=1024 h=472 s=Clamp(472/500,0.72,1)=0.944 → 右按钮 x=1024/2+130*0.944≈635, y=472-30≈442
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 635, y: 442, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 635, y: 442, button: 'left', clickCount: 1 });
await sleep(1500);
// 右方向键 0 次（unlockedLevel=20 默认选中 L20）→ 直接开始
await page.shot(path.join(OUT, 'menu-back.png'));
await page.key(' ', 'Space', 32, 80);
await sleep(2500);
await page.shot(path.join(OUT, 'l20-question.png'));
console.log('L20 答题截图已存');

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
await closePage(9373, page.id); page.close(); browser.proc.kill(); process.exit(0);