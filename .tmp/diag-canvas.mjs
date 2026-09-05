/**
 * 画布现状诊断（.tmp/diag-canvas.mjs）——一次性脚本，不进仓库
 * 用 CDP 模拟小米设备（2340x1080, 19.5:9），检查 5173(dev) 与 5180(base) 的画布状态：
 * 视口、bg-canvas、Phaser canvas 的 CSS/物理尺寸 + inline style 原文（识别意外样式注入）。
 */
import { launchBrowser, newPage, closePage, sleep } from '../scripts/cdp.mjs';

const TARGETS = ['http://127.0.0.1:5173/', 'http://127.0.0.1:5180/'];

const browser = await launchBrowser({ port: 9371 });

for (const url of TARGETS) {
  const page = await newPage(9371, 'about:blank');
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
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 2340, height: 1080, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
    screenWidth: 2340, screenHeight: 1080,
  });
  await page.send('Page.navigate', { url });
  await sleep(3500);

  const info = await page.evaluate(`(() => {
    const bg = document.getElementById('bg-canvas');
    const phaser = document.querySelector('#game-root canvas:not(#bg-canvas)');
    const dump = (el) => el ? {
      cssW: el.clientWidth, cssH: el.clientHeight,
      physW: el.width, physH: el.height,
      style: el.getAttribute('style') || '',
    } : null;
    return {
      winW: window.innerWidth, winH: window.innerHeight, dpr: window.devicePixelRatio,
      dvh: { iw: window.innerWidth, ih: window.innerHeight },
      bg: dump(bg),
      phaser: dump(phaser),
      canvasCount: document.querySelectorAll('canvas').length,
      canvasModeLog: null,
    };
  })()`);
  void info.dvh;

  console.log('='.repeat(70));
  console.log(`目标: ${url}`);
  console.log(`视口: ${info.winW}x${info.winH}  dpr=${info.dpr}  canvas 元素数=${info.canvasCount}`);
  console.log(`bg-canvas   : CSS ${info.bg?.cssW}x${info.bg?.cssH}  物理 ${info.bg?.physW}x${info.bg?.physH}`);
  console.log(`  style: ${info.bg?.style}`);
  console.log(`Phaser canvas: CSS ${info.phaser?.cssW}x${info.phaser?.cssH}  物理 ${info.phaser?.physW}x${info.phaser?.physH}`);
  console.log(`  style: ${info.phaser?.style}`);
  console.log(`异常: ${errors.length ? errors.join(' | ') : '（无）'}`);

  await closePage(9371, page.id); page.close();
}

browser.proc.kill();
process.exit(0);
