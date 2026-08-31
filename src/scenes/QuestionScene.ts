/**
 * 答题场景（src/scenes/QuestionScene.ts）
 * 职责：实现「Stop the Cloud」式答题交互的完整流程——
 *      题干展示 → 4 个选项沿轨道移动 → 玩家点击/空格停住 → 重叠面积判定 →
 *      判对错 + 解析展示 → 进入下一题 → 全部答完后展示属性加成结算 → 移交割草场景。
 *
 * 设计要点：
 *  - 所有几何 / 速度 / 阈值参数来自 questionConfig，本场景不写死任何数值；
 *  - 未命中（没停准）不消耗题目数，玩家可继续尝试本题直到超时；
 *  - 每道题作答后展示解析，教育价值优先于节奏（9-18 岁知识巩固场景）。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { computeGrassCuttingBonus, resolveLevel } from '../config/resolve';
import type { QuizResult, ResolvedLevelPackage } from '../config/resolve';
import type { GrassCuttingBonus, QuestionConfig, SubjectConfig } from '../config/types';
import { pickDifficultyWeights, questionBank, type DrawnQuestion } from '../data/QuestionBank';
import { AnswerTrack } from '../systems/AnswerTrack';
import { QuizEngine } from '../systems/QuizEngine';
import { progression } from '../systems/ProgressionSystem';
import { resolveComboTier } from '../systems/RewardSystem';
import { Palette, css, textStyle } from '../ui/Palette';
import { ripple, shake } from '../ui/Feedback';
import { QuizHud } from '../ui/Hud';
import type { LevelStartData } from './MenuScene';

/** 交给割草场景的数据 */
export interface GrassCuttingData {
  level: number;
  bonus: GrassCuttingBonus;
  quiz: QuizResult;
  /** 上一关结算发放的奖励时间（秒） */
  bonusTime: number;
}

/** 场景内部状态机 */
type SceneState = 'moving' | 'feedback' | 'summary';

export class QuestionScene extends Phaser.Scene {
  private startData: LevelStartData = { level: 1 };
  private packed!: ResolvedLevelPackage;
  private questionConfig!: QuestionConfig;
  private engine: QuizEngine | null = null;
  private track: AnswerTrack | null = null;
  private hud: QuizHud | null = null;

  private questionText!: Phaser.GameObjects.Text;
  private explanationText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Graphics;
  private summaryContainer: Phaser.GameObjects.Container | null = null;

  private state: SceneState = 'moving';
  private stateTimer = 0;
  private stateDuration = 0;
  private pendingAdvance = false;

  constructor() {
    super({ key: 'QuestionScene' });
  }

  init(data: object): void {
    const incoming = data as Partial<LevelStartData>;
    this.startData = {
      level: Math.max(1, Math.floor(incoming.level ?? progression.unlockedLevel)),
      bonusTime: incoming.bonusTime ?? 0,
    };
  }

  create(): void {
    const loader = ConfigLoader.getInstance();
    this.questionConfig = loader.getConfig('questionConfig');
    const subjectConfig = loader.getConfig('subjectConfig') as SubjectConfig;

    this.packed = resolveLevel(this.startData.level);
    const subject = this.packed.subject;
    const subjectMeta = subjectConfig.subjects[subject];

    this.drawBackdrop(subjectMeta ? subjectMeta.themeColor : '#3d7ea6');
    this.buildQuestionPanel(subjectMeta ? subjectMeta.displayName : subject);

    // 抽题：数量与难度权重全部来自配置
    const weights = pickDifficultyWeights(this.startData.level, this.questionConfig.difficultySelection);
    const questions: DrawnQuestion[] = questionBank.draw({
      subject,
      count: this.packed.questionCount,
      difficultyWeights: weights,
    });

    this.engine = new QuizEngine({ questions, timeLimit: this.packed.questionTimeLimit });
    this.hud = new QuizHud(this, {
      width: this.scale.width,
      total: questions.length,
      timeLimit: this.packed.questionTimeLimit,
    });

    const a = this.questionConfig.answerSettings;
    this.track = new AnswerTrack(this, {
      movementType: a.movementType,
      centerX: a.trackCenterX,
      centerY: a.trackCenterY,
      radiusX: a.trackRadiusX,
      radiusY: a.trackRadiusY,
      linearSpan: a.linearTrackSpan,
      cardWidth: a.optionCardWidth,
      cardHeight: a.optionCardHeight,
      zoneWidth: a.selectionZoneWidth,
      zoneHeight: a.selectionZoneHeight,
      speed: this.packed.answerSpeed,
      overlapThreshold: a.overlapThreshold,
      stopSettleDuration: a.stopSettleDuration,
      bounceVelocity: a.bounceVelocity,
      dragDamping: a.dragDamping,
    });

    this.registerInput();
    this.presentQuestion();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    const engine = this.engine;
    const track = this.track;
    if (!engine || !track) return;

    if (this.state === 'moving') {
      track.update(dt);
      const timeout = engine.update(dt);
      this.hud?.setTimeLeft(engine.remainingTime, engine.limit);
      if (timeout === 'timeout') this.handleTimeout();
    } else if (this.state === 'feedback') {
      this.stateTimer += dt;
      if (this.stateTimer >= this.stateDuration) {
        if (this.pendingAdvance) this.advanceQuestion();
        else {
          // 未命中：回到移动状态继续本题
          this.state = 'moving';
          track.reset();
          track.start();
        }
      }
    }
  }

  // ───────────────────────── 流程控制 ─────────────────────────

  /** 展示当前题目并启动轨道 */
  private presentQuestion(): void {
    const engine = this.engine;
    const track = this.track;
    if (!engine || !track) return;

    this.questionText.setText(engine.current.question);
    this.explanationText.setText('');
    this.resultText.setText('');
    this.hintText.setVisible(true);
    track.setOptions(engine.current.options);
    track.start();
    this.state = 'moving';
    this.pendingAdvance = false;

    this.hud?.setProgress(engine.currentNumber, engine.total);
    this.refreshComboHint();
    this.hud?.setTimeLeft(engine.remainingTime, engine.limit);
  }

  /** 玩家点击 / 空格触发停住判定 */
  private handleStop(pointerX: number, pointerY: number): void {
    const engine = this.engine;
    const track = this.track;
    if (!engine || !track || this.state !== 'moving') return;

    // 点击瞬间的扩散反馈，让「我停下了」这件事立刻可见
    ripple(this, pointerX, pointerY, Palette.accent.secondary, 110, 420);

    const result = track.stop();
    if (!result.hit) {
      this.handleMiss();
      return;
    }

    const { outcome, record } = engine.submit(result.index);
    const correct = outcome === 'correct';
    track.setState(result.index, correct ? 'correct' : 'wrong');

    const pos = track.getCardPosition(result.index);
    this.hintText.setVisible(false);
    if (correct) {
      ripple(this, pos.x, pos.y, Palette.status.correct, 150, 460);
      this.resultText.setText('✓ 答对了！').setColor(css(Palette.status.correct));
    } else {
      // 答错时同时高亮正确答案，形成「我选了什么 / 正确是什么」的对照
      track.setState(engine.current.answerIndex, 'correct');
      shake(this, this.resultText, 7, 260);
      ripple(this, pos.x, pos.y, Palette.status.wrong, 130, 420);
      this.resultText.setText('✕ 答错了').setColor(css(Palette.status.wrong));
    }

    // 解析是教育价值的落点，无论对错都要展示
    this.explanationText.setText(
      `正确答案：${engine.current.correctText}　|　${engine.current.explanation}`,
    );
    this.refreshComboHint();

    this.enterFeedback(
      true,
      this.questionConfig.answerSettings.feedbackHoldDuration +
        this.questionConfig.answerSettings.explanationHoldDuration,
    );
    void record;
  }

  /** 未命中：不消耗题目数，回到移动状态继续本题 */
  private handleMiss(): void {
    const engine = this.engine;
    if (!engine) return;
    engine.registerMiss();
    this.resultText.setText('没停准，再试一次！').setColor(css(Palette.status.miss));
    this.explanationText.setText('让选项更多地落进金色判定框里再点击（本题不消耗题数）');
    this.hintText.setVisible(false);
    this.refreshComboHint();
    this.enterFeedback(false, this.questionConfig.answerSettings.feedbackHoldDuration);
  }

  /** 超时：算答错并进入下一题 */
  private handleTimeout(): void {
    const engine = this.engine;
    const track = this.track;
    if (!engine || !track) return;

    engine.registerTimeout();
    track.setState(engine.current.answerIndex, 'correct');
    this.resultText.setText('⏰ 超时了').setColor(css(Palette.status.warning));
    this.explanationText.setText(
      `正确答案：${engine.current.correctText}　|　${engine.current.explanation}`,
    );
    this.hintText.setVisible(false);
    this.refreshComboHint();
    this.enterFeedback(
      true,
      this.questionConfig.answerSettings.feedbackHoldDuration +
        this.questionConfig.answerSettings.explanationHoldDuration,
    );
  }

  /** 进入反馈停留状态 */
  private enterFeedback(advance: boolean, duration: number): void {
    this.state = 'feedback';
    this.stateTimer = 0;
    this.stateDuration = duration;
    this.pendingAdvance = advance;
    this.hud?.setTimeLeft(0, Math.max(0.1, this.engine ? this.engine.limit : 10));
  }

  /** 推进到下一题；全部答完则进入加成结算 */
  private advanceQuestion(): void {
    const engine = this.engine;
    if (!engine) return;
    if (engine.isFinished) {
      this.showSummary();
      return;
    }
    this.presentQuestion();
  }

  /** 更新连对提示，并展示下一次奖励门槛（GDD 2.4 透明化） */
  private refreshComboHint(): void {
    const engine = this.engine;
    if (!engine || !this.hud) return;
    const rewardConfig = ConfigLoader.getInstance().getConfig('rewardConfig');
    const { next } = resolveComboTier(engine.bestCombo, rewardConfig.comboRewards);
    this.hud.setCombo(engine.currentCombo, next);
  }

  // ───────────────────────── 加成结算 ─────────────────────────

  /** 展示「答题质量 → 割草属性加成」的结算面板 */
  private showSummary(): void {
    const engine = this.engine;
    if (!engine) return;
    this.state = 'summary';

    const quiz = engine.getResult();
    const loader = ConfigLoader.getInstance();
    const gameSettings = loader.getConfig('gameSettings');
    const grassConfig = loader.getConfig('grassCuttingConfig');
    const coefficient =
      grassConfig.subjectCoefficientSettings[this.packed.subject]?.skillDamageCoefficient ?? 1;

    const bonus = computeGrassCuttingBonus(
      quiz,
      this.startData.level,
      coefficient,
      gameSettings.grassCuttingBonusSettings,
      this.packed.questionTimeLimit,
    );

    const w = this.scale.width;
    const h = this.scale.height;

    const container = this.add.container(0, 0).setDepth(1500);
    this.summaryContainer = container;
    // 面板弹入动画
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 260, ease: 'Cubic.easeOut' });

    const dim = this.add.graphics();
    dim.fillStyle(Palette.background.deep, 0.86);
    dim.fillRect(0, 0, w, h);
    container.add(dim);

    const panel = this.add.graphics();
    panel.fillStyle(Palette.background.panel, 1);
    panel.fillRoundedRect(w / 2 - 300, h / 2 - 190, 600, 380, 18);
    panel.lineStyle(3, Palette.accent.primary, 0.9);
    panel.strokeRoundedRect(w / 2 - 300, h / 2 - 190, 600, 380, 18);
    container.add(panel);

    const title = this.add
      .text(w / 2, h / 2 - 156, '属性加成结算', textStyle(32, css(Palette.accent.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0);
    container.add(title);

    const accuracyPercent = Math.round(quiz.accuracy * 100);
    const statLine =
      `答对 ${quiz.correctCount} / ${quiz.totalQuestions} 题    正确率 ${accuracyPercent}%\n` +
      `平均每题 ${quiz.averageAnswerTime.toFixed(1)}s    最大连对 ${quiz.maxCombo}    没停准 ${quiz.missCount} 次`;
    const statText = this.add
      .text(w / 2, h / 2 - 104, statLine, textStyle(19, css(Palette.text.primary), { align: 'center', lineSpacing: 8 }))
      .setOrigin(0.5, 0);
    container.add(statText);

    const bonusLine =
      `伤害  ×${bonus.damageMultiplier.toFixed(2)}\n` +
      `范围  ×${bonus.rangeMultiplier.toFixed(2)}\n` +
      `持续  ×${bonus.durationMultiplier.toFixed(2)}`;
    const bonusText = this.add
      .text(w / 2, h / 2 - 30, bonusLine, textStyle(28, css(Palette.accent.gold), { align: 'center', lineSpacing: 10, fontStyle: 'bold' }))
      .setOrigin(0.5, 0);
    container.add(bonusText);

    const b = bonus.breakdown;
    const detailLine =
      `等级加成 ${b.baseBonus.toFixed(2)} × 学科 ${b.subjectCoefficient.toFixed(2)} × ` +
      `正确率项 ${b.accuracyTerm.toFixed(2)} × 速度项 ${b.speedFactor.toFixed(2)} × 连对项 ${b.comboFactor.toFixed(2)}\n` +
      (b.floorApplied ? '（已触发保底，保证你依然能割得动）' : '') +
      (b.ceilingApplied ? '（已达加成上限）' : '');
    const detailText = this.add
      .text(w / 2, h / 2 + 92, detailLine, textStyle(15, css(Palette.text.hint), { align: 'center', lineSpacing: 6 }))
      .setOrigin(0.5, 0);
    container.add(detailText);

    const continueText = this.add
      .text(w / 2, h / 2 + 148, '即将进入割草…（点击立即开始）', textStyle(20, css(Palette.accent.secondary)))
      .setOrigin(0.5, 0);
    container.add(continueText);

    this.tweens.add({
      targets: continueText,
      alpha: { from: 1, to: 0.35 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const go = (): void => {
      const data: GrassCuttingData = {
        level: this.startData.level,
        bonus,
        quiz,
        bonusTime: this.startData.bonusTime ?? 0,
      };
      this.scene.start('GrassCuttingScene', data);
    };

    // 点击立即开始，否则 2.6 秒后自动进入
    this.time.delayedCall(2600, go);
    this.input.once('pointerdown', go);
    this.input.keyboard?.once('keydown-SPACE', go);
  }

  // ───────────────────────── 场景搭建 ─────────────────────────

  /** 绘制背景：以学科主题色做渐变底，强化学科辨识度 */
  private drawBackdrop(themeColorHex: string): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics();
    g.fillStyle(Palette.background.deep, 1);
    g.fillRect(0, 0, w, h);

    const theme = Phaser.Display.Color.HexStringToColor(themeColorHex).color;
    g.fillStyle(theme, 0.16);
    g.fillRect(0, 0, w, h);

    // 顶部渐隐条带，让题干区域更聚焦
    for (let i = 0; i < 8; i++) {
      g.fillStyle(Palette.background.deep, 0.12);
      g.fillRect(0, i * 6, w, 6);
    }
  }

  /** 构建题干面板与各类提示文本 */
  private buildQuestionPanel(subjectName: string): void {
    const w = this.scale.width;

    // 题干面板：y 96~176
    this.panel = this.add.graphics();
    this.panel.fillStyle(Palette.background.panel, 0.92);
    this.panel.fillRoundedRect(w / 2 - 420, 96, 840, 80, 14);
    this.panel.lineStyle(2, Palette.accent.primaryDark, 0.8);
    this.panel.strokeRoundedRect(w / 2 - 420, 96, 840, 80, 14);

    const subjectTag = this.add
      .text(w / 2 - 404, 102, subjectName, textStyle(15, css(Palette.accent.secondary)))
      .setOrigin(0, 0);
    subjectTag.setDepth(2);

    this.questionText = this.add
      .text(w / 2, 146, '', textStyle(28, css(Palette.text.primary), {
        align: 'center',
        wordWrap: { width: 790 },
      }))
      .setOrigin(0.5, 0.5);

    // 反馈条：y 184~258，位于题干与轨道之间，不与选项卡片重叠
    this.resultText = this.add
      .text(w / 2, 194, '', textStyle(24, css(Palette.text.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0.5);

    this.explanationText = this.add
      .text(w / 2, 222, '', textStyle(15, css(Palette.text.secondary), {
        align: 'center',
        wordWrap: { width: 860 },
        lineSpacing: 3,
      }))
      .setOrigin(0.5, 0);

    this.hintText = this.add
      .text(
        w / 2,
        628,
        '点击屏幕任意位置 或 按空格 —— 让正确选项停在金色判定框里',
        textStyle(16, css(Palette.text.hint)),
      )
      .setOrigin(0.5, 1);
  }

  /** 注册点击与键盘输入 */
  private registerInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.state === 'moving') this.handleStop(pointer.worldX, pointer.worldY);
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.state === 'moving') {
        // 键盘操作没有指针位置，用判定区中心作为反馈原点
        this.handleStop(this.scale.width / 2, this.scale.height / 2);
      }
    });
  }

  /** 场景销毁时清理定时与监听 */
  shutdown(): void {
    this.input.keyboard?.removeAllListeners();
    this.input.removeAllListeners();
    this.summaryContainer?.destroy();
    this.summaryContainer = null;
    this.track?.destroy();
    this.hud?.destroy();
    this.track = null;
    this.hud = null;
    this.engine = null;
  }
}
