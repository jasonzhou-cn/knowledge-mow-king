/**
 * 游标平滑移动验证（scripts/verify-arrow-smooth.mjs）
 * 进第 1 关答题后，以 0.25s 间隔连截 6 张图，覆盖一次游标滑动全程——
 * 若游标在卡片之间出现「中途位置」（既不在 20 也不在 60 的正上方），
 * 证明是平滑 tween 移动而非瞬间跳格。
 * 用法：node scripts/verify-arrow-smooth.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/arrow-smooth';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9362 });
const page = await newPage(9362, 'about:blank');

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

// MenuScene → 空格开始答题
await page.key(' ', 'Space', 32, 80);
await sleep(2000);

// 从第 0 次滑动开始捕捉：先等一个 interval（1.2s）让第一次滑动进行到中途附近
await sleep(1000);

const files = [];
for (let i = 0; i < 6; i++) {
  const f = path.join(OUT, `frame-${i}.png`);
  await page.shot(f);
  files.push(f);
  await sleep(250);
}

console.log('=== 截图序列（每张间隔 0.25s）===');
files.forEach((f, i) => console.log(`  frame-${i}: ${f}`));
console.log('判断：观察金色游标框 + ▼ 箭头是否出现在卡片之间（中途位置）→ 平滑移动');

console.log('\n=== 异常/错误 ===');
if (errors.length === 0) console.log('  （无）');
else for (const e of errors) console.log('  ' + e);

await closePage(9362, page.id);
page.close();
browser.proc.kill();
process.exit(0);