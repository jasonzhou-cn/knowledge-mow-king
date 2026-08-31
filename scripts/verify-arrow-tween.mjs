/**
 * 游标平滑移动确认（scripts/verify-arrow-tween.mjs）
 * 0.08s 间隔连截 10 张，覆盖一次滑动（~0.45s）+ 后续停驻，捕捉游标在卡片
 * 之间的「中途位置」作为平滑 tween 的视觉证据。
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/arrow-tween';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9363 });
const page = await newPage(9363, 'about:blank');
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
await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: true });

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
await page.key(' ', 'Space', 32, 80);
await sleep(2000);

// 等 1.0s 进入稳定阶段（游标停在 0.8），再开始密截
await sleep(1000);

for (let i = 0; i < 10; i++) {
  await page.shot(path.join(OUT, `t-${String(i).padStart(2, '0')}.png`));
  await sleep(80);
}

console.log('10 张密截图（每 0.08s）保存至 reports/arrow-tween/');
console.log('期望：游标从「0.8 卡片正上方」平滑滑向「0.75 卡片正上方」，中间帧可见游标在两张卡片之间');
if (errors.length) console.log('异常:', errors.join('; '));
await closePage(9363, page.id); page.close(); browser.proc.kill(); process.exit(0);