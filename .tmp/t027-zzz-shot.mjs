import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from '../scripts/cdp.mjs';
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 't027-shots');
const browser = await launchBrowser({ port: 9396, width: 2340, height: 1080 });
const page = await newPage(9396, 'about:blank');
await emulateXiaomi(page);
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(800);
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => { try {
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    localStorage.setItem('knowledge-mow-king.save.v1', JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 20, daily: { date: n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate()), rewardTime: 0 }, updatedAt: Date.now() }));
    localStorage.setItem('knowledge-mow-king.tutorial.v1', 'done');
  } catch (e) {} })();`,
});
await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Page.enable');
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(4500);
await page.evaluate(`(() => {
  const g = __KB_GAME__;
  g.scene.stop('MenuScene');
  g.scene.start('GrassCuttingScene', { level: 1, bonusTime: 0,
    quiz: { totalQuestions: 5, correctCount: 3, missCount: 1, timeoutCount: 1, accuracy: 0.6, maxCombo: 2, averageAnswerTime: 4, totalAnswerTime: 20, records: [] },
    bonus: { damageMultiplier: 1.1, rangeMultiplier: 1.05, durationMultiplier: 1.08, breakdown: { baseBonus: 1, subjectCoefficient: 1, accuracyTerm: 1, speedFactor: 1, comboFactor: 1, rawMultiplier: 1.1, floorApplied: false, ceilingApplied: false } },
    wrongAnswers: [] });
  return 'ok';
})()`);
await sleep(2500);
await page.evaluate(`(() => {
  const sc = __KB_GAME__.scene.getScene('GrassCuttingScene');
  sc.hp = 99999; sc.maxHp = 99999;
  const old = Math.random; Math.random = () => 0;
  let t = 0; while (sc.lazy.dropsSpawnedCount < 1 && t < 20) { sc.lazy.maybeDrop(sc.player.x + 40, sc.player.y); t++; }
  Math.random = old; sc.player.x += 40; return 'ok';
})()`);
await sleep(1800); // 等 Zzz 浮到 alpha 高位
await page.shot(path.join(OUT, 'lazy-zzz.png'));
console.log('shot saved');
await closePage(9396, page.id);
browser.proc.kill();
