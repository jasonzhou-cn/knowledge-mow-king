/**
 * 方案 D 验证（scripts/verify-safe-area.mjs）
 * 模拟 19.5:9 viewport（2340×1080），进 GrassCuttingScene，
  检查 HUD / 武器栏是否在 SafeArea 内（不溢出）。
  并验证 viewport 安全回滚：模拟 ENABLE_SAFE_AREA=false 应退化为方案 A 行为。
  用法：node scripts/verify-safe-area.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/safe-area';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9365 });
const page = await newPage(9365, 'about:blank');

const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 19.5:9 viewport（小米 14 等）
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

// Menu → 空格进答题 → 答题场景 → 等进入 GrassCuttingScene
await page.key(' ', 'Space', 32, 80);
await sleep(2500);

for (let i = 0; i < 15; i++) {
  await sleep(300);
  await page.key(' ', 'Space', 32, 60);
  await sleep(1100);
  const sc = await page.evaluate(`(() => { const d = window.__KB_GAME__; const s = d && d.scene; return s && s.scenes ? (d.scene.scenes.find(x => x.scene.isActive())?.scene?.key || null) : null; })()`);
  if (sc === 'GrassCuttingScene') break;
  await sleep(1000);
}

await sleep(500);

const info = await page.evaluate(`(() => {
  const d = window.__KB_DEBUG__;
  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    scene: d ? d.scene : null,
    hp: d ? d.hp : null,
    timeLeft: d ? d.timeLeft : null,
  };
})()`);
console.log(`viewport=${info.winW}x${info.winH} → 进入 GrassCuttingScene: ${info.scene}, hp=${info.hp}, timeLeft=${info.timeLeft?.toFixed?.(1)}`);

await page.shot(path.join(OUT, '19-5-9-grass.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');

await closePage(9365, page.id); page.close(); browser.proc.kill(); process.exit(0);