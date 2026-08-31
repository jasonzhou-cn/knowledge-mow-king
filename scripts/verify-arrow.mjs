/**
 * 箭头模式验证（scripts/verify-arrow.mjs）
 * 间隔 1.4s 截 3 张答题场景图，观察高亮箭头是否在 4 个选项间循环跳转。
 * 同时抓所有 Runtime.exceptionThrown 确认无运行时错误。
 * 用法：node scripts/verify-arrow.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/arrow';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9361 });
const page = await newPage(9361, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(`[EXCEPTION] ${d.exception?.description || d.text}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const text = (msg.params.args || []).map((a) => a.value || a.description || a.type).join(' ');
    errors.push(`[console.error] ${text}`);
  }
});

await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 触屏模拟先开启（与横屏验证同经验）
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: true });

// 注入存档：解锁到第 1 关（够进第 1 关答题即可）
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

// MenuScene → 空格开始
await page.key(' ', 'Space', 32, 80);
await sleep(2000);

// 进入答题场景，截 3 张图（间隔 1.4s，观察箭头在 4 个选项间循环）
await page.shot(path.join(OUT, 't0-arrow-0.png'));
await sleep(1400);
await page.shot(path.join(OUT, 't1-arrow-1.png'));
await sleep(1400);
await page.shot(path.join(OUT, 't2-arrow-2.png'));

console.log('=== 截图 ===');
console.log('  reports/arrow/t0-arrow-0.png');
console.log('  reports/arrow/t1-arrow-1.png');
console.log('  reports/arrow/t2-arrow-2.png');
console.log('  （对比 3 张图：金色描边 + 顶部 ▼ 箭头应在不同选项上）');

console.log('\n=== 异常/错误 ===');
if (errors.length === 0) console.log('  （无）');
else for (const e of errors) console.log('  ' + e);

await closePage(9361, page.id);
page.close();
browser.proc.kill();
process.exit(0);