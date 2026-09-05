/**
 * T-026 打磨期遗留项收尾 — CDP 走查（.tmp/t026-walkthrough.mjs，不进仓库）
 * 流程：小米视口 2340×1080 → Grass（错题弹幕 + 躺平 BUFF）→ L5 Boss 击杀
 *       → 死亡收场序列（hitstop + 翻白眼定格 + 金色爆散 + 死亡台词 + 缩放旋转消失）→ Result。
 * 断言：无 JS 异常；序列期间世界冻结；结束后移交 ResultScene。
 * 用法：node .tmp/t026-walkthrough.mjs [URL]  （默认 http://127.0.0.1:5174/）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from '../scripts/cdp.mjs';

const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 't026-shots');
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

const browser = await launchBrowser({ port: 9394, width: 2340, height: 1080 });
const page = await newPage(9394, 'about:blank');
await emulateXiaomi(page);
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(800);
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    try {
      const n = new Date(); const p = (x) => String(x).padStart(2, '0');
      const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
      localStorage.setItem('knowledge-mow-king.save.v1', JSON.stringify({
        version: 1, level: 5, exp: 0, totalScore: 0, unlockedLevel: 5,
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

// ───── 1. Grass：合成 payload 直入 L5 Boss 关，携带错题列表（错题弹幕数据源）─────
const started = await page.evaluate(`(() => {
  const g = __KB_GAME__;
  if (!g) return 'no-game';
  const payload = {
    level: 5, bonusTime: 0,
    quiz: { totalQuestions: 5, correctCount: 2, missCount: 1, timeoutCount: 2, accuracy: 0.4, maxCombo: 1, averageAnswerTime: 4, totalAnswerTime: 20, records: [] },
    bonus: { damageMultiplier: 1.1, rangeMultiplier: 1.05, durationMultiplier: 1.08,
      breakdown: { baseBonus: 1, subjectCoefficient: 1, accuracyTerm: 1, speedFactor: 1, comboFactor: 1, rawMultiplier: 1.1, floorApplied: false, ceilingApplied: false } },
    wrongAnswers: [
      '错词卡：abandon → 放弃',
      '3 + 5 × 2 = ? → 13',
      'How are you? 的意思 → 你好吗',
    ],
  };
  g.scene.stop('MenuScene');
  g.scene.start('GrassCuttingScene', payload);
  return 'ok';
})()`);
const grass = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return d ? { done: !!d.themeAccent, theme: d.themeAccent, items: d.danmakuItems } : null; })()`, 60000);
(grass && grass.done ? ok : bad)('Grass 场景加载（错题列表已传入）', `themeAccent=${grass && grass.theme} danmakuItems=${grass && grass.items}`);
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.hp = 99999; sc.maxHp = 99999; return 'ok'; })()`);

// ───── 2. 错题弹幕：等第一批弹幕出现并截图 ─────
const danmaku1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: (d && d.danmakuCount) > 0, count: d && d.danmakuCount }; })()`, 90000);
await page.shot(path.join(OUT, 'danmaku-1.png'));
(danmaku1 && danmaku1.done ? ok : bad)('错题弹幕渲染（底部活动带右→左飘过）', `activeCount=${danmaku1 && danmaku1.count}`);
await sleep(2500);
await page.shot(path.join(OUT, 'danmaku-2.png'));
const danmaku2 = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { count: d.danmakuCount, items: d.danmakuItems }; })()`);
(danmaku2.items === 3 ? ok : bad)('错题弹幕数据源条数 = 3', JSON.stringify(danmaku2));

// ───── 3. 躺平 BUFF：强制掉落胶囊 + 拾取 → 无敌 + 移速下降 ─────
const lazyDrop = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const old = Math.random; Math.random = () => 0; // 临时绕过概率，走真实 maybeDrop 路径
  let tries = 0;
  while (sc.lazy.dropsSpawnedCount < 1 && tries < 20) { sc.lazy.maybeDrop(sc.player.x + 40, sc.player.y); tries++; }
  Math.random = old;
  sc.player.x += 40; // 挪进拾取半径
  return { drops: sc.lazy.dropsSpawnedCount };
})()`);
const lazy1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: d && d.lazyActive === true, active: d && d.lazyActive, remain: d && d.lazyRemaining }; })()`, 30000);
await page.shot(path.join(OUT, 'lazy-buff.png'));
(lazy1 && lazy1.done ? ok : bad)('躺平 BUFF（胶囊拾取 → 激活：蓝环 + 💤 + 无敌 + 移速下降）', `drops=${lazyDrop && lazyDrop.drops} active=${lazy1 && lazy1.active} remain=${lazy1 && lazy1.remain}`);
const moveFactor = await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); return { factor: sc.lazy.moveSpeedFactor, scholar: sc.scholar.moveSpeedFactor }; })()`);
(moveFactor.factor < 1 ? ok : bad)('躺平 BUFF 移速倍率 < 1（代价感）', JSON.stringify(moveFactor));

// ───── 4. Boss 死亡收场序列：等 Boss 入场 → 战斗路径击杀 → 序列观察 ─────
const boss1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: !!(d && d.bossSpawned), spawned: d && d.bossSpawned, alive: d && d.bossAlive }; })()`, 240000);
(boss1 && boss1.spawned ? ok : bad)('Boss 入场', JSON.stringify({ spawned: boss1 && boss1.spawned, alive: boss1 && boss1.alive }));

// 压血量到 2%，走 CombatSystem.applyHit 真实击杀路径（kill → onKill → 死亡序列）。
// 走查专用：运行时拉长序列（8s 总长 / 6s 消失窗），让「缩放旋转消失」中间帧可被截到；
// 仅改运行时对象，public/config 里的 JSON 不动。
const killed = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const boss = sc.spawner.monsters.find((m) => m.isBoss && m.alive);
  if (!boss) return 'no-boss';
  sc.packed.polish.bossDeath.sequenceTotalMs = 8000;
  sc.packed.polish.bossDeath.vanishMs = 6000;
  boss.hp = Math.max(1, boss.maxHp * 0.02);
  sc.combat.applyHit({ monster: boss, damage: boss.hp + 10, comboMultiplier: 1, dirX: 0, dirY: -1, knockback: 0 });
  return { hp: boss.hp, alive: boss.alive };
})()`);
console.log('   kill 结果:', JSON.stringify(killed));

// 序列期间：bossDeathActive=true 且世界冻结（timeLeft/aliveMonsters 两次采样一致）
const seq1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: !!(d && d.bossDeathActive), remain: d && d.bossDeathRemaining, time: d && d.timeLeft, monsters: d && d.aliveMonsters }; })()`, 30000);
await page.shot(path.join(OUT, 'boss-death-face.png'));
(seq1 && seq1.done ? ok : bad)('Boss 死亡序列启动（hitstop + 死亡脸 + 台词横幅）', `remain=${seq1 && seq1.remain}`);
const frozen1 = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { time: d.timeLeft, monsters: d.aliveMonsters, remain: d.bossDeathRemaining }; })()`);
await sleep(400);
const frozen2 = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { time: d.timeLeft, monsters: d.aliveMonsters, remain: d.bossDeathRemaining }; })()`);
const stillSeq = frozen2.remain > 0 && frozen1.remain > 0;
const frozenOk = stillSeq && frozen1.time === frozen2.time && frozen1.monsters === frozen2.monsters;
(frozenOk ? ok : bad)('序列期间世界冻结（小怪/倒计时停住）', JSON.stringify({ frozen1, frozen2 }));
// 拉长后的 vanish 窗口 = 6s：现在必然处于「缩放旋转消失」进行时，抓中间帧
await sleep(2200);
await page.shot(path.join(OUT, 'boss-death-vanish.png'));
await page.shot(path.join(OUT, 'boss-death-vanish-late.png'));

// 序列结束 → 自动移交 ResultScene
const result = await pollUntil(`(() => {
  const g = __KB_GAME__;
  const s = g.scene.scenes.find((x) => x.scene && x.scene.isActive());
  return { done: !!s && s.scene.key === 'ResultScene', key: s ? s.scene.key : null };
})()`, 90000);
await page.shot(path.join(OUT, 'result.png'));
(result && result.done ? ok : bad)('死亡序列结束 → ResultScene 移交', `scene=${result && result.key}`);

// ───── 汇总 ─────
console.log('\n=== T-026 走查结果 ===');
for (const r of results) console.log(r);
console.log(`JS 异常数: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  异常:', e.split('\n')[0]);
console.log('截图目录:', OUT);

await closePage(9394, page.id);
browser.proc.kill();
process.exit(errors.length > 0 ? 1 : 0);
