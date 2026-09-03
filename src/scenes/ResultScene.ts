/**
 * 关卡结算场景（src/scenes/ResultScene.ts）
 * 职责：汇总并展示本关的答题表现、割草战果、经验与等级提升、游戏时间奖励明细，
 *      把奖励写入存档（含每日上限钳制），并提供「下一关 / 重玩 / 返回主菜单」入口。
 *
 * 透明度要求（GDD 2.4）：奖励必须逐条标注来源，并明确显示「单次上限」与「当日已用 / 上限」，
 *      让玩家完全知情，不产生「游戏作弊」的误解。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { resolveNextLevel } from '../config/resolve';
import type { LevelConfig, RewardConfig } from '../config/types';
import { progression } from '../systems/ProgressionSystem';
import { applyDailyCap, calculateRewards, calculateScore, formatRewardItems } from '../systems/RewardSystem';
import { sfx } from '../systems/SfxController';
import { Palette, css, textStyle } from '../ui/Palette';
import { popScale, ripple } from '../ui/Feedback';
import { formatOneDecimal } from '../utils/MathUtil';
import type { LevelStartData } from './MenuScene';
import type { ResultSceneData } from './GrassCuttingScene';

/** 一个可点击按钮的句柄 */
interface MenuButton {
  container: Phaser.GameObjects.Container;
}

/** T-025 stagger 弹入动画的目标约束（Graphics/Text/Container 均满足） */
interface StaggerTarget {
  alpha: number;
  setAlpha(value: number): this;
  scale: number;
  setScale(value: number): this;
}

export class ResultScene extends Phaser.Scene {
  private payload: ResultSceneData | null = null;

  constructor() {
    super({ key: 'ResultScene' });
  }

  init(data: object): void {
    this.payload = data as ResultSceneData;
  }

  create(): void {
    const payload = this.payload;
    if (!payload) {
      this.scene.start('MenuScene');
      return;
    }

    const loader = ConfigLoader.getInstance();
    const rewardConfig = loader.getConfig('rewardConfig');
    const levelConfig = loader.getConfig('levelConfig') as LevelConfig;
    const questionConfig = loader.getConfig('questionConfig');
    const answerMode = questionConfig.answerSettings.mode;
    // arrow / cursor 模式没有「没停准」概念（arrow = 选中即确认；cursor = 停在间隙算 miss），
    // track 模式才有「没停准」措辞
    const useMissWording = answerMode === 'track';

    const w = this.scale.width;
    const h = this.scale.height;
    /**
     * 视口高度自适应缩放：矮屏（手机浏览器去 UI 后 h≈390-400）下整体压缩布局，
     * 避免固定坐标导致按钮遮挡统计文字、奖励面板超出屏幕（实测反馈 2026-09-01）。
     * 高屏（方案 C 19.5:9 h≈1080）按同比例放大至 1.35，避免内容挤在上半屏、下部大面积留白
     * （实测反馈 2026-09-03）。下限 0.72 保证极矮屏仍可读。
     */
    const s = Phaser.Math.Clamp(h / 500, 0.72, 1.35);

    // ───── 垂直弹性布局（消除遮挡 + 疏密均衡）─────
    // 旧版所有 y 基于 h=500 设计且 s 封顶 1：高屏下内容全挤在上半屏，
    // 且三栏 5 行文字底部（≈272·s）与奖励面板 y（272·s）压线，面板后绘制直接盖住文字。
    const panelW = Math.min(Math.max(904 * s, w * 0.6), w - 48);
    const colGap = Math.max(232 * s, panelW * 0.3);
    const btnZone = 78 * s;               // 按钮高度 46·s + 底边距 32·s
    const colY0 = 126 * s;
    const colBlockH = 26 * s + 5 * 24 * s; // 三栏块高：标题行 + 最多 5 行数据
    const panelH = 132 * s;
    const slack = Math.max(0, h - btnZone - colY0 - colBlockH - panelH);
    // slack 充足（高屏）时把三栏与面板往下摊开；矮屏（slack < 40·s）保持紧凑原布局
    const spread = slack > 40 * s;
    const colY = colY0 + (spread ? slack * 0.35 : 0);
    const panelY = colY + colBlockH + (spread ? Math.min(slack * 0.3, 60 * s) : 0);

    // ───── 结算与写档（先算后展示，保证展示的每一笔都已落盘） ─────
    const score = calculateScore(
      { quiz: payload.quiz, kills: payload.kills, noDamage: payload.noDamage },
      rewardConfig,
      payload.maxCombo,
    );
    const expGain = this.calculateExp(rewardConfig, payload);
    const levelUp = progression.addExp(expGain);
    if (levelUp) sfx.play('levelUp');
    progression.addScore(score);
    progression.save();

    const rewardInput = { quiz: payload.quiz, kills: payload.kills, noDamage: payload.noDamage };
    const raw = calculateRewards(rewardInput, rewardConfig);
    const dailyLimit = rewardConfig.rewardLimits.dailyRewardTimeMax;
    const before = progression.dailyRewardTime;
    const calc = applyDailyCap(raw, before, dailyLimit);
    const granted = progression.addDailyRewardTime(calc.grantedTotal, dailyLimit);

    if (payload.cleared) {
      const next = resolveNextLevel(levelConfig, payload.level);
      progression.unlockLevel(next);
    }

    // ───── 展示 ─────
    const staggerItems: Array<{ obj: StaggerTarget; pop: boolean }> = [];
    const pushStagger = (obj: StaggerTarget, pop: boolean): void => {
      staggerItems.push({ obj, pop });
    };
    this.drawBackdrop(w, h);
    // 三栏统计区的中央高亮装饰块（跟随 panelW / colY，替代旧版 960×640 硬编码几何）
    const deco = this.add.graphics();
    deco.fillStyle(Palette.background.panel, 0.5);
    deco.fillRoundedRect(w / 2 - panelW / 2, colY - 10 * s, panelW, colBlockH + 20 * s, 16);
    pushStagger(deco, false);

    const title = payload.cleared ? '关卡通过！' : '再来一次！';
    const titleColor = payload.cleared ? Palette.accent.primary : Palette.status.warning;
    const titleText = this.add
      .text(w / 2, 40 * s, title, textStyle(Math.round(42 * s), css(titleColor), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0);
    pushStagger(titleText, true);

    const subtitle = this.add
      .text(
        w / 2,
        92 * s,
        `第 ${payload.level} 关 · ${payload.died ? '生命耗尽' : '时间结束'}`,
        textStyle(Math.round(18 * s), css(Palette.text.secondary)),
      )
      .setOrigin(0.5, 0);
    pushStagger(subtitle, true);

    // T-025：结算趣味文案——按表现档位从 resultFlavor.json 抽一条，放在副标题下方
    const flavorLine = this.pickFlavorLine(payload);
    if (flavorLine) {
      const flavorText = this.add
        .text(w / 2, 116 * s, flavorLine, textStyle(Math.round(17 * s), css(Palette.accent.gold)))
        .setOrigin(0.5, 0);
      pushStagger(flavorText, true);
    }

    // 左栏：答题表现
    this.addColumn(w / 2 - colGap, colY, '答题表现', [
      `答对 ${payload.quiz.correctCount} / ${payload.quiz.totalQuestions} 题`,
      `正确率 ${Math.round(payload.quiz.accuracy * 100)}%`,
      `平均每题 ${formatOneDecimal(payload.quiz.averageAnswerTime)} 秒`,
      `最大连对 ${payload.quiz.maxCombo}`,
      this.answerStatsLine(payload.quiz, useMissWording),
    ], s).forEach((o) => pushStagger(o, true));

    // 中栏：割草战果
    this.addColumn(w / 2, colY, '割草战果', [
      `击杀 ${payload.kills}`,
      `最高连击 ${payload.maxCombo}`,
      `本关得分 ${score}`,
      `伤害加成 ×${payload.bonus.damageMultiplier.toFixed(2)}`,
      `范围加成 ×${payload.bonus.rangeMultiplier.toFixed(2)}`,
    ], s).forEach((o) => pushStagger(o, true));

    // T-020 答题质量透明化：「加成来源」三行小字移入奖励面板右上角（旧版放在中栏下方，
    // 与面板 y 压线被面板盖住——实测遮挡 2026-09-03），语义上本就属于奖励透明化的一部分
    const breakdown = payload.bonus.breakdown;
    const breakdownText =
      `加成来源  正确率项 ×${breakdown.accuracyTerm.toFixed(2)}  速度项 ×${breakdown.speedFactor.toFixed(2)}  连对项 ×${breakdown.comboFactor.toFixed(2)}`;

    // 右栏：成长
    const need = progression.expToNextLevel;
    this.addColumn(w / 2 + colGap, colY, '成长', [
      `等级 ${progression.level}`,
      `经验 ${Math.round(progression.exp)} / ${Number.isFinite(need) ? Math.round(need) : '已满级'}`,
      `本关获得经验 +${expGain}`,
      `累计得分 ${Math.round(progression.totalScore)}`,
    ], s).forEach((o) => pushStagger(o, true));

    // 奖励明细：来源逐条列出 + 上限状态
    this.drawRewardPanel(w, panelY, panelW, rewardConfig, calc, granted, dailyLimit, breakdownText, s)
      .forEach((o) => pushStagger(o, true));

    // 等级提升动画
    if (levelUp) this.playLevelUpAnimation(w, levelUp.to, s, colY + colBlockH / 2);

    // 按钮（缩小尺寸 + 更贴底，确保不遮挡三栏统计与奖励面板）
    const nextBtn = this.createButton(w / 2 - 130 * s, h - 32 * s, payload.cleared ? '进入下一关' : '重玩本关', Palette.accent.primary, () => {
      const nextLevel = payload.cleared ? resolveNextLevel(levelConfig, payload.level) : payload.level;
      const data: LevelStartData = { level: nextLevel, bonusTime: granted };
      this.scene.start('QuestionScene', data);
    }, s);
    const menuBtn = this.createButton(w / 2 + 130 * s, h - 32 * s, '返回主菜单', Palette.background.panelSoft, () => {
      this.scene.start('MenuScene');
    }, s);
    staggerItems.push({ obj: nextBtn.container, pop: true }, { obj: menuBtn.container, pop: true });

    // T-025：标题 / 三栏 / 面板 / 按钮依次弹入（间隔与时长来自 polishSettings）
    const polish = ConfigLoader.getInstance().getConfig('grassCuttingConfig').polishSettings;
    staggerItems.forEach((item, i) => {
      item.obj.setAlpha(0);
      if (item.pop) {
        item.obj.setScale(0.92);
        this.tweens.add({
          targets: item.obj,
          alpha: 1,
          scale: 1,
          delay: i * polish.resultStaggerMs,
          duration: polish.resultPopMs,
          ease: 'Back.easeOut',
        });
      } else {
        this.tweens.add({
          targets: item.obj,
          alpha: 1,
          delay: i * polish.resultStaggerMs,
          duration: polish.resultPopMs,
        });
      }
    });

    // T-025：场景切换 fade 过渡
    this.cameras.main.fadeIn(polish.sceneFadeInMs, 0, 0, 0);
  }

  /**
   * T-025：按表现档位从 resultFlavor.json 抽一条趣味文案。
   * 档位规则：死亡 → fail；否则按正确率从高到低取第一个命中的 tierRules 档；都不中走 bad 兜底。
   */
  private pickFlavorLine(payload: ResultSceneData): string {
    try {
      const flavor = ConfigLoader.getInstance().getConfig('resultFlavor');
      let tier = 'bad';
      if (payload.died) {
        tier = 'fail';
      } else {
        const ordered = Object.entries(flavor.tierRules).sort(
          (a, b) => (b[1]?.minAccuracy ?? 0) - (a[1]?.minAccuracy ?? 0),
        );
        for (const [name, rule] of ordered) {
          if (payload.quiz.accuracy >= (rule?.minAccuracy ?? 1)) {
            tier = name;
            break;
          }
        }
      }
      const pool = flavor.byResult[tier] ?? [];
      if (pool.length === 0) return '';
      return pool[Math.floor(Math.random() * pool.length)];
    } catch {
      return '';
    }
  }

  /** 计算本关经验：击杀 + 答对 + 通关奖励 */
  private calculateExp(config: RewardConfig, payload: ResultSceneData): number {
    const s = config.scoreSettings;
    return Math.round(
      payload.kills * s.expPerKill +
        payload.quiz.correctCount * s.expPerCorrectAnswer +
        (payload.cleared ? s.expLevelClearBonus : 0),
    );
  }

  /** 绘制背景（纯底色；三栏装饰块由 create 按实际布局几何绘制） */
  private drawBackdrop(w: number, h: number): void {
    const g = this.add.graphics();
    g.fillStyle(Palette.background.deep, 1);
    g.fillRect(0, 0, w, h);
  }

  /**
   * 答题表现的「命中/超时」统计行文案：
   *  - 箭头模式没有「没停准」概念，改用「答错 N 次」更准确；
   *  - 轨道模式保留原文案（含 miss 次数）。
   */
  private answerStatsLine(quiz: { missCount: number; timeoutCount: number; correctCount: number; totalQuestions: number }, arrowMode: boolean): string {
    if (arrowMode) {
      const wrong = quiz.totalQuestions - quiz.correctCount;
      return `答错 ${wrong} 次 · 超时 ${quiz.timeoutCount} 次`;
    }
    return `没停准 ${quiz.missCount} 次 · 超时 ${quiz.timeoutCount} 次`;
  }

  /** 绘制一个三栏数据卡片（返回卡片对象，供 stagger 弹入动画使用） */
  private addColumn(x: number, y: number, title: string, lines: string[], s: number): Phaser.GameObjects.Text[] {
    const titleText = this.add
      .text(x, y, title, textStyle(Math.round(19 * s), css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0);
    const bodyText = this.add
      .text(x, y + 26 * s, lines.join('\n'), textStyle(Math.round(16 * s), css(Palette.text.primary), {
        align: 'center',
        lineSpacing: 5,
      }))
      .setOrigin(0.5, 0);
    return [titleText, bodyText];
  }

  /**
   * 绘制奖励面板：明细 + 加成来源（右上角）+ 上限状态，满足奖励规则透明化要求。
   * 返回面板全部显示对象，供 stagger 弹入动画使用。
   */
  private drawRewardPanel(
    w: number,
    y: number,
    panelW: number,
    config: RewardConfig,
    calc: ReturnType<typeof applyDailyCap>,
    granted: number,
    dailyLimit: number,
    breakdownText: string,
    s: number,
  ): Array<Phaser.GameObjects.Graphics | Phaser.GameObjects.Text> {
    const items: Array<Phaser.GameObjects.Graphics | Phaser.GameObjects.Text> = [];
    const panel = this.add.graphics();
    const panelH = Math.round(132 * s);
    const left = w / 2 - panelW / 2;
    const right = w / 2 + panelW / 2;
    const pad = 28 * s;
    panel.fillStyle(Palette.background.panel, 0.9);
    panel.fillRoundedRect(left, y, panelW, panelH, 16);
    panel.lineStyle(2, Palette.accent.gold, 0.6);
    panel.strokeRoundedRect(left, y, panelW, panelH, 16);
    items.push(panel);

    items.push(
      this.add
        .text(left + pad, y + 10 * s, '游戏时间奖励明细', textStyle(Math.round(17 * s), css(Palette.accent.gold), { fontStyle: 'bold' }))
        .setOrigin(0, 0),
    );

    // 加成来源：面板右上角小字（矮屏下不再与三栏/明细内容抢空间）
    items.push(
      this.add
        .text(right - pad, y + 12 * s, breakdownText, textStyle(Math.round(13 * s), css(Palette.text.hint)))
        .setOrigin(1, 0),
    );

    items.push(
      this.add
        .text(left + pad, y + 40 * s, formatRewardItems(calc.items), textStyle(Math.round(15 * s), css(Palette.text.primary), { lineSpacing: 4 }))
        .setOrigin(0, 0),
    );

    const capLines = [
      `本次应发 ${calc.singleCappedTotal}s　单次上限 ${config.rewardLimits.singleRewardTimeMax}s${calc.singleCapped ? '（已触发）' : ''}`,
      `今日已领 ${calc.dailyUsedAfter}s / ${dailyLimit}s${calc.dailyCapped ? '（已达每日上限）' : ''}`,
      `实际发放 +${granted}s（下一关割草时长增加）`,
    ];
    items.push(
      this.add
        .text(right - pad, y + 40 * s, capLines.join('\n'), textStyle(Math.round(15 * s), css(Palette.text.secondary), {
          align: 'right',
          lineSpacing: 5,
        }))
        .setOrigin(1, 0),
    );
    return items;
  }

  /** 等级提升动画：横幅弹入 + 金色光环扩散（中心点由布局传入） */
  private playLevelUpAnimation(w: number, newLevel: number, s: number, cy: number): void {
    const banner = this.add
      .text(w / 2, cy + 24 * s, `等级提升！ Lv.${newLevel}`, textStyle(Math.round(46 * s), css(Palette.accent.gold), { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setDepth(1400)
      .setScale(0.2)
      .setAlpha(0);

    this.tweens.add({
      targets: banner,
      scale: 1,
      alpha: 1,
      duration: 460,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: banner,
      y: cy,
      alpha: 0,
      delay: 1500,
      duration: 620,
      onComplete: () => banner.destroy(),
    });

    // 金色扩散光环
    ripple(this, w / 2, cy, Palette.accent.gold, 260, 900);
    this.time.delayedCall(420, () => ripple(this, w / 2, cy, Palette.accent.gold, 320, 900));
  }

  /** 创建一个通用按钮并返回句柄（尺寸/字号随视口缩放系数 s 变化） */
  private createButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void,
    s: number,
  ): MenuButton {
    const w = Math.round(210 * s);
    const h = Math.round(46 * s);
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(2, Palette.text.primary, 0.25);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);

    const text = this.add
      .text(0, 0, label, textStyle(Math.round(19 * s), css(Palette.text.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5);

    container.add([bg, text]);

    const zone = this.add
      .zone(x, y, w + 30, h + 20)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => container.setScale(1.05));
    zone.on('pointerout', () => container.setScale(1));
    zone.on('pointerdown', () => {
      popScale(this, container, 1.14, 180);
      ripple(this, x, y, color, 150, 420);
      this.time.delayedCall(160, onClick);
    });

    return { container };
  }
}
