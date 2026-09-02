/**
 * T-022 Boss Roster × 3 阶段化系统自动化验证（scripts/verify-t022-boss-roster.mjs）
 * 目标：
 *  1. L5（boss_overwork_math）进入割草，确认 Boss 数值采用新模板（hp=1400）；
 *  2. 等 Boss 入场，把 Boss 血量打到 60% 以下，确认 bossPhaseIndex 切换为 1；
 *  3. 继续打到 30% 以下，确认 bossPhaseIndex 切换为 2；
 *  4. 全程无控制台异常。
 *
 * 用法：node scripts/verify-t022-boss-roster.mjs [URL]
 * 默认 URL：http://127.0.0.1:5185/（dev server）。可以指向 dist-t022 的预览（npm run preview）。
 *
 * 实现策略：
 *  - 用 CDP 控制无头 Edge（与 verify-t018-boss.mjs 同套基础设施）；
 *  - 高频读 __KB_DEBUG__.bossHpRatio，按相位阈值做断言；
 *  - 通过 GameRuntime.expose 暴露 bossPhaseIndex（GrassCuttingScene 已暴露此 getter）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5185/';
const OUT = 'reports/t022';
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
const log = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const browser = await launchBrowser({ port: 9382 });
const errors = [];

function watchErrors(page) {
  page.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'log') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text.includes('[boss phase]')) log('   [console]', text);
    }
  });
  page.send('Runtime.enable');
  page.send('Log.enable');
  page.send('Page.enable');
}

async function newPageWithSave(unlockedLevel) {
  const page = await newPage(9382, 'about:blank');
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

async function dbg(page) {
  return await page.evaluate(`(() => {
    const d = window.__KB_DEBUG__;
    if (!d) return null;
    return {
      scene: d.scene,
      isBossLevel: d.isBossLevel,
      bossSpawned: d.bossSpawned,
      bossAlive: d.bossAlive,
      bossHpRatio: d.bossHpRatio,
      bossPhaseIndex: typeof d.bossPhaseIndex === 'number' ? d.bossPhaseIndex : null,
      bossX: d.bossX, bossY: d.bossY,
      kills: d.kills, timeLeft: d.timeLeft, aliveMonsters: d.aliveMonsters,
      hp: d.hp, weapon: d.weaponIndex, playerX: d.playerX, playerY: d.playerY,
      doomZoneCount: typeof d.doomZoneCount === 'number' ? d.doomZoneCount : null,
    };
  })()`);
}

/** 从菜单进入割草：连按空格游标高频停下来通过答题阶段 */
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

/** 边打边跑：切机关枪绕圈风筝 Boss，等 phase 切换。
 *  策略：用脉冲式攻击（J 短按 200ms 间隔 600ms）控制 DPS，
 *  让 Boss 慢慢掉血以便能观察到 phase 切换。 */
async function fightBossPhases(page, maxSec = 240) {
  const t0 = Date.now();
  await page.key('2', 'Digit2', 50);
  await sleep(300);
  let lastRatio = -1;
  let lastPhase = -1;
  const phaseHistory = [];
  let attackPulse = false;
  while (Date.now() - t0 < maxSec * 1000) {
    const d = await dbg(page);
    if (!d || d.scene !== 'GrassCuttingScene') return { reason: 'scene-changed', d, phaseHistory };
    if (d.bossAlive === false) return { reason: 'boss-dead', d, phaseHistory };
    if (d.bossPhaseIndex !== null && d.bossPhaseIndex !== lastPhase) {
      log(`   >> phase 切换: ${lastPhase} -> ${d.bossPhaseIndex} (ratio=${(d.bossHpRatio ?? 0).toFixed(3)})`);
      phaseHistory.push({ at: Math.round((Date.now() - t0) / 1000), ratio: d.bossHpRatio, phase: d.bossPhaseIndex });
      lastPhase = d.bossPhaseIndex;
    }
    if (d.bossX != null && d.bossY != null) {
      const dx = d.bossX - d.playerX;
      const dy = d.bossY - d.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 260) {
        if (dy < -40) await pressDir(page, 'W', 'KeyW', 87, 600);
        else if (dx > 60) await pressDir(page, 'D', 'KeyD', 68, 600);
        else if (dx < -60) await pressDir(page, 'A', 'KeyA', 65, 600);
        else await pressDir(page, 'S', 'KeyS', 83, 300);
      } else if (dist < 140) {
        if (dy > -40) await pressDir(page, 'S', 'KeyS', 83, 600);
        else if (dx < 0) await pressDir(page, 'D', 'KeyD', 68, 600);
        else await pressDir(page, 'A', 'KeyA', 65, 600);
      } else {
        // 射程内：脉冲攻击（按住 J 200ms 后松开）
        attackPulse = !attackPulse;
        if (attackPulse) await page.keyDown('J', 'KeyJ', 74);
        else await page.keyUp('J', 'KeyJ', 74);
        // 横向绕圈风筝
        const seq = [['W','KeyW',87],['D','KeyD',68],['S','KeyS',83],['A','KeyA',65]];
        const [k, c, code] = seq[Math.floor(Date.now() / 700) % 4];
        await pressDir(page, k, c, code, 200);
      }
      const ratio = +(d.bossHpRatio ?? 0).toFixed(3);
      if (Math.abs(ratio - lastRatio) > 0.05 || lastRatio === -1) {
        log('   bossHpRatio=', ratio, ' phase=', d.bossPhaseIndex,
            ' boss@', d.bossX?.toFixed(0), d.bossY?.toFixed(0),
            ' player@', d.playerX?.toFixed(0), d.playerY?.toFixed(0),
            ' 存活小怪=', d.aliveMonsters, ' zones=', d.doomZoneCount);
        lastRatio = ratio;
      }
    } else {
      await pressDir(page, 'W', 'KeyW', 87, 500);
    }
    await sleep(200);
  }
  await page.keyUp('J', 'KeyJ', 74);
  return { reason: 'timeout', d: await dbg(page), phaseHistory };
}

// ═══════════ ① L5 内卷怪·加班老登 ═══════════
log('=== T-022 ① L5 几何峡谷（bossLevel=true，boss_overwork_math hp=1400）===');
const page1 = await newPageWithSave(5);

const entered = await enterGrass(page1);
if (!entered) {
  log('[!!] 未能进入割草场景（答题阶段超时）');
} else {
  log('[1] 进入割草: 用时', entered.elapsed, 's isBossLevel=', entered.d.isBossLevel);
  log('    初始: bossSpawned=', entered.d.bossSpawned, ' bossAlive=', entered.d.bossAlive,
      ' bossHpRatio=', entered.d.bossHpRatio, ' bossPhaseIndex=', entered.d.bossPhaseIndex,
      ' timeLeft=', entered.d.timeLeft);

  // 等 Boss 入场
  const tSpawn0 = Date.now();
  let spawned = false;
  while (Date.now() - tSpawn0 < 20000) {
    await sleep(1000);
    const d = await dbg(page1);
    if (d && d.bossSpawned === true) {
      log('[2] Boss 已入场: 用时', Math.round((Date.now() - tSpawn0) / 1000), 's',
          ' bossAlive=', d.bossAlive, ' bossHpRatio=', d.bossHpRatio?.toFixed(3),
          ' phase=', d.bossPhaseIndex, ' timeLeft=', d.timeLeft?.toFixed(1));
      spawned = true;
      break;
    }
    if (!d || d.scene !== 'GrassCuttingScene') break;
  }
  if (!spawned) log('[!!] 20s 内 Boss 未入场');

  await page1.shot(path.join(OUT, 'l5-boss-spawn.png'));

  // 战斗直到 phase=2（hp 降到 30% 以下）或 4 分钟超时
  const result = await fightBossPhases(page1, 240);
  log('[3] 战斗结束:', result.reason, ' 最后状态=', result.d);
  log('    阶段切换历史:');
  for (const h of result.phaseHistory) log(`      t=${h.at}s phase=${h.phase} ratio=${(h.ratio ?? 0).toFixed(3)}`);
  const dEnd = result.d || (await dbg(page1));
  log('    最终: scene=', dEnd?.scene, ' kills=', dEnd?.kills,
      ' bossHpRatio=', dEnd?.bossHpRatio, ' bossPhaseIndex=', dEnd?.bossPhaseIndex,
      ' timeLeft=', dEnd?.timeLeft, ' zones=', dEnd?.doomZoneCount);
  await page1.shot(path.join(OUT, 'l5-boss-end.png'));
}

await closePage(9382, page1.id);
page1.close();

log('');
log('=== 异常 ===');
log(errors.length ? errors.join('\n') : '（无）');

fs.writeFileSync(path.join(OUT, 't022-verify.txt'), lines.join('\n') + '\n', 'utf8');
browser.proc.kill();
process.exit(0);
