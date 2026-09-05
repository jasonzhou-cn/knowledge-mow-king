/**
 * T-027 打磨边界收口 — CDP 走查（.tmp/t027-walkthrough.mjs，不进仓库）
 * 流程：小米视口 2340×1080 → L20 考神关直入：
 *   1) 双 BUFF 并存拾取 → 学霸覆盖躺平（蓝环隐藏/躺平冻结）→ 学霸到期 → 躺平恢复；
 *   2) Boss 入场 → 考神召唤 4 迷你 Boss 环绕 → 击杀 1 只 → 首杀台词；
 *   3) 击杀 Boss → 死亡序列血条 200ms 淡出（bossBarFading）→ 哀悼消散 → Result。
 * 断言：无 JS 异常；各阶段状态位与截图一致。
 * 用法：node .tmp/t027-walkthrough.mjs [URL]  （默认 http://127.0.0.1:5174/）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from '../scripts/cdp.mjs';

const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 't027-shots');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const ok = (name, detail) => {
  results.push(`✅ ${name}${detail ? ' — ' + detail : ''}`);
  console.log(`✅ ${name}${detail ? ' — ' + detail : ''}`);
};
const bad = (name, detail) => {
  results.push(`❌ ${name}${detail ? ' — ' + detail : ''}`);
  console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launchBrowser({ port: 9395, width: 2340, height: 1080 });
const page = await newPage(9395, 'about:blank');
await emulateXiaomi(page);
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(800);
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    try {
      const n = new Date(); const p = (x) => String(x).padStart(2, '0');
      const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
      localStorage.setItem('knowledge-mow-king.save.v1', JSON.stringify({
        version: 1, level: 20, exp: 0, totalScore: 0, unlockedLevel: 20,
        daily: { date: today, rewardTime: 0 }, updatedAt: Date.now(),
      }));
      localStorage.setItem('knowledge-mow-king.tutorial.v1', 'done');
    } catch (e) { window.__KB_INIT_ERROR__ = String(e); }
  })();`,
});
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text);
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(4500);

const pollUntil = async (expr, timeoutMs, intervalMs = 1200) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(expr);
    if (last && last.done) return last;
    await sleep(intervalMs);
  }
  return last;
};

// ───── 1. L20 考神关直入 ─────
const started = await page.evaluate(`(() => {
  const g = __KB_GAME__;
  if (!g) return 'no-game';
  const payload = {
    level: 20, bonusTime: 0,
    quiz: { totalQuestions: 5, correctCount: 3, missCount: 1, timeoutCount: 1, accuracy: 0.6, maxCombo: 2, averageAnswerTime: 4, totalAnswerTime: 20, records: [] },
    bonus: { damageMultiplier: 1.1, rangeMultiplier: 1.05, durationMultiplier: 1.08,
      breakdown: { baseBonus: 1, subjectCoefficient: 1, accuracyTerm: 1, speedFactor: 1, comboFactor: 1, rawMultiplier: 1.1, floorApplied: false, ceilingApplied: false } },
    wrongAnswers: [],
  };
  g.scene.stop('MenuScene');
  g.scene.start('GrassCuttingScene', payload);
  return 'ok';
})()`);
const grass = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return d ? { done: !!d.themeAccent, boss: d.isBossLevel } : null; })()`, 60000);
(grass && grass.done ? ok : bad)('L20 考神关加载', `isBossLevel=${grass && grass.boss}`);
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.hp = 99999; sc.maxHp = 99999; return 'ok'; })()`);

// ───── 2. 双 BUFF 并存拾取：先拾躺平，再拾学霸 → 学霸覆盖躺平 ─────
const buffPick = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const old = Math.random; Math.random = () => 0; // 绕过概率，走真实 maybeDrop 路径
  let t1 = 0; while (sc.lazy.dropsSpawnedCount < 1 && t1 < 20) { sc.lazy.maybeDrop(sc.player.x + 40, sc.player.y); t1++; }
  let t2 = 0; while (sc.scholar.dropsSpawnedCount < 1 && t2 < 20) { sc.scholar.maybeDrop(sc.player.x - 40, sc.player.y); t2++; }
  Math.random = old;
  return { lazyDrops: sc.lazy.dropsSpawnedCount, scholarDrops: sc.scholar.dropsSpawnedCount };
})()`);
// 玩家先向右挪拾躺平，再向左挪拾学霸
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.player.x += 40; return 'ok'; })()`);
const lazyFirst = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: d && d.lazyActive === true, active: d && d.lazyActive }; })()`, 20000);
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.player.x -= 80; return 'ok'; })()`);
const priority = await pollUntil(`(() => {
  const d = window.__KB_DEBUG__;
  return { done: !!(d && d.scholarActive === true && d.lazySuppressed === true),
    scholar: d && d.scholarActive, suppressed: d && d.lazySuppressed, lazyActive: d && d.lazyActive, lazyRemain: d && d.lazyRemaining };
})()`, 20000);
await page.shot(path.join(OUT, 'buff-priority.png'));
(priority && priority.done ? ok : bad)('BUFF 优先级：学霸覆盖躺平（蓝环隐藏、躺平冻结）',
  `lazyDrops=${buffPick && buffPick.lazyDrops} scholarDrops=${buffPick && buffPick.scholarDrops} scholar=${priority && priority.scholar} suppressed=${priority && priority.suppressed} lazyActive=${priority && priority.lazyActive} lazyRemain=${priority && priority.lazyRemain}`);

// 学霸到期（运行时把剩余时间缩短）→ 躺平自动恢复显示并继续倒计时
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.scholar.buffRemaining = 0.5; return 'ok'; })()`);
const restored = await pollUntil(`(() => {
  const d = window.__KB_DEBUG__;
  return { done: !!(d && d.lazyActive === true && d.lazySuppressed === false),
    lazyActive: d && d.lazyActive, suppressed: d && d.lazySuppressed, remain: d && d.lazyRemaining };
})()`, 20000);
await sleep(300);
await page.shot(path.join(OUT, 'lazy-restored.png'));
(restored && restored.done ? ok : bad)('学霸到期 → 躺平恢复（蓝环 + Zzz 回归、剩余时间继续倒数）', JSON.stringify(restored));

// ───── 3. 考神召唤：Boss 入场 → 4 迷你 Boss 环绕 ─────
const boss1 = await pollUntil(`(() => {
  const d = window.__KB_DEBUG__;
  return { done: !!(d && d.bossSpawned && d.examSummonTotal > 0), spawned: d && d.bossSpawned, total: d && d.examSummonTotal, alive: d && d.examSummonAlive };
})()`, 240000);
(boss1 && boss1.done ? ok : bad)('考神召唤：Boss 入场同时召唤迷你 Boss', JSON.stringify(boss1));
await sleep(900); // 等弹入动画收尾
await page.shot(path.join(OUT, 'exam-summon.png'));

// 击杀 1 只迷你 Boss（真实 applyHit 路径）→ 首杀台词 + 计数下降
const miniKill = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const mini = sc.spawner.monsters.find((m) => m.isMiniboss && m.alive);
  if (!mini) return 'no-mini';
  const before = { hp: mini.hp, maxHp: mini.maxHp, damage: mini.damage, score: mini.score };
  sc.combat.applyHit({ monster: mini, damage: mini.hp + 9999, comboMultiplier: 1, dirX: 0, dirY: -1, knockback: 200 });
  return before;
})()`);
await sleep(600);
const afterKill = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { alive: d.examSummonAlive, total: d.examSummonTotal, kills: d.kills, score: d.score, combo: d.combo }; })()`);
await page.shot(path.join(OUT, 'exam-summon-kill.png'));
(afterKill.alive === (boss1.alive ?? 4) - 1 && afterKill.kills === 0 && afterKill.score === 0
  ? ok : bad)('迷你 Boss 可击杀但不计分/不进连击（§4.4）',
  `before=${JSON.stringify(miniKill)} after=${JSON.stringify(afterKill)}`);

// ───── 4. Boss 死亡序列：血条 200ms 淡出 + 哀悼消散 → Result ─────
const killed = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const boss = sc.spawner.monsters.find((m) => m.isBoss && m.alive);
  if (!boss) return 'no-boss';
  boss.hp = Math.max(1, boss.maxHp * 0.02);
  sc.combat.applyHit({ monster: boss, damage: boss.hp + 10, comboMultiplier: 1, dirX: 0, dirY: -1, knockback: 0 });
  return 'ok';
})()`);
console.log('   kill 结果:', JSON.stringify(killed));
const seq1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: !!(d && d.bossDeathActive), remain: d && d.bossDeathRemaining, fading: d && d.bossBarFading }; })()`, 30000);
await sleep(250); // 等血条 200ms 淡出完成
await page.shot(path.join(OUT, 'boss-death-barfade.png'));
(seq1 && seq1.done && seq1.fading ? ok : bad)('死亡序列启动 + Boss 血条淡出标记', `remain=${seq1 && seq1.remain} bossBarFading=${seq1 && seq1.fading}`);
const mourning = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { alive: d.examSummonAlive, fading: d.bossBarFading }; })()`);
(mourning.alive === 0 ? ok : bad)('Boss 死亡 → 迷你 Boss 全体哀悼消散', JSON.stringify(mourning));

const result = await pollUntil(`(() => {
  const g = __KB_GAME__;
  const s = g.scene.scenes.find((x) => x.scene && x.scene.isActive());
  return { done: !!s && s.scene.key === 'ResultScene', key: s ? s.scene.key : null };
})()`, 90000);
await page.shot(path.join(OUT, 'result.png'));
(result && result.done ? ok : bad)('死亡序列结束 → ResultScene 移交', `scene=${result && result.key}`);

// ───── 汇总 ─────
console.log('\n=== T-027 走查结果 ===');
for (const r of results) console.log(r);
console.log(`JS 异常数: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  异常:', e.split('\n')[0]);
console.log('截图目录:', OUT);

await closePage(9395, page.id);
browser.proc.kill();
process.exit(errors.length > 0 ? 1 : 0);
