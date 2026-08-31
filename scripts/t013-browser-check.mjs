/**
 * T-013-A 浏览器侧验证（scripts/t013-browser-check.mjs）
 * 目的有两个：
 *  ① 回归：改动 SfxController 后，游戏仍能正常启动、答题、进入割草并击杀（无控制台异常）
 *  ② 旁路确认：统计页面内 createOscillator 的调用次数，验证当前是否真的有音效在播
 * 结果写入 reports/t010/browser-t013.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { serveDir, launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const OUT_DIR = 'reports/t010';
const DIST = 'dist-t013';
const lines = [];
const log = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = await serveDir(path.resolve(DIST));
const browser = await launchBrowser({ port: 9361 });
const page = await newPage(9361, server.url);

const errors = [];
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text);
  }
});

// 在任何页面脚本运行之前挂上振荡器计数器
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__osc = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && AC.prototype) {
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () {
        window.__osc++;
        return orig.apply(this, arguments);
      };
    }
  `,
});

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 960,
  height: 640,
  deviceScaleFactor: 1,
  mobile: false,
});

async function state() {
  return await page.evaluate(`(() => {
    const d = window.__KB_DEBUG__;
    if (!d) return { scene: 'no-handle' };
    return { scene: d.scene, kills: d.kills, weapon: d.weaponIndex, hp: d.hp, osc: window.__osc };
  })()`);
}

await sleep(3500);
log('[0] 启动后状态:', await state());

// 空格推进：菜单 → 答题 → 割草
let entered = false;
for (let i = 0; i < 40; i++) {
  await page.key(' ', 'Space', 32);
  await sleep(700);
  const s = await state();
  if (s.scene === 'GrassCuttingScene') {
    log('[1] 已进入割草场景，第', i + 1, '次空格');
    entered = true;
    break;
  }
}
if (!entered) log('[1] !! 未能进入割草场景');
await sleep(800);
const atStart = await state();
log('[2] 进入割草时:', atStart);

// 切到机关枪（射速最快），按住 J 连续开火并绕圈走位
await page.key('2', 'Digit2', 50);
await sleep(300);
log('[3] 已切到武器索引:', (await state()).weapon);

await page.keyDown('J', 'KeyJ', 74);
const moveSeq = [
  ['W', 'KeyW', 87],
  ['D', 'KeyD', 68],
  ['S', 'KeyS', 83],
  ['A', 'KeyA', 65],
];
for (let round = 0; round < 45; round++) {
  const [k, c, code] = moveSeq[round % moveSeq.length];
  await page.keyDown(k, c, code);
  await sleep(700);
  await page.keyUp(k, c, code);
  const st = await state();
  if (st.scene !== 'GrassCuttingScene') {
    log('[4] 第', round, '轮移动时已离开割草场景:', st.scene);
    break;
  }
}
await page.keyUp('J', 'KeyJ', 74);

const atEnd = await state();
log('[5] 结束时:', atEnd);
log('[6] 期间击杀数 =', (atEnd.kills ?? 0) - (atStart.kills ?? 0));
log('[7] 期间 createOscillator 次数 =', (atEnd.osc ?? 0) - (atStart.osc ?? 0),
    '（为 0 说明当前无任何代码调用 sfx.play）');
log('[8] 控制台异常:', errors.length === 0 ? '无' : errors);

fs.writeFileSync(path.join(OUT_DIR, 'browser-t013.txt'), lines.join('\n') + '\n', 'utf8');

await page.shot(path.join(OUT_DIR, 't013-grass.png'));
await closePage(9361, page.id);
page.close();
browser.proc.kill();
await server.close();
process.exit(0);
