/**
 * T-010 测量脚本（scripts/cdp-t010.mjs）
 * 用无头 Edge 实测三件事：
 *  ① HUD「答题加成」底边与武器栏顶边的实际间隙
 *  ② 武器栏扩大后的点击热区（格心 602 / 下移后 630）是否都能切换
 *  ③ 割草 55 秒期间 KillFxSystem 三个精灵池的峰值占用（含顿帧拉伸效应）
 * 结果写入 reports/t010/measure.txt（本会话 bash stdout 不可用，只能落盘再读）
 */

import fs from 'node:fs';
import path from 'node:path';
import { serveDir, launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const OUT_DIR = 'reports/t010';
const DIST = 'dist-cdp6';
const lines = [];
function log(...args) {
  const s = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  lines.push(s);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = await serveDir(path.resolve(DIST));
const browser = await launchBrowser({ port: 9360 });
const page = await newPage(9360, server.url);

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

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 960,
  height: 640,
  deviceScaleFactor: 1,
  mobile: false,
});

async function state() {
  return await page.evaluate(`(() => {
    const g = window.__game__;
    if (!g) return { ok: false };
    const s = g.scene.scenes.find(x => x && x.scene && x.scene.isActive() && x.scene.key === 'GrassCuttingScene');
    if (!s) {
      const any = g.scene.scenes.find(x => x && x.scene && x.scene.isActive());
      return { ok: true, scene: any ? any.scene.key : 'none' };
    }
    return { ok: true, scene: 'GrassCuttingScene', weapon: s.weaponSystem.currentIndex };
  })()`);
}

await sleep(3500);
log('[0] 初始场景:', await state());

// 空格推进：菜单 → 答题 → 割草
await page.key(' ', 'Space', 32);
await sleep(1200);
for (let i = 0; i < 40; i++) {
  await page.key(' ', 'Space', 32);
  await sleep(700);
  const s = await state();
  if (s.scene === 'GrassCuttingScene') {
    log('[1] 已进入割草，第', i, '次空格');
    break;
  }
}
await sleep(800);
log('[1] 当前场景:', await state());

// ── 测量 ①：HUD 加成文案与武器栏的实际间隙 ──
const layout = await page.evaluate(`(() => {
  const g = window.__game__;
  const s = g.scene.scenes.find(x => x.scene.isActive() && x.scene.key === 'GrassCuttingScene');
  if (!s) return { err: 'not in grass scene' };
  const tb = s.hud.bonusText.getBounds();
  const bar = s.weaponBar.rect;
  const z = s.weaponBar.slots ? s.weaponBar.slots[0].zone : null;
  return {
    bonusText: { top: tb.top, bottom: tb.bottom, left: tb.left, right: tb.right, h: tb.height },
    weaponBarRect: { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right },
    gap: bar.top - tb.bottom,
    zone: z ? { y: z.y, h: z.height, bottom: z.y + z.height } : null,
    slotCount: s.weaponBar.slots.length,
    iconScales: s.weaponBar.slots.map(sl => +sl.icon.scaleX.toFixed(3)),
    iconSizes: s.weaponBar.slots.map(sl => [sl.icon.displayWidth, sl.icon.displayHeight]),
  };
})()`);
log('[2] 布局实测:', layout);

// ── 测量 ②：点击热区 ──
async function clickTest(x, y, expect) {
  await page.click(x, y);
  await sleep(350);
  const s = await state();
  return { at: `${x},${y}`, expect, actual: s.weapon, pass: s.weapon === expect };
}
const clickResults = [];
clickResults.push(await clickTest(366, 602, 0)); // 槽1 格心
clickResults.push(await clickTest(480, 630, 1)); // 槽2 下移后（原热区外）
clickResults.push(await clickTest(594, 602, 2)); // 槽3 格心
clickResults.push(await clickTest(480, 636, 1)); // 槽2 更靠下
log('[3] 点击热区实测:', clickResults);

// ── 测量 ③：特效池峰值 ──
await page.evaluate(`
  (() => {
    const g = window.__game__;
    const s = g.scene.scenes.find(x => x.scene.isActive() && x.scene.key === 'GrassCuttingScene');
    if (!s) return;
    window.__peak = {
      shards: 0, rings: 0, flashes: 0, corpses: 0, monsters: 0,
      kills: 0, samples: 0, shardCap: 0, ringCap: 0, flashCap: 0,
      timeline: [],
    };
    const p = window.__peak;
    const kf = s.killFx;
    const origBurst = kf.burst.bind(kf);
    kf.burst = (...a) => { p.kills++; return origBurst(...a); };
    window.__t0 = performance.now();
    window.__killsAt = [];
    p.timer = setInterval(() => {
      const sc = g.scene.scenes.find(x => x.scene.isActive() && x.scene.key === 'GrassCuttingScene');
      if (!sc || !sc.killFx) return;
      const k = sc.killFx;
      const sa = k.shards.filter(a => a.active).length;
      const ra = k.rings.filter(a => a.active).length;
      const fa = k.flashes.filter(a => a.active).length;
      p.samples++;
      if (sa > p.shards) p.shards = sa;
      if (ra > p.rings) p.rings = ra;
      if (fa > p.flashes) p.flashes = fa;
      if (sa >= k.shards.length) p.shardCap++;
      if (ra >= k.rings.length) p.ringCap++;
      if (fa >= k.flashes.length) p.flashCap++;
      const co = sc.spawner ? sc.spawner.corpseCount : 0;
      const mo = sc.spawner ? sc.spawner.monsters.filter(m => m.alive).length : 0;
      if (co > p.corpses) p.corpses = co;
      if (mo > p.monsters) p.monsters = mo;
      const t = Math.floor((performance.now() - window.__t0) / 1000);
      if (!p.timeline[t]) p.timeline[t] = { kills: p.kills, shards: sa, monsters: mo };
      p.timeline[t].shards = Math.max(p.timeline[t].shards, sa);
      p.timeline[t].monsters = Math.max(p.timeline[t].monsters, mo);
    }, 100);
  })()
`);

// 切到机关枪（射速最快，制造最高击杀密度），按住 J 连续开火并绕圈走位
await page.key('2', 'Digit2', 50);
await sleep(300);
log('[4] 已切到武器索引:', (await state()).weapon);

await page.keyDown('J', 'KeyJ', 74);
const moveSeq = [
  ['W', 'KeyW', 87],
  ['D', 'KeyD', 68],
  ['S', 'KeyS', 83],
  ['A', 'KeyA', 65],
];
for (let round = 0; round < 70; round++) {
  const [k, c, code] = moveSeq[round % moveSeq.length];
  await page.keyDown(k, c, code);
  await sleep(700);
  await page.keyUp(k, c, code);
  const st = await state();
  if (st.scene !== 'GrassCuttingScene') {
    log('[5] 第', round, '轮移动时已离开割草场景:', st.scene);
    break;
  }
}
await page.keyUp('J', 'KeyJ', 74);

const peak = await page.evaluate(`(() => {
  const p = window.__peak;
  if (!p) return { err: 'no peak data' };
  clearInterval(p.timer);
  const tl = {};
  for (const k in p.timeline) if (p.timeline[k]) tl[k + 's'] = p.timeline[k];
  return {
    samples: p.samples, kills: p.kills,
    peakShards: p.shards, peakRings: p.rings, peakFlashes: p.flashes,
    peakCorpses: p.corpses, peakMonsters: p.monsters,
    shardCapHits: p.shardCap, ringCapHits: p.ringCap, flashCapHits: p.flashCap,
    timeline: tl,
  };
})()`);
log('[5] 特效池峰值实测:', peak);

const poolSizes = await page.evaluate(`(() => {
  const g = window.__game__;
  const s = g.scene.scenes.find(x => x.scene.key === 'GrassCuttingScene');
  if (!s || !s.killFx) return null;
  return {
    shardPoolSize: s.killFx.shards.length,
    ringPoolSize: s.killFx.rings.length,
    flashPoolSize: s.killFx.flashes.length,
    corpsePoolSize: s.spawner ? s.spawner['opts'].corpsePoolSize : -1,
  };
})()`);
log('[6] 池容量与当前占用:', poolSizes);
log('[7] 页面异常:', errors.length === 0 ? '无' : errors);

fs.writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n', 'utf8');

await page.shot(path.join(OUT_DIR, 'weaponbar.png'));
await closePage(9360, page.id);
page.close();
browser.proc.kill();
await server.close();
process.exit(0);
