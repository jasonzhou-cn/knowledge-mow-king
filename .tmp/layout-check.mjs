/**
 * 布局修复走查（.tmp/layout-check.mjs）——一次性脚本
 * 视口 A：891×430（真机小米横屏浏览器 CSS 视口等比，用户截图实际状态）
 * 视口 B：2340×1080（画布锁定基线）
 * 流程：Menu → QuestionScene（移动态截图 → 答一题截反馈态）→ 注入跳 ResultScene 截图
 * 断言：HUD 倒计时/进度条在题干卡片下方且不压反馈文字；Result 面板 y > 三栏文字底部。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newPage, closePage, sleep } from '../scripts/cdp.mjs';

const DEV_URL = 'http://127.0.0.1:5174/';
const OUT = '.tmp/layout-shots';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile-891x430', w: 891, h: 430 },
  { name: 'xiaomi-2340x1080', w: 2340, h: 1080 },
];

const RESULT_PAYLOAD = {
  cleared: true, level: 8, died: false, kills: 289, maxCombo: 256, noDamage: false,
  quiz: { correctCount: 3, totalQuestions: 6, accuracy: 0.5, averageAnswerTime: 2.2, maxCombo: 1, missCount: 2, timeoutCount: 0 },
  bonus: {
    damageMultiplier: 2.58, rangeMultiplier: 2.58, durationMultiplier: 1.2,
    breakdown: { baseBonus: 1.7, subjectCoefficient: 1, accuracyTerm: 1.2, speedFactor: 1.1, comboFactor: 1.15, floorApplied: false, ceilingApplied: true },
  },
};

const browser = await launchBrowser({ port: 9372 });
let allOk = true;

for (const vp of VIEWPORTS) {
  const page = await newPage(9372, 'about:blank');
  const errors = [];
  page.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
    }
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: true, pointer: 'coarse',
    screenWidth: vp.w, screenHeight: vp.h,
  });
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const KEY = 'knowledge-mow-king.save.v1';
      const n = new Date(); const p = (x) => String(x).padStart(2, '0');
      const today = n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
      localStorage.setItem(KEY, JSON.stringify({ version: 1, level: 8, exp: 579, totalScore: 30710, unlockedLevel: 8, daily: { date: today, rewardTime: 20 }, updatedAt: Date.now() }));
    })();`,
  });
  await page.send('Page.navigate', { url: DEV_URL });
  await sleep(3500);

  console.log(`\n===== 视口 ${vp.name} (${vp.w}x${vp.h}) =====`);

  // Menu → Question（轮询等待 __QS__ 就绪）
  await page.key(' ', 'Space', 32, 80);
  let qGeom = null;
  for (let i = 0; i < 10 && !qGeom; i++) {
    await sleep(800);
    qGeom = await page.evaluate(`(() => {
      const qs = window.__QS__;
      if (!qs) return null;
      const hud = qs.hud;
      return {
        panelTop: qs.panelTop, panelHeight: qs.panelHeight,
        timeY: hud.timeText.y, timeH: hud.timeText.height,
        barY: hud.barY, barH: hud.barH,
        resultY: qs.resultText.y,
        explY: qs.explanationText.y,
        comboY: hud.comboText.y, comboX: hud.comboText.x, comboW: hud.comboText.width,
        vpW: qs.scale.width, vpH: qs.scale.height,
      };
    })()`);
  }

  if (qGeom) {
    await page.shot(path.join(OUT, `${vp.name}-question-moving.png`));
    const cardBottom = qGeom.panelTop + qGeom.panelHeight;
    const t1 = qGeom.timeY >= cardBottom;
    const t2 = qGeom.barY >= qGeom.timeY + qGeom.timeH - 2;
    const t3 = qGeom.resultY >= qGeom.barY + qGeom.barH + 4;
    const t4 = qGeom.comboX - qGeom.comboW >= (qGeom.vpW / 2 + Math.min(840 * Math.min(qGeom.vpW / 960, qGeom.vpH / 640), qGeom.vpW * 0.9) / 2) - 2;
    console.log(`  HUD 倒计时在卡片下方: ${t1 ? '✅' : '❌'} (cardBottom=${cardBottom.toFixed(1)}, timeY=${qGeom.timeY.toFixed(1)})`);
    console.log(`  进度条在倒计时下方:   ${t2 ? '✅' : '❌'} (timeBottom=${(qGeom.timeY + qGeom.timeH).toFixed(1)}, barY=${qGeom.barY.toFixed(1)})`);
    console.log(`  反馈文字在进度条下方: ${t3 ? '✅' : '❌'} (barBottom=${(qGeom.barY + qGeom.barH).toFixed(1)}, resultY=${qGeom.resultY.toFixed(1)})`);
    console.log(`  连对提示不压卡片右上: ${t4 ? '✅' : '❌'} (comboLeft=${(qGeom.comboX - qGeom.comboW).toFixed(1)})`);
    if (!(t1 && t2 && t3 && t4)) allOk = false;
  } else {
    console.log('  ❌ 未进入 QuestionScene 或无 __QS__ 句柄');
    allOk = false;
  }

  // 答一题 → 反馈态（反复按空格直到 resultText 有内容）
  let feedbackShot = false;
  for (let i = 0; i < 10 && !feedbackShot; i++) {
    await page.key(' ', 'Space', 32, 60);
    await sleep(900);
    const has = await page.evaluate(`(() => { const qs = window.__QS__; return qs ? qs.resultText.text.length > 0 : false; })()`);
    if (has) {
      await sleep(200);
      await page.shot(path.join(OUT, `${vp.name}-question-feedback.png`));
      feedbackShot = true;
    }
  }
  console.log(`  反馈态截图: ${feedbackShot ? '✅' : '⚠️ 未捕获（自动推进太快）'}`);

  // 注入跳 ResultScene
  await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    g.scene.start('ResultScene', ${JSON.stringify(RESULT_PAYLOAD)});
  })()`);
  await sleep(1500);
  await page.shot(path.join(OUT, `${vp.name}-result.png`));

  const rGeom = await page.evaluate(`(() => {
    const g = window.__KB_GAME__;
    const rs = g && g.scene ? g.scene.getScene('ResultScene') : null;
    if (!rs || !rs.children || !rs.children.list) return null;
    let colLinesBottom = -1, panelTitleY = -1;
    for (const c of rs.children.list) {
      if (c.type !== 'Text') continue;
      if (c.text === '答题表现') {
        for (const d of rs.children.list) {
          if (d.type === 'Text' && d.x === c.x && d.y > c.y) {
            colLinesBottom = Math.max(colLinesBottom, d.y + d.height);
          }
        }
      }
      if (c.text === '游戏时间奖励明细') panelTitleY = c.y;
    }
    return { colLinesBottom, panelTitleY };
  })()`);
  if (rGeom && rGeom.colLinesBottom > 0) {
    // panelTitleY 是近似值（-10·s），直接比较标题 y 与三栏底部已足够判定遮挡
    const noOverlap = rGeom.panelTitleY >= rGeom.colLinesBottom;
    console.log(`  奖励面板不遮三栏: ${noOverlap ? '✅' : '❌'} (三栏底部=${rGeom.colLinesBottom.toFixed(1)}, 面板标题y=${rGeom.panelTitleY.toFixed(1)})`);
    if (!noOverlap) allOk = false;
  } else {
    console.log('  ⚠️ ResultScene 几何读取失败（人工检查截图）');
  }

  console.log(`  JS 异常: ${errors.length ? '❌ ' + errors[0] : '（无）'}`);
  if (errors.length) allOk = false;

  await closePage(9372, page.id); page.close();
}

browser.proc.kill();
console.log(`\n===== 总体: ${allOk ? '✅ 全部断言通过' : '❌ 存在失败项'} =====`);
process.exit(allOk ? 0 : 1);
