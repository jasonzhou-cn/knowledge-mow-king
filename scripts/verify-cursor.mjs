/**
 * 游标模式验证（scripts/verify-cursor.mjs）
 * 进入第 1 关答题（cursor 模式默认），3 张密截图证明：
 * - 游标在卡片间持续平滑往返移动
 * - 玩家按空格停住后游标定格
 * - 停住时游标在某张卡片判定框内 → 该卡片高亮（correct/wrong）
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5180/';
const OUT = 'reports/cursor';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9369 });
const page = await newPage(9369, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 19.5:9 viewport
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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

// 进入答题
await page.key(' ', 'Space', 32, 80);
await sleep(2500);

// 截 3 张：游标在不同位置的移动
await page.shot(path.join(OUT, 'cursor-1.png'));
await sleep(400);
await page.shot(path.join(OUT, 'cursor-2.png'));
await sleep(400);
await page.shot(path.join(OUT, 'cursor-3.png'));

// 用户停住（空格）
await page.key(' ', 'Space', 32, 60);
await sleep(800);
await page.shot(path.join(OUT, 'cursor-stopped.png'));

console.log('=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
console.log('\n截图:', path.resolve(OUT));

await closePage(9369, page.id); page.close(); browser.proc.kill(); process.exit(0);