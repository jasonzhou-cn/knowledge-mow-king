/**
 * 画布锁定回归门禁（scripts/verify-canvas-lock.mjs）
 * 【锁定基线 2026-09-02】CDP 模拟小米设备 2340×1080（19.5:9）横屏：
 *  断言 Phaser canvas 的 CSS 尺寸 = 物理分辨率 = 视口（方案 C / Scale.RESIZE 铺满），
 *  inline style 由 Phaser 写入且无第三方异常注入。
 * 任何改动画布尺寸 / 比例 / 样式的提交必须先通过本门禁。
 * 用法：node scripts/verify-canvas-lock.mjs [url]   （默认 http://127.0.0.1:5173/）
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const OUT = 'reports/canvas-lock';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launchBrowser({ port: 9369 });
const page = await newPage(9369, 'about:blank');

const errors = [];
let canvasModeLog = '';
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'log') {
    const text = (msg.params.args || []).map((a) => a.value || a.description).join(' ');
    if (text.includes('[KB Canvas Mode]')) canvasModeLog = text;
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');

// 小米设备锁定基线：2340×1080（19.5:9）+ 触屏（统一入口，见 cdp.mjs emulateXiaomi）
await emulateXiaomi(page);

// 预置存档：从 L1 开始
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

const info = await page.evaluate(`(() => {
  const phaser = document.querySelector('#game-root canvas:not(#bg-canvas)');
  const dump = (el) => el ? {
    cssW: el.clientWidth, cssH: el.clientHeight,
    physW: el.width, physH: el.height,
    style: el.getAttribute('style') || '',
  } : null;
  return {
    winW: window.innerWidth, winH: window.innerHeight,
    phaser: dump(phaser),
    canvasCount: document.querySelectorAll('canvas').length,
  };
})()`);

console.log('=== 画布锁定基线（小米 2340×1080 / 19.5:9）===');
console.log(`目标: ${URL}`);
console.log(`视口: ${info.winW}x${info.winH}  canvas 元素数: ${info.canvasCount}`);
console.log(`Phaser canvas: CSS ${info.phaser?.cssW}x${info.phaser?.cssH}  物理 ${info.phaser?.physW}x${info.phaser?.physH}`);
console.log(`inline style: ${info.phaser?.style}`);
console.log(`canvas mode 日志: ${canvasModeLog}`);
console.log('');

// ── 锁定断言 ──
check('视口 = 2340x1080', info.winW === 2340 && info.winH === 1080, `${info.winW}x${info.winH}`);
check(
  'canvas CSS 尺寸 = 视口（铺满无黑边）',
  !!info.phaser && Math.abs(info.phaser.cssW - info.winW) <= 2 && Math.abs(info.phaser.cssH - info.winH) <= 2,
  `CSS ${info.phaser?.cssW}x${info.phaser?.cssH}`,
);
check(
  'canvas 物理分辨率 = 视口',
  !!info.phaser && info.phaser.physW === info.winW && info.phaser.physH === info.winH,
  `物理 ${info.phaser?.physW}x${info.phaser?.physH}`,
);
check(
  'inline style 无第三方尺寸注入（RESIZE 尺寸由 width/height 属性控制，CSS 尺寸声明即为异常）',
  !!info.phaser && !info.phaser.style.includes('width:') && !info.phaser.style.includes('height:'),
  info.phaser?.style || '（空）',
);
check('CanvasMode 日志 = c（方案 C 锁定生效）', /\] c /.test(canvasModeLog), canvasModeLog);
check('无 JS 异常', errors.length === 0, errors.join(' | ').slice(0, 200));

// ── 场景走查截图：Menu → Question → Grass ──
// 注意：生产构建无 __KB_GAME__ 句柄（DEV-only），场景识别不可用，这里按固定节奏盲拍留档。
await page.shot(path.join(OUT, 'menu-lock.png'));
await page.key(' ', 'Space', 32, 80);
await sleep(2000);
await page.shot(path.join(OUT, 'question-lock.png'));
for (let i = 0; i < 12; i++) {
  await page.key(' ', 'Space', 32, 60);
  await sleep(1100);
}
await sleep(800);
await page.shot(path.join(OUT, 'grass-lock.png'));
console.log(`\n场景走查: 截图目录 ${OUT}/（menu / question / grass）`);

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果: ${results.length - failed.length}/${results.length} 通过 ${failed.length ? '（存在失败项，画布锁定被破坏！）' : '（画布锁定完好）'} ===`);
await closePage(9369, page.id); page.close(); browser.proc.kill();
process.exit(failed.length ? 1 : 0);
