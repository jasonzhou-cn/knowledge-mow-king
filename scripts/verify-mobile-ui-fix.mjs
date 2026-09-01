/**
 * 结算界面 + HUD 矮视口验证（scripts/verify-mobile-ui-fix.mjs）
 * 模拟手机 19.5:9 视口（1024×472，浏览器去 UI 后），
 * 跑完一关进结算，验证：按钮不遮挡统计文字、奖励面板完整可见。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const OUT = 'reports/mobile-ui-fix';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9372 });
const page = await newPage(9372, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');

// 手机 19.5:9 矮视口
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1024, height: 472, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
});

await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 2, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

await page.send('Page.navigate', { url: URL });
await sleep(3000);

// Menu → 空格开始 → 连按空格快速过题（miss 不消耗题数，持续按直到进割草）→ 让 HP 自然掉或等时间结束
await page.key(' ', 'Space', 32, 80);
await sleep(2200);

// 答题阶段：每 2 秒按一次空格（cursor 模式下随缘命中），最多 40 秒
for (let i = 0; i < 20; i++) {
  await page.key(' ', 'Space', 32, 60);
  await sleep(2000);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
  if (sc === 'GrassCuttingScene') break;
}
await sleep(1000);
const sc1 = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
console.log('当前场景:', sc1);

// 割草场景：等 60 秒结束或 HP 耗尽 → 结算。采样 HUD 区域截图先看缩窄效果
await page.shot(path.join(OUT, 'grass-hud.png'));

// 等待进入结算（最多 70 秒）
for (let i = 0; i < 35; i++) {
  await sleep(2000);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; return d && d.scene && d.scene.scenes ? (d.scene.scenes.find(s => s.scene.isActive())?.scene?.key) : null; })()`);
  if (sc === 'ResultScene') break;
}
await sleep(1200);
await page.shot(path.join(OUT, 'result.png'));
console.log('结算截图已存');

console.log('\\n=== 异常 ===');
console.log(errors.length ? errors.join('\\n') : '（无）');
await closePage(9372, page.id); page.close(); browser.proc.kill(); process.exit(0);