/**
 * T-016 答错暂停验证（scripts/verify-t016-wrong-pause.mjs）
 * 用 dev 模式暴露的 window.__QS__（QuestionScene 实例）做确定性断言：
 *  1. 答错 → state==='wrongPause'，展示解题思路（explanationText 含「解题思路」）
 *  2. wrongPause 期间答题倒计时冻结（engine.remaining 不减少）
 *  3. 按空格/点击 → 进入下一题（state 回 moving，currentNumber+1）
 *  4. 答对 → 不进入 wrongPause，正常自动推进（explanationText 显示当前题解析，不张冠李戴）
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5174/';
const OUT = 'reports/t016-wrong-pause';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ port: 9377 });
const page = await newPage(9377, 'about:blank');
const errors = [];
page.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 472, deviceScaleFactor: 1, mobile: true });

await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const KEY = 'knowledge-mow-king.save.v1';
    const n = new Date(); const p = (x) => String(x).padStart(2, '0');
    const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 1, exp: 0, totalScore: 0, unlockedLevel: 1, daily: { date: today, rewardTime: 0 }, updatedAt: Date.now() }));
  })();`,
});

await page.send('Page.navigate', { url: URL });
await sleep(3500);
await page.key(' ', 'Space', 32, 80);
await sleep(2500);

const readQS = `(() => {
  const s = window.__QS__;
  if (!s) return { ok: false };
  return { ok: true, state: s.state, rem: s.engine ? s.engine.remaining : -1, num: s.engine ? s.engine.currentNumber : -1,
    expl: s.explanationText ? s.explanationText.text : '', hint: s.hintText ? s.hintText.text : '' };
})()`;

const first = await page.evaluate(readQS);
console.log('初始:', first.ok ? `state=${first.state} 题号=${first.num}` : 'no __QS__');
if (!first.ok) { console.log('❌ 未拿到 __QS__（可能没进答题场景）'); process.exit(1); }

// 循环触发：答错（wrongPause）即断言；答对（feedback）等自动推进后重试；miss（moving）重试
let done = false;
for (let i = 0; i < 15 && !done; i++) {
  const st = await page.evaluate(`(() => {
    const s = window.__QS__;
    if (!s) return { state: 'noQS' };
    if (s.state === 'moving') {
      const g = window.__KB_GAME__;
      s.handleStop(g.scale.width / 2, g.scale.height / 2);
    }
    return { state: s.state, rem: s.engine ? s.engine.remaining : -1, num: s.engine ? s.engine.currentNumber : -1,
      expl: s.explanationText ? s.explanationText.text : '', hint: s.hintText ? s.hintText.text : '' };
  })()`);
  await sleep(700);

  if (st.state === 'wrongPause') {
    console.log(`\n[${i}] 答错 → wrongPause ✓`);
    console.log('  展示文案:', st.expl);
    console.log('  hint:', st.hint);
    if (!st.expl.includes('解题思路')) { console.log('  ❌ explanationText 缺「解题思路」'); process.exit(2); }
    const frozenAt = st.rem;
    await page.shot(path.join(OUT, 'wrong-pause.png'));
    await sleep(2500);
    const st2 = await page.evaluate(`(() => { const s = window.__QS__; return { rem: s.engine.remaining, state: s.state }; })()`);
    const frozen = Math.abs(st2.rem - frozenAt) < 0.05;
    console.log(`  冻结验证: 暂停时 ${frozenAt.toFixed(1)}s → 2.5s 后 ${st2.rem.toFixed(1)}s (state=${st2.state}) ${frozen ? '✓ 倒计时冻结' : '❌ 仍在走'}`);
    if (!frozen) process.exit(3);
    await page.key(' ', 'Space', 32, 60);
    await sleep(1000);
    const st3 = await page.evaluate(`(() => { const s = window.__QS__; return { state: s.state, num: s.engine.currentNumber }; })()`);
    // 答错时 commit() 已推进指针到下一题，wrongPause 展示的正是下一题状态；
    // 确认后应恢复 moving 且仍在同一题（题号不变）——即「看完思路后接着答下一题」
    const resumed = st3.state === 'moving' && st3.num === st.num;
    console.log(`  确认后: state=${st3.state} 题号=${st.num}→${st3.num} ${resumed ? '✓ 恢复答题（同一题）' : '❌ 异常'}`);
    if (!resumed) process.exit(4);
    await page.shot(path.join(OUT, 'after-continue.png'));
    done = true;
  } else if (st.state === 'feedback') {
    // 答对：验证反馈展示的是当前题解析（快照修复），再等推进后重试
    console.log(`[${i}] 答对自动推进（题号 ${st.num}）；反馈=${st.expl.slice(0, 30)}`);
    if (st.expl.includes('解题思路')) { console.log('  ❌ 答对不应展示解题思路'); process.exit(5); }
    await sleep(2600);
  } else if (st.state === 'moving') {
    console.log(`[${i}] miss 重试`);
    await sleep(1000);
  } else {
    console.log(`[${i}] state=${st.state}`);
  }
}
if (!done) { console.log('❌ 15 次尝试内未触发 wrongPause'); process.exit(6); }

console.log('\n=== 异常 ===');
console.log(errors.length ? errors.join('\n') : '（无）');
await closePage(9377, page.id); page.close(); browser.proc.kill(); process.exit(0);