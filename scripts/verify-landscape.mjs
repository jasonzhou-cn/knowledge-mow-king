/**
 * 横屏适配验证（scripts/verify-landscape.mjs）
 * 模拟三种设备形态，检查：
 *  1. 竖屏手机（375×667, coarse）→ #rotate-overlay 可见，游戏被遮罩引导旋转
 *  2. 横屏手机（667×375, coarse）→ 遮罩隐藏，canvas 填满宽度
 *  3. 桌面（960×640, fine）→ 遮罩隐藏，正常显示
 * 用法：node scripts/verify-landscape.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5173/';
const OUT = 'reports/landscape';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9354 });
const page = await newPage(9354, 'about:blank');
const logs = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.exception?.description || d.text}`);
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');

// 先导航到游戏页面，再逐形态设置设备指标并检查
await page.send('Page.navigate', { url: DEV_URL });
await sleep(3500);

async function setDevice(width, height, mobile, pointer) {
  // 触屏模拟必须先于导航开启（与摇杆验收同一经验）：只有 setTouchEmulationEnabled
  // 才会让 matchMedia('(pointer: coarse)') 与 navigator.maxTouchPoints 生效
  if (mobile) {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile, pointer,
    screenWidth: width, screenHeight: height,
  });
  await sleep(500);
}

async function check(label, shotName) {
  const info = await page.evaluate(`(() => {
    const overlay = document.getElementById('rotate-overlay');
    const canvas = document.querySelector('canvas');
    const os = overlay ? getComputedStyle(overlay) : null;
    return {
      overlayDisplay: os ? os.display : 'NO_OVERLAY',
      overlayVisibility: os ? os.visibility : null,
      canvasW: canvas ? canvas.clientWidth : null,
      canvasH: canvas ? canvas.clientHeight : null,
      winW: window.innerWidth,
      winH: window.innerHeight,
      orient: window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
      coarse: window.matchMedia('(pointer: coarse)').matches,
    };
  })()`);
  const visible = info.overlayDisplay === 'flex';
  console.log(`[${label}] overlay=${info.overlayDisplay}(${visible ? '可见' : '隐藏'}) canvas=${info.canvasW}x${info.canvasH} win=${info.winW}x${info.winH} orient=${info.orient} coarse=${info.coarse}`);
  await page.shot(path.join(OUT, shotName));
  return { ...info, visible };
}

// 1. 竖屏手机
await setDevice(375, 667, true, 'coarse');
const p1 = await check('竖屏手机 375x667', 'portrait-phone.png');
// 2. 横屏手机
await setDevice(667, 375, true, 'coarse');
const p2 = await check('横屏手机 667x375', 'landscape-phone.png');
// 3. 桌面
await setDevice(960, 640, false, 'fine');
const p3 = await check('桌面 960x640', 'desktop.png');

console.log('\n=== 判定 ===');
console.log(`竖屏手机遮罩可见: ${p1.visible ? '✅' : '❌'}`);
console.log(`横屏手机遮罩隐藏: ${!p2.visible ? '✅' : '❌'}`);
console.log(`横屏手机 canvas 宽度≈视口宽度: ${Math.abs((p2.canvasW ?? 0) - p2.winW) < 4 ? '✅' : '❌'}`);
console.log(`桌面遮罩隐藏: ${!p3.visible ? '✅' : '❌'}`);
console.log(`桌面 canvas 全尺寸: ${p3.canvasW === 960 && p3.canvasH === 640 ? '✅' : '❌'}`);

if (logs.length) {
  console.log('\n=== 页面异常 ===');
  for (const l of logs) console.log('  ' + l);
}

await closePage(9354, page.id);
page.close();
browser.proc.kill();
process.exit(0);
