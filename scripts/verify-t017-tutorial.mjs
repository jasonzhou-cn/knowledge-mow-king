/**
 * T-017 新手引导验证（scripts/verify-t017-tutorial.mjs）
 * dev 模式验证：
 *  1. 首次进入（无存档）→ 点「开始答题」→ 出现 3 步引导（截图验证文案）
 *  2. 连点 3 次 → 进入 QuestionScene，localStorage 已标记 done
 *  3. 返回菜单再次点开始 → 直接进 QuestionScene（不再显示引导）
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = 'reports/t017-tutorial';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9378 });
const page = await newPage(9378, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 472, deviceScaleFactor: 1, mobile: true });

// 不注入存档 → 全新玩家（首次引导应出现）
await page.send('Page.navigate', { url: URL });
await sleep(3500);

// 点「开始答题」按钮（菜单按钮位置：w/2, cy+104*s 附近，先截图定位）
await page.shot(path.join(OUT, 'menu-fresh.png'));
// 空格也能触发（zone 有 pointerdown 但键盘无绑定；菜单按钮用指针点击更稳）
// 按钮中心估算：h=472, s=clamp(472/500,0.72,1)=0.944, btnY = h/2 + 104*0.944 ≈ 236+98 = 334
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 512, y: 334, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 512, y: 334, button: 'left', clickCount: 1 });
await sleep(1500);

// 引导出现？截图步骤 1
const hasOverlay = await page.evaluate(`(() => {
  const s = window.__KB_GAME__;
  const active = s && s.scene ? s.scene.scenes.filter(w => w.sys && w.sys.settings && w.sys.settings.status === 3).map(w => w.key) : [];
  return active;
})()`);
console.log('点击开始后活跃场景:', JSON.stringify(hasOverlay), '（应为 MenuScene=引导在菜单内展示）');
await page.shot(path.join(OUT, 'tutorial-step1.png'));

// 连点 3 次走完引导
for (let i = 0; i < 3; i++) {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 512, y: 236, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 512, y: 236, button: 'left', clickCount: 1 });
  await sleep(800);
  if (i === 0) await page.shot(path.join(OUT, 'tutorial-step2.png'));
  if (i === 1) await page.shot(path.join(OUT, 'tutorial-step3.png'));
}
await sleep(1500);

// 应已进入 QuestionScene
const active2 = await page.evaluate(`(() => {
  const g = window.__KB_GAME__;
  return g.scene.scenes.filter(w => w.sys && w.sys.settings && w.sys.settings.status === 3).map(w => w.key);
})()`);
console.log('引导完成后活跃场景:', JSON.stringify(active2));
const tutDone = await page.evaluate(`localStorage.getItem('knowledge-mow-king.tutorial.v1')`);
console.log('tutorial flag:', tutDone);
await page.shot(path.join(OUT, 'after-tutorial-question.png'));

// 返回菜单验证二次进入不显示引导：直接 reload（存档仍在，unlockedLevel=1）
await page.send('Page.reload');
await sleep(3500);
const active3 = await page.evaluate(`(() => { const g = window.__KB_GAME__; return g.scene.scenes.filter(w => w.sys && w.sys.settings && w.sys.settings.status === 3).map(w => w.key); })()`);
console.log('reload 后活跃场景:', JSON.stringify(active3), '（应为 MenuScene）');
// 再点开始 → 应直接进 QuestionScene
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 512, y: 334, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 512, y: 334, button: 'left', clickCount: 1 });
await sleep(1800);
const active4 = await page.evaluate(`(() => { const g = window.__KB_GAME__; return g.scene.scenes.filter(w => w.sys && w.sys.settings && w.sys.settings.status === 3).map(w => w.key); })()`);
console.log('二次点击开始后活跃场景:', JSON.stringify(active4), tutDone === 'done' && active4.includes('QuestionScene') ? '✓ 不再显示引导' : '⚠️ 二次仍显示或未进入');
await page.shot(path.join(OUT, 'second-entry-question.png'));

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
await closePage(9378, page.id); page.close(); browser.proc.kill(); process.exit(0);