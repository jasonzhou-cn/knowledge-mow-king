/**
 * 无头实机探针（scripts/cdp-probe.mjs）
 * 起静态服务器 → 拉起无头 Edge → 打开构建产物 → 收集控制台报错 → 截图。
 * 用法：node scripts/cdp-probe.mjs [outDir] [shotName]
 */

import fs from 'node:fs';
import path from 'node:path';
import { serveDir, launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const OUT = process.argv[2] || 'reports/cdp';
const SHOT = process.argv[3] || 'probe';
const DIST = 'dist-cdp';

fs.mkdirSync(OUT, { recursive: true });

const server = await serveDir(path.resolve(DIST));
const browser = await launchBrowser({ port: 9345 });
const page = await newPage(9345, server.url);

const logs = [];
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
page.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || [])
      .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
      .join(' ');
    logs.push(`[console.${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
});

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 960,
  height: 640,
  deviceScaleFactor: 1,
  mobile: false,
});

await sleep(4000);

const info = await page.evaluate(`(() => {
  const c = document.querySelector('canvas');
  return {
    title: document.title,
    canvas: c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    rootChildren: document.getElementById('game-root')?.children.length ?? -1,
  };
})()`);

const file = path.join(OUT, `${SHOT}.png`);
await page.shot(file);

console.log('页面信息:', JSON.stringify(info));
console.log('控制台输出:');
if (logs.length === 0) console.log('  （无）');
for (const l of logs) console.log('  ' + l);
console.log('截图:', path.resolve(file));

await closePage(9345, page.id);
page.close();
browser.proc.kill();
await server.close();
process.exit(0);
