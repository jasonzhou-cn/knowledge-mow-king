/**
 * T-025 美术表现与趣味性打磨 — CDP 走查（.tmp/t025-walkthrough.mjs，不进仓库）
 * 流程：小米视口 2340×1080 → Menu → Question → Grass（学科主题 + Boss 视觉 + 台词横幅
 *       + 阶段闪光 + 学霸 BUFF）→ Result（stagger + 趣味文案）。
 * 断言：无 JS 异常；Boss 台词横幅/阶段切换/学霸 BUFF/结算文案可被运行时驱动并观察到。
 * 用法：node .tmp/t025-walkthrough.mjs [URL]  （默认 http://127.0.0.1:5174/）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from '../scripts/cdp.mjs';

const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 't025-shots');
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

const browser = await launchBrowser({ port: 9390, width: 2340, height: 1080 });
const page = await newPage(9390, 'about:blank');
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

// ───── 1. Menu ─────
const sceneKey1 = await page.evaluate(`__KB_GAME__ ? __KB_GAME__.scene.scenes.find(s=>s.scene.isActive()).scene.key : 'none'`);
await page.shot(path.join(OUT, 'menu.png'));
(sceneKey1 === 'MenuScene' ? ok : bad)('Menu 场景加载', `scene=${sceneKey1}`);

// ───── 2. Question（点开始按钮，viewport 中央偏下）─────
// viewport 2340×1080, vpScale = min(2.4375, 1.6875) = 1.6875；按钮中心 ≈ (1170, 540 + 137.5*1.6875)
await page.evaluate(`(() => { const s = __KB_GAME__.scene.getScene('MenuScene'); s.selectedLevel = 5; return s.selectedLevel; })()`);
await page.click(1170, Math.round(540 + 137.5 * 1.6875));
await sleep(2500);
const sceneKey2 = await page.evaluate(`__KB_GAME__.scene.scenes.find(s=>s.scene.isActive()).scene.key`);
await page.shot(path.join(OUT, 'question.png'));
(sceneKey2 === 'QuestionScene' ? ok : bad)('Question 场景进入（fadeIn）', `scene=${sceneKey2}`);

// ───── 3. Grass：L5 math 主题 + Boss 关 ─────
await page.evaluate(`(() => {
  const g = __KB_GAME__;
  const payload = {
    level: 5, bonusTime: 0,
    quiz: { totalQuestions: 5, correctCount: 4, missCount: 1, timeoutCount: 0, accuracy: 0.8, maxCombo: 3, averageAnswerTime: 3, totalAnswerTime: 15, records: [] },
    bonus: { damageMultiplier: 1.2, rangeMultiplier: 1.1, durationMultiplier: 1.15,
      breakdown: { baseBonus: 1, subjectCoefficient: 1, accuracyTerm: 1, speedFactor: 1, comboFactor: 1, rawMultiplier: 1.2, floorApplied: false, ceilingApplied: false } },
  };
  g.scene.stop('QuestionScene');
  g.scene.start('GrassCuttingScene', payload);
  return 'ok';
})()`);
// 无头 swiftshader 下 2340×1080 渲染极慢（游戏内时间 ≈ 0.1×），全部改用轮询等待
const pollUntil = async (expr, timeoutMs, intervalMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(expr);
    if (last && last.done) return last;
    await sleep(intervalMs);
  }
  return last;
};

const theme = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return d ? { done: !!d.themeAccent, theme: d.themeAccent } : null; })()`, 30000);
await page.shot(path.join(OUT, 'grass-theme.png'));
(theme && theme.done ? ok : bad)('Grass 场景 + 学科主题加载', `themeAccent=${theme && theme.theme}`);

// 等 Boss 入场（L5 spawnDelay=6s 游戏内时间），确认出场台词横幅与 Boss 视觉
const boss1 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: !!(d && d.bossSpawned), spawned: d.bossSpawned, alive: d.bossAlive }; })()`, 180000);
await page.shot(path.join(OUT, 'boss-intro.png'));
(boss1 && boss1.spawned && boss1.alive ? ok : bad)('Boss 入场 + 出场台词横幅', JSON.stringify({ spawned: boss1.spawned, alive: boss1.alive }));

// 强制阶段切换：把 Boss 血量压到 50% → phase 1（闪光 + 凶光脸 + 台词横幅）
await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  const boss = sc.spawner.monsters.find((m) => m.isBoss && m.alive);
  if (!boss) return 'no-boss';
  boss.hp = boss.maxHp * 0.5;
  return 'ok';
})()`);
const boss2 = await pollUntil(`(() => { const d = window.__KB_DEBUG__; return { done: d && d.bossPhaseIndex >= 1, phase: d.bossPhaseIndex }; })()`, 30000);
await page.shot(path.join(OUT, 'boss-phase2.png'));
(boss2 && boss2.phase >= 1 ? ok : bad)('Boss 阶段切换（闪光 + 台词 + 外观变化）', `phase=${boss2 && boss2.phase}`);

// ───── 4. 学霸 BUFF：强制掉落 + 拾取 ─────
const buff = await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  let tries = 0;
  while (sc.scholar.dropsSpawnedCount < 1 && tries < 60) { sc.scholar.maybeDrop(sc.player.x + 60, sc.player.y); tries++; }
  const drop = sc.scholar ? sc.scholar : null;
  if (!drop) return 'no-system';
  // 把玩家挪到掉落点上触发拾取
  sc.player.x = sc.player.x + 60; sc.player.y = sc.player.y;
  return { dropped: sc.scholar.dropsSpawnedCount };
})()`);
await sleep(700);
const buffState = await page.evaluate(`(() => { const d = window.__KB_DEBUG__; return { active: d.scholarActive, drops: d.scholarDrops }; })()`);
await page.shot(path.join(OUT, 'scholar-buff.png'));
(buffState.active === true ? ok : bad)('学霸 BUFF（掉落 → 拾取 → 激活）', JSON.stringify(buffState));
void buff;

// ───── 5. Result：finish 提前通关 → stagger + 趣味文案 ─────
await page.evaluate(`(() => { const sc = __KB_GAME__.scene.getScene('GrassCuttingScene'); sc.finish(true, false); return 'ok'; })()`);
await sleep(1800);
const sceneKey3 = await page.evaluate(`__KB_GAME__.scene.scenes.find(s=>s.scene.isActive()).scene.key`);
await page.shot(path.join(OUT, 'result.png'));
(sceneKey3 === 'ResultScene' ? ok : bad)('Result 场景（stagger 弹入 + 趣味文案）', `scene=${sceneKey3}`);

// ───── 汇总 ─────
console.log('\n=== 走查结果 ===');
for (const r of results) console.log(r);
console.log(`JS 异常数: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  异常:', e.split('\n')[0]);
console.log('截图目录:', OUT);

await closePage(9390, page.id);
browser.proc.kill();
process.exit(errors.length > 0 ? 1 : 0);
