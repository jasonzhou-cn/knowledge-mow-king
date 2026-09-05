/** T-025 探针：直查 __KB_DEBUG__ 的 key 与 Boss 生成状态 */
import { launchBrowser, newPage, closePage, sleep, emulateXiaomi } from '../scripts/cdp.mjs';

const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5174/';
const browser = await launchBrowser({ port: 9391, width: 2340, height: 1080 });
const page = await newPage(9391, 'about:blank');
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
    } catch (e) {}
  })();`,
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
});
await page.send('Page.navigate', { url: PAGE_URL });
await sleep(4500);

console.log('keys:', await page.evaluate(`Object.keys(window.__KB_DEBUG__ || {})`));

// 直接启动 GrassCuttingScene
await page.evaluate(`(() => {
  const g = __KB_GAME__;
  const payload = {
    level: 5, bonusTime: 0,
    quiz: { totalQuestions: 5, correctCount: 4, missCount: 1, timeoutCount: 0, accuracy: 0.8, maxCombo: 3, averageAnswerTime: 3, totalAnswerTime: 15, records: [] },
    bonus: { damageMultiplier: 1.2, rangeMultiplier: 1.1, durationMultiplier: 1.15,
      breakdown: { baseBonus: 1, subjectCoefficient: 1, accuracyTerm: 1, speedFactor: 1, comboFactor: 1, rawMultiplier: 1.2, floorApplied: false, ceilingApplied: false } },
  };
  g.scene.stop('MenuScene');
  g.scene.start('GrassCuttingScene', payload);
  return 'ok';
})()`);
for (let i = 0; i < 10; i++) {
  await sleep(1500);
  const s = await page.evaluate(`(() => {
    const d = window.__KB_DEBUG__ || {};
    return { t: Math.round((d.elapsed||0)*10)/10, spawned: d.bossSpawned, isBoss: d.isBossLevel,
      theme: typeof d.themeAccent === 'function' ? 'fn' : d.themeAccent,
      timeLeft: Math.round((d.timeLeft||0)*10)/10 };
  })()`);
  console.log(`t+${(i + 1) * 1.5}s:`, JSON.stringify(s));
  if (s.spawned) break;
}
console.log('errors:', errors.length, errors.slice(0, 3).map((e) => e.split('\n')[0]));
await closePage(9391, page.id);
browser.proc.kill();
