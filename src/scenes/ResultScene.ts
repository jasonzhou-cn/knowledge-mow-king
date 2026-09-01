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
    this.drawBackdrop(w, h);

    const title = payload.cleared ? '关卡通过！' : '再来一次！';
    const titleColor = payload.cleared ? Palette.accent.primary : Palette.status.warning;
    this.add
      .text(w / 2, 46, title, textStyle(42, css(titleColor), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0);

    this.add
      .text(
        w / 2,
        100,
        `第 ${payload.level} 关 · ${payload.died ? '生命耗尽' : '时间结束'}`,
        textStyle(19, css(Palette.text.secondary)),
      )
      .setOrigin(0.5, 0);

    // 左栏：答题表现
    this.addColumn(w / 2 - 232, 146, '答题表现', [
      `答对 ${payload.quiz.correctCount} / ${payload.quiz.totalQuestions} 题`,
      `正确率 ${Math.round(payload.quiz.accuracy * 100)}%`,
      `平均每题 ${formatOneDecimal(payload.quiz.averageAnswerTime)} 秒`,
      `最大连对 ${payload.quiz.maxCombo}`,
      this.answerStatsLine(payload.quiz, useMissWording),
    ]);

    // 中栏：割草战果
    this.addColumn(w / 2, 146, '割草战果', [
      `击杀 ${payload.kills}`,
      `最高连击 ${payload.maxCombo}`,
      `本关得分 ${score}`,
      `伤害加成 ×${payload.bonus.damageMultiplier.toFixed(2)}`,
      `范围加成 ×${payload.bonus.rangeMultiplier.toFixed(2)}`,
    ]);

    // 右栏：成长
    const need = progression.expToNextLevel;
    this.addColumn(w / 2 + 232, 146, '成长', [
      `等级 ${progression.level}`,
      `经验 ${Math.round(progression.exp)} / ${Number.isFinite(need) ? Math.round(need) : '已满级'}`,
      `本关获得经验 +${expGain}`,
      `累计得分 ${Math.round(progression.totalScore)}`,
    ]);

    // 奖励明细：来源逐条列出 + 上限状态
    this.drawRewardPanel(w, 336, rewardConfig, calc, granted, dailyLimit);

    // 等级提升动画
    if (levelUp) this.playLevelUpAnimation(w, levelUp.to);

    // 按钮
    this.createButton(w / 2 - 210, h - 74, payload.cleared ? '进入下一关' : '重玩本关', Palette.accent.primary, () => {
      const nextLevel = payload.cleared ? resolveNextLevel(levelConfig, payload.level) : payload.level;
      const data: LevelStartData = { level: nextLevel, bonusTime: granted };
      this.scene.start('QuestionScene', data);
    });

    this.createButton(w / 2 + 210, h - 74, '返回主菜单', Palette.background.panelSoft, () => {
      this.scene.start('MenuScene');
    });
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

  /** 绘制背景 */
  private drawBackdrop(w: number, h: number): void {
    const g = this.add.graphics();
    g.fillStyle(Palette.background.deep, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(Palette.background.panel, 0.5);
    g.fillRoundedRect(w / 2 - 452, 130, 904, 200, 16);
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

  /** 绘制一个三栏数据卡片 */
  private addColumn(x: number, y: number, title: string, lines: string[]): void {
    this.add
      .text(x, y, title, textStyle(20, css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0);
    this.add
      .text(x, y + 30, lines.join('\n'), textStyle(17, css(Palette.text.primary), {
        align: 'center',
        lineSpacing: 7,
      }))
      .setOrigin(0.5, 0);
  }

  /** 绘制奖励面板：明细 + 上限状态，满足奖励规则透明化要求 */
  private drawRewardPanel(
    w: number,
    y: number,
    config: RewardConfig,
    calc: ReturnType<typeof applyDailyCap>,
    granted: number,
    dailyLimit: number,
  ): void {
    const panel = this.add.graphics();
    panel.fillStyle(Palette.background.panel, 0.9);
    panel.fillRoundedRect(w / 2 - 452, y, 904, 152, 16);
    panel.lineStyle(2, Palette.accent.gold, 0.6);
    panel.strokeRoundedRect(w / 2 - 452, y, 904, 152, 16);

    this.add
      .text(w / 2 - 424, y + 14, '游戏时间奖励明细', textStyle(19, css(Palette.accent.gold), { fontStyle: 'bold' }))
      .setOrigin(0, 0);

    this.add
      .text(w / 2 - 424, y + 46, formatRewardItems(calc.items), textStyle(16, css(Palette.text.primary), { lineSpacing: 5 }))
      .setOrigin(0, 0);

    const capLines = [
      `本次应发 ${calc.singleCappedTotal}s　单次上限 ${config.rewardLimits.singleRewardTimeMax}s${calc.singleCapped ? '（已触发）' : ''}`,
      `今日已领 ${calc.dailyUsedAfter}s / ${dailyLimit}s${calc.dailyCapped ? '（已达每日上限）' : ''}`,
      `实际发放 +${granted}s（下一关割草时长增加）`,
    ];
    this.add
      .text(w / 2 + 424, y + 46, capLines.join('\n'), textStyle(16, css(Palette.text.secondary), {
        align: 'right',
        lineSpacing: 6,
      }))
      .setOrigin(1, 0);
  }

  /** 等级提升动画：横幅弹入 + 金色光环扩散 */
  private playLevelUpAnimation(w: number, newLevel: number): void {
    const banner = this.add
      .text(w / 2, 250, `等级提升！ Lv.${newLevel}`, textStyle(46, css(Palette.accent.gold), { fontStyle: 'bold' }))
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
      y: 226,
      alpha: 0,
      delay: 1500,
      duration: 620,
      onComplete: () => banner.destroy(),
    });

    // 金色扩散光环
    ripple(this, w / 2, 250, Palette.accent.gold, 260, 900);
    this.time.delayedCall(420, () => ripple(this, w / 2, 250, Palette.accent.gold, 320, 900));
  }

  /** 创建一个通用按钮并返回句柄 */
  private createButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void,
  ): MenuButton {
    const w = 260;
    const h = 58;
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    bg.lineStyle(2, Palette.text.primary, 0.25);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);

    const text = this.add
      .text(0, 0, label, textStyle(22, css(Palette.text.primary), { fontStyle: 'bold' }))
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
