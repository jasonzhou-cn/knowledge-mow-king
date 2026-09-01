/**
 * T-019 关卡地图验证（scripts/verify-t019-level-map.mjs）
 * dev 模式：进菜单截图关卡地图（3 页 / 状态色 / 选中高亮）→ 点击卡片选关 →
 * 点翻页箭头换学科页 → 空格开始进答题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = 'reports/t019-level-map';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9379 });
const page = await newPage(9379, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 472, deviceScaleFactor: 1, mobile: true });

// 存档：unlockedLevel=14（英语区），tutorial 已完成（跳过引导）
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 5, exp: 2000, totalScore: 40000, unlockedLevel: 14, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
    localStorage.setItem('knowledge-mow-king.tutorial.v1', 'done');
  })();`,
});

await page.send('Page.navigate', { url: URL });
await sleep(3500);

// 菜单截图：关卡地图（默认选中 L14 = 英语页）
await page.shot(path.join(OUT, 'menu-level-map.png'));

// 点击第 1 页的关卡卡片（数学页，翻页到最左）
// 翻页箭头位置：左侧箭头 x = cx - totalW/2 - 28*s
// h=472, s=0.944, cx=512, perPage=8, totalW = 8*76*0.944 + 7*14*0.944 ≈ 574+92=666
// 左箭头 x ≈ 512-333-26 ≈ 153, y = cy + nodeH/2 = (236+48*0.944) + 23*0.944 ≈ 281+22 ≈ 303
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 300, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 150, y: 300, button: 'left', clickCount: 1 });
await sleep(700);
await page.shot(path.join(OUT, 'menu-math-page.png'));

// 点击第 3 关卡片（数学页第 3 个节点）：node x = startX + 2*(76+14)*s, y = cy+nodeH/2
// startX = 512 - 333 = 179; node3 x ≈ 179 + 2*90*0.944 ≈ 179+170 = 349, y ≈ 303
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 349, y: 303, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 349, y: 303, button: 'left', clickCount: 1 });
await sleep(700);
await page.shot(path.join(OUT, 'menu-select-l3.png'));

// 空格开始 → 应进入 L3（math）
await page.key(' ', 'Space', 32, 80);
await sleep(2200);
await page.shot(path.join(OUT, 'question-l3.png'));
const active = await page.evaluate(`(() => { const g = window.__KB_GAME__; return g ? g.scene.scenes.filter(x => x.sys && x.sys.isActive()).map(x => x.key) : []; })()`);
console.log('开始后活跃场景:', JSON.stringify(active));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
await closePage(9379, page.id); page.close(); browser.proc.kill(); process.exit(0);