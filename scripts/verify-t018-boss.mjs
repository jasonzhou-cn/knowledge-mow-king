/**
 * T-018 Boss 关实测（scripts/verify-t018-boss.mjs）
 * 用无头 Edge 驱动 dev server（5185，import.meta.env.DEV=true → __KB_DEBUG__ 存在）：
 *  1) L14 完形峰林（bossLevel=true）：确认 Boss 入场 → 可被击杀 → 击杀即通关
 *  2) L9 单词溪谷（普通关）：确认 bossLevel=false 一切照旧（无 Boss、无 Boss 血条）
 * 结果写入 reports/t018/ 目录，键读 __KB_DEBUG__。
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5185/';
const OUT = 'reports/t018';
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
const log = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const browser = await launchBrowser({ port: 9377 });
const errors = [];

function watchErrors(page) {
  page.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  });
  page.send('Runtime.enable');
  page.send('Log.enable');
  page.send('Page.enable');
}

async function newPageWithSave(unlockedLevel) {
  const page = await newPage(9377, 'about:blank');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 960, height: 640, deviceScaleFactor: 1, mobile: false,
  });
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const n = new Date(); const p = (x) => String(x).padStart(2, '0');
      const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
      localStorage.setItem('knowledge-mow-king.save.v1', JSON.stringify({
        version: 1, level: ${unlockedLevel}, exp: 0, totalScore: 0,
        unlockedLevel: ${unlockedLevel},
        daily: { date: today, rewardTime: 0 }, updatedAt: Date.now(),
      }));
      localStorage.setItem('knowledge-mow-king.tutorial.v1', 'done');
    })();`,
  });
  watchErrors(page);
  await page.send('Page.navigate', { url: URL });
  await sleep(3500);
  return page;
}

/** 读 __KB_DEBUG__ 状态；句柄不存在时返回 null */
async function dbg(page) {
  return await page.evaluate(`(() => {
    const d = window.__KB_DEBUG__;
    if (!d) return null;
    return {
      scene: d.scene, isBossLevel: d.isBossLevel, bossSpawned: d.bossSpawned,
      bossAlive: d.bossAlive, bossHpRatio: d.bossHpRatio,
      bossX: d.bossX, bossY: d.bossY,
      kills: d.kills, timeLeft: d.timeLeft, aliveMonsters: d.aliveMonsters,
      hp: d.hp, weapon: d.weaponIndex, playerX: d.playerX, playerY: d.playerY,
    };
  })()`);
}

/**
 * 从菜单进入割草：空格进答题，然后高频点按让游标「恰好在判定框上」时停住。
 * 高频点按的理由：游标模式 2s 一次的停顿大概率落在判定框间隙（miss 不消耗题数），
 * 会卡到每题超时才推进；300ms 连发能保证游标扫过判定框时被停住 → 答题 → 推进。
 */
async function enterGrass(page, maxMs = 120000) {
  await page.key(' ', 'Space', 32, 80);
  const t0 = Date.now();
  let lastScene = null;
  while (Date.now() - t0 < maxMs) {
    await page.key(' ', 'Space', 32, 50);
    const d = await dbg(page);
    if (d && d.scene === 'GrassCuttingScene') return { d, elapsed: Math.round((Date.now() - t0) / 1000) };
    const sc = await page.evaluate(`(() => {
      const g = window.__KB_GAME__;
      if (!g) return null;
      const a = g.scene.scenes.find((x) => x.scene && x.scene.isActive());
      return a ? a.scene.key : null;
    })()`);
    if (sc && sc !== lastScene) {
      log('    [scene]', sc);
      lastScene = sc;
    }
    if (sc === 'GrassCuttingScene') return { d: await dbg(page), elapsed: Math.round((Date.now() - t0) / 1000) };
    await sleep(250);
  }
  return null;
}

async function pressDir(page, key, code, keyCode, ms) {
  await page.keyDown(key, code, keyCode);
  await sleep(ms);
  await page.keyUp(key, code, keyCode);
}

/** 边打边走：切机关枪（射程 620 保证远程命中），朝 Boss 方向移动但保持距离，按住 J 攻击 */
async function fightBoss(page, maxSec = 120) {
  const t0 = Date.now();
  await page.key('2', 'Digit2', 50);
  await sleep(300);
  await page.keyDown('J', 'KeyJ', 74);
  let lastRatio = -1;
  while (Date.now() - t0 < maxSec * 1000) {
    const d = await dbg(page);
    if (!d || d.scene !== 'GrassCuttingScene') return { reason: 'scene-changed', d };
    if (d.bossAlive === false) return { reason: 'boss-dead', d };

    if (d.bossX != null && d.bossY != null) {
      const dx = d.bossX - d.playerX;
      const dy = d.bossY - d.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 260) {
        // 太远 → 靠近（垂直优先，Boss 从上方来）
        if (dy < -40) await pressDir(page, 'W', 'KeyW', 87, 600);
        else if (dx > 60) await pressDir(page, 'D', 'KeyD', 68, 600);
        else if (dx < -60) await pressDir(page, 'A', 'KeyA', 65, 600);
        else await pressDir(page, 'S', 'KeyS', 83, 300);
      } else if (dist < 140) {
        // 太近 → 拉开，避免 Boss 接触伤害（24/次）
        if (dy > -40) await pressDir(page, 'S', 'KeyS', 83, 600);
        else if (dx < 0) await pressDir(page, 'D', 'KeyD', 68, 600);
        else await pressDir(page, 'A', 'KeyA', 65, 600);
      } else {
        // 射程内 → 横向绕圈风筝
        const seq = [['W','KeyW',87],['D','KeyD',68],['S','KeyS',83],['A','KeyA',65]];
        const [k, c, code] = seq[Math.floor(Date.now() / 700) % 4];
        await pressDir(page, k, c, code, 500);
      }
      const ratio = +(d.bossHpRatio ?? 0).toFixed(3);
      if (Math.abs(ratio - lastRatio) > 0.05 || lastRatio === -1) {
        log('   bossHpRatio=', ratio, ' boss@', d.bossX?.toFixed(0), d.bossY?.toFixed(0),
            ' player@', d.playerX?.toFixed(0), d.playerY?.toFixed(0), ' 存活小怪=', d.aliveMonsters);
        lastRatio = ratio;
      }
    } else {
      await pressDir(page, 'W', 'KeyW', 87, 500);
    }
    await sleep(200);
  }
  await page.keyUp('J', 'KeyJ', 74);
  return { reason: 'timeout', d: await dbg(page) };
}

// ═══════════ ① L14 Boss 关 ═══════════
log('=== T-018 ① L14 完形峰林（bossLevel=true）===');
const page1 = await newPageWithSave(14);
log('[0] 菜单就绪，默认选中 L14');

const entered = await enterGrass(page1);
if (!entered) {
  log('[!!] 未能进入割草场景（答题阶段超时）');
} else {
  log('[1] 进入割草: 用时', entered.elapsed, 's isBossLevel=', entered.d.isBossLevel);
  log('    初始: bossSpawned=', entered.d.bossSpawned, ' bossAlive=', entered.d.bossAlive,
      ' bossHpRatio=', entered.d.bossHpRatio, ' timeLeft=', entered.d.timeLeft);

  // 等 Boss 入场（spawnDelay=8s，放宽到 20s）
  const tSpawn0 = Date.now();
  let spawned = false;
  while (Date.now() - tSpawn0 < 20000) {
    await sleep(1000);
    const d = await dbg(page1);
    if (d && d.bossSpawned === true) {
      log('[2] Boss 已入场: 用时', Math.round((Date.now() - tSpawn0) / 1000), 's',
          ' bossAlive=', d.bossAlive, ' bossHpRatio=', d.bossHpRatio?.toFixed(3),
          ' timeLeft=', d.timeLeft?.toFixed(1));
      spawned = true;
      break;
    }
    if (!d || d.scene !== 'GrassCuttingScene') break;
  }
  if (!spawned) log('[!!] 20s 内 Boss 未入场');

  await page1.shot(path.join(OUT, 'l14-boss-spawn.png'));

  // 击杀 Boss
  const result = await fightBoss(page1, 150);
  log('[3] 战斗结束:', result.reason, ' 最后状态=', result.d);
  const dEnd = result.d || (await dbg(page1));
  log('    最终: scene=', dEnd?.scene, ' kills=', dEnd?.kills,
      ' bossHpRatio=', dEnd?.bossHpRatio, ' timeLeft=', dEnd?.timeLeft);
  await page1.shot(path.join(OUT, 'l14-boss-end.png'));
}

await closePage(9377, page1.id);
page1.close();

// ═══════════ ② L9 普通关回归 ═══════════
log('');
log('=== T-018 ② L9 单词溪谷（普通关回归）===');
const page2 = await newPageWithSave(9);
log('[0] 菜单就绪，默认选中 L9');

const entered2 = await enterGrass(page2);
if (!entered2) {
  log('[!!] 未能进入割草场景');
} else {
  log('[1] 进入割草: isBossLevel=', entered2.d.isBossLevel,
      ' bossSpawned=', entered2.d.bossSpawned, ' bossAlive=', entered2.d.bossAlive);
  if (entered2.d.isBossLevel === false) log('    ✓ 普通关无 Boss 标记');

  // 打 15 秒确认普通关刷怪/击杀照常
  await page2.keyDown('J', 'KeyJ', 74);
  for (let i = 0; i < 15; i++) {
    await pressDir(page2, 'W', 'KeyW', 87, 800);
  }
  await page2.keyUp('J', 'KeyJ', 74);
  const d2 = await dbg(page2);
  log('[2] 15s 后: scene=', d2?.scene, ' kills=', d2?.kills,
      ' aliveMonsters=', d2?.aliveMonsters, ' bossSpawned=', d2?.bossSpawned);
  await page2.shot(path.join(OUT, 'l9-normal.png'));
}

await closePage(9377, page2.id);
page2.close();

log('');
log('=== 异常 ===');
log(errors.length ? errors.join('\n') : '（无）');

fs.writeFileSync(path.join(OUT, 'boss-verify.txt'), lines.join('\n') + '\n', 'utf8');
browser.proc.kill();
process.exit(0);
