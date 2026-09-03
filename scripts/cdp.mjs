/**
 * 极简 CDP 客户端（scripts/cdp.mjs）
 * 目的：在没有 puppeteer / playwright 的环境下，用本机 Edge + Node 22 内置 WebSocket
 *      驱动无头浏览器做实机验证。零第三方依赖。
 * 只实现本次回归需要的几个域：Page / Runtime / Input / Log / Console。
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** 起一个静态服务器，返回 { server, port, close } */
export function serveDir(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(root, urlPath);
    if (urlPath === '/' || urlPath.endsWith('/')) filePath = path.join(root, 'index.html');
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + urlPath);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** 找到本机可用的 Chromium 系浏览器 */
export function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

/** 启动无头浏览器并等待调试端口就绪 */
export async function launchBrowser({ port = 9333, width = 960, height = 640 } = {}) {
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Edge/Chrome');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-profile-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--mute-audio',
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: 'ignore', detached: false });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { proc, port, userDataDir, version: await res.json() };
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(300);
  }
  proc.kill();
  throw new Error('浏览器调试端口未就绪');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 小米设备视口模拟（2026-09-02 锁定基线）：2340×1080（19.5:9）横屏 + 触屏。
 * 所有画布相关的 CDP 验证脚本必须走此入口，禁止各自散写视口参数，
 * 避免「后续操作中画布尺寸被意外改成别的视口」。
 */
export async function emulateXiaomi(page, { width = 2340, height = 1080 } = {}) {
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
    pointer: 'coarse',
    screenWidth: width,
    screenHeight: height,
  });
}

/** CDP 会话：连接某个 target 的 websocket 并收发命令 */
export class Session {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    // 用 Target.getTargetInfo 拿 id，失败就给个占位
    return new Session(ws, 'unknown');
  }

  on(fn) {
    this.listeners.push(fn);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  /** 按下并释放一个键；keyCode 用 Phaser 监听的 windowsVirtualKeyCode */
  async key(key, code, keyCode, holdMs = 60) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await sleep(holdMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async keyDown(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  async keyUp(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 忽略 */
    }
  }
}

/** 创建一个新页面 target 并连接 */
export async function newPage(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error('创建 target 失败: ' + res.status);
  const info = await res.json();
  const session = await Session.attach(info.webSocketDebuggerUrl);
  session.id = info.id;
  session.url = url;
  return session;
}

export async function closePage(port, id) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${id}`);
  } catch {
    /* 忽略 */
  }
}
