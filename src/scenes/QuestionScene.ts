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
import { ArrowSelector } from '../systems/ArrowSelector';
import { CursorSelector } from '../systems/CursorSelector';
import { QuizEngine } from '../systems/QuizEngine';
import { progression } from '../systems/ProgressionSystem';
import { resolveComboTier } from '../systems/RewardSystem';
import { sfx } from '../systems/SfxController';
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
  /** T-026 本轮答错的题目文案（「题干 → 正确答案」），割草场景用它渲染错题弹幕 */
  wrongAnswers: string[];
}

/** 场景内部状态机 */
type SceneState = 'moving' | 'feedback' | 'wrongPause' | 'summary';

export class QuestionScene extends Phaser.Scene {
  private startData: LevelStartData = { level: 1 };
  private packed!: ResolvedLevelPackage;
  private questionConfig!: QuestionConfig;
  private engine: QuizEngine | null = null;
  private track: AnswerTrack | null = null;
  private selector: ArrowSelector | null = null;
  private cursorSel: CursorSelector | null = null;
  private hud: QuizHud | null = null;

  private questionText!: Phaser.GameObjects.Text;
  private explanationText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Graphics;
  /** 题干面板几何（hud 布局与反馈文字定位都依赖它） */
  private panelTop = 0;
  private panelHeight = 0;
  private summaryContainer: Phaser.GameObjects.Container | null = null;

  private state: SceneState = 'moving';
  private stateTimer = 0;
  private stateDuration = 0;
  private pendingAdvance = false;
  /** T-026 本轮答错的题目文案（答错/超时各记一条，供割草场景错题弹幕使用） */
  private wrongAnswers: string[] = [];

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
    // 供 CDP 无头验证直接访问答题场景状态（T-016）；仅开发模式暴露，生产 tree-shake 剔除
    if (import.meta.env.DEV) {
      (window as unknown as { __QS__?: QuestionScene }).__QS__ = this;
    }
    const loader = ConfigLoader.getInstance();
    this.questionConfig = loader.getConfig('questionConfig');
    const subjectConfig = loader.getConfig('subjectConfig') as SubjectConfig;

    this.packed = resolveLevel(this.startData.level);
    const subject = this.packed.subject;
    const subjectMeta = subjectConfig.subjects[subject];

    this.drawBackdrop(subjectMeta ? subjectMeta.themeColor : '#3d7ea6');
    this.buildQuestionPanel(subjectMeta ? subjectMeta.displayName : subject);

    // T-025：场景切换 fade 过渡（时长来自配置）
    this.cameras.main.fadeIn(
      ConfigLoader.getInstance().getConfig('grassCuttingConfig').polishSettings.sceneFadeInMs,
      0, 0, 0,
    );

    // 抽题：数量与难度权重全部来自配置
    const weights = pickDifficultyWeights(this.startData.level, this.questionConfig.difficultySelection);
    const questions: DrawnQuestion[] = questionBank.draw({
      subject,
      count: this.packed.questionCount,
      difficultyWeights: weights,
    });

    this.engine = new QuizEngine({ questions, timeLimit: this.packed.questionTimeLimit });

    // viewport 缩放：方案 C（Phaser RESIZE）下 960×640 拉伸到 viewport 物理尺寸，
    // UI 字号/位置/大小若不缩放会"挤在左上"。这里按 viewport 与 960×640 的最小比缩放。
    const vp = this.scale.width;
    const vpScale = Math.min(this.scale.width / 960, this.scale.height / 640);

    this.hud = new QuizHud(this, {
      width: this.scale.width,
      total: questions.length,
      timeLimit: this.packed.questionTimeLimit,
      scale: vpScale,
      panelTop: this.panelTop,
      panelHeight: this.panelHeight,
    });

    const a = this.questionConfig.answerSettings;
    // 选项区垂直中心：h/2 + 45·s 较原 20·s 下移，填充 19.5:9 / 小视口下中下部留白，
    // 同时保证与反馈文字区（explanationText 底）保持间隙
    const optionCenterY = this.scale.height / 2 + 45 * vpScale;
    if (a.mode === 'arrow') {
      // 箭头模式：答案固定，高亮框循环跳转（默认，儿童友好）
      // centerX/centerY 用 viewport 物理中心（绝对居中），
      // cardWidth/cardHeight 乘以 vpScale 让卡片尺寸随 viewport 等比缩放
      this.selector = new ArrowSelector(this, {
        centerX: vp / 2,
        centerY: optionCenterY,
        cardWidth: a.optionCardWidth * vpScale,
        cardHeight: a.optionCardHeight * vpScale,
        interval: a.arrowInterval,
        layout: a.arrowLayout,
      });
    } else if (a.mode === 'cursor') {
      // 游标模式：答案固定，高亮游标在选项间持续平滑往返，玩家主动停住
      // 停住时按游标当前 x 落在哪张判定框内 → 选中对应答案
      this.cursorSel = new CursorSelector(this, {
        centerX: vp / 2,
        centerY: optionCenterY,
        cardWidth: a.optionCardWidth * vpScale,
        cardHeight: a.optionCardHeight * vpScale,
        cycleDuration: a.cursorCycleDuration,
        hitZoneWidth: a.cursorHitZoneWidth * vpScale,
        hitZoneHeight: a.cursorHitZoneHeight * vpScale,
      });
    } else {
      // 轨道模式：原「Stop the Cloud」式移动轨道 + 停住判定
      this.track = new AnswerTrack(this, {
        movementType: a.movementType,
        centerX: vp / 2,
        centerY: optionCenterY,
        radiusX: a.trackRadiusX * vpScale,
        radiusY: a.trackRadiusY * vpScale,
        linearSpan: a.linearTrackSpan * vpScale,
        cardWidth: a.optionCardWidth * vpScale,
        cardHeight: a.optionCardHeight * vpScale,
        zoneWidth: a.selectionZoneWidth * vpScale,
        zoneHeight: a.selectionZoneHeight * vpScale,
        speed: this.packed.answerSpeed,
        overlapThreshold: a.overlapThreshold,
        stopSettleDuration: a.stopSettleDuration,
        bounceVelocity: a.bounceVelocity,
        dragDamping: a.dragDamping,
      });
    }

    this.registerInput();
    this.presentQuestion();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    const engine = this.engine;
    if (!engine) return;

    if (this.state === 'moving') {
      if (this.selector) this.selector.update(dt);
      else if (this.cursorSel) this.cursorSel.update(dt);
      else this.track?.update(dt);
      const timeout = engine.update(dt);
      this.hud?.setTimeLeft(engine.remainingTime, engine.limit);
      if (timeout === 'timeout') this.handleTimeout();
    } else if (this.state === 'feedback') {
      this.stateTimer += dt;
      if (this.stateTimer >= this.stateDuration) {
        if (this.pendingAdvance) this.advanceQuestion();
        else {
          // 未命中：回到移动状态继续本题（仅轨道模式会走到这里）
          this.state = 'moving';
          if (this.selector) {
            this.selector.reset();
            this.selector.start();
          } else if (this.cursorSel) {
            this.cursorSel.reset();
            this.cursorSel.start();
          } else {
            this.track?.reset();
            this.track?.start();
          }
        }
      }
    }
  }

  // ───────────────────────── 流程控制 ─────────────────────────

  /** 展示当前题目并启动答题组件（轨道/箭头/游标模式三选一） */
  private presentQuestion(): void {
    const engine = this.engine;
    if (!engine) return;
    if (!this.track && !this.selector && !this.cursorSel) return;

    this.questionText.setText(engine.current.question);
    this.explanationText.setText('');
    this.resultText.setText('');
    this.hintText.setText(this.modeHint()).setVisible(true);
    if (this.selector) {
      this.selector.setOptions(engine.current.options);
      this.selector.start();
    } else if (this.cursorSel) {
      this.cursorSel.setOptions(engine.current.options);
      this.cursorSel.start();
    } else {
      this.track?.setOptions(engine.current.options);
      this.track?.start();
    }
    this.state = 'moving';
    this.pendingAdvance = false;

    this.hud?.setProgress(engine.currentNumber, engine.total);
    this.refreshComboHint();
    this.hud?.setTimeLeft(engine.remainingTime, engine.limit);
  }

  /** 玩家点击 / 空格触发停住/确认判定 */
  private handleStop(pointerX: number, pointerY: number): void {
    const engine = this.engine;
    if (!engine || this.state !== 'moving') return;

    // 点击瞬间的扩散反馈，让「我停下了/确认了」这件事立刻可见
    ripple(this, pointerX, pointerY, Palette.accent.secondary, 110, 420);

    let index: number;
    if (this.selector) {
      // 箭头模式：直接确认当前高亮；没有「未命中」概念
      sfx.play('stop');
      index = this.selector.confirm();
    } else if (this.cursorSel) {
      // 游标模式：停住，按游标 x 落在哪张判定框内 → 选中
      sfx.play('stop');
      const result = this.cursorSel.confirm();
      if (result.index === -1) {
        // 停在间隙处算 miss（与轨道模式一致），保留本题
        this.handleMiss();
        return;
      }
      index = result.index;
    } else if (this.track) {
      // 轨道模式：停住 + 重叠面积判定
      const result = this.track.stop();
      sfx.play('stop');
      if (!result.hit) {
        this.handleMiss();
        return;
      }
      index = result.index;
    } else {
      return;
    }

    // submit() 内部会推进 index（commit → index++），提交后 engine.current 已指向下一题。
    // 因此这里必须先快照当前题引用：对象本身不变，指针移动不影响快照。
    // 这同时修复了历史 bug——此前反馈里的「正确答案/解析」会显示下一题的内容（张冠李戴）。
    const q = engine.current;
    const { outcome, record } = engine.submit(index);
    const correct = outcome === 'correct';
    if (this.selector) this.selector.setState(index, correct ? 'correct' : 'wrong');
    else if (this.cursorSel) this.cursorSel.setState(index, correct ? 'correct' : 'wrong');
    else this.track?.setState(index, correct ? 'correct' : 'wrong');

    const pos = this.selector
      ? this.selector.getCardPosition(index)
      : this.cursorSel
        ? this.cursorSel.getCardPosition(index)
        : this.track!.getCardPosition(index);
    this.hintText.setVisible(false);
    if (correct) {
      sfx.play('correct');
      ripple(this, pos.x, pos.y, Palette.status.correct, 150, 460);
      this.resultText.setText('✓ 答对了！').setColor(css(Palette.status.correct));
      // 解析是教育价值的落点，答对时也展示（用快照，避免指向下一题）
      this.explanationText.setText(
        `正确答案：${q.correctText}　|　${q.explanation}`,
      );
      this.refreshComboHint();
      this.enterFeedback(
        true,
        this.questionConfig.answerSettings.feedbackHoldDuration +
          this.questionConfig.answerSettings.explanationHoldDuration,
      );
      void record;
      return;
    }

    // ── 答错：暂停答题流程，展示解题思路（T-016），等待小朋友看完后手动继续 ──
    // 答错时同时高亮正确答案，形成「我选了什么 / 正确是什么」的对照
    sfx.play('wrong');
    // T-026：记入错题弹幕（快照 q，避免推进后指向下一题）
    this.wrongAnswers.push(`${q.question} → ${q.correctText}`);
    if (this.selector) this.selector.setState(q.answerIndex, 'correct');
    else if (this.cursorSel) this.cursorSel.setState(q.answerIndex, 'correct');
    else this.track?.setState(q.answerIndex, 'correct');
    shake(this, this.resultText, 7, 260);
    ripple(this, pos.x, pos.y, Palette.status.wrong, 130, 420);
    this.resultText.setText('✕ 答错了，看看解题思路吧').setColor(css(Palette.status.wrong));
    this.explanationText.setText(
      `正确答案：${q.correctText}\n解题思路：${q.solution}`,
    );
    this.hintText.setText('点击任意位置 或 按空格 继续答题').setVisible(true);
    this.refreshComboHint();
    this.enterWrongPause();
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
    if (!engine) return;
    if (!this.track && !this.selector && !this.cursorSel) return;

    // 与 handleStop 同理：registerTimeout 内部会推进 index，先快照当前题
    const q = engine.current;
    engine.registerTimeout();
    // T-026：超时也算答错，记入错题弹幕
    this.wrongAnswers.push(`${q.question} → ${q.correctText}`);
    sfx.play('wrong');
    if (this.selector) this.selector.setState(q.answerIndex, 'correct');
    else if (this.cursorSel) this.cursorSel.setState(q.answerIndex, 'correct');
    else this.track!.setState(q.answerIndex, 'correct');
    this.resultText.setText('⏰ 超时了').setColor(css(Palette.status.warning));
    this.explanationText.setText(
      `正确答案：${q.correctText}　|　${q.explanation}`,
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

  /**
   * 答错暂停（T-016）：进入 wrongPause 状态，展示该题解题思路。
   * 倒计时自然冻结——update() 只在 'moving' 状态调用 engine.update，
   * wrongPause 下无任何推进逻辑，等待玩家点击/空格确认后继续下一题。
   */
  private enterWrongPause(): void {
    this.state = 'wrongPause';
    this.stateTimer = 0;
    this.stateDuration = 0;
    this.pendingAdvance = false;
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
        wrongAnswers: this.wrongAnswers.slice(),
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
    const h = this.scale.height;
    // 面板宽度按 viewport 缩放，方案 C 19.5:9 / 1024×540 下自然放大占满中央
    const s = Math.min(w / 960, h / 640);
    const panelW = Math.min(840 * s, w * 0.9);
    const panelH = 80 * s;
    // panelY = 40·s（原 32·s）：顶部让出 HUD 题号/连对行（10·s~30·s），不再压卡片顶边
    const panelY = 40 * s;
    this.panelTop = panelY;
    this.panelHeight = panelH;
    const panelX = w / 2 - panelW / 2;

    // 题干面板
    this.panel = this.add.graphics();
    this.panel.fillStyle(Palette.background.panel, 0.92);
    this.panel.fillRoundedRect(panelX, panelY, panelW, panelH, 14);
    this.panel.lineStyle(2, Palette.accent.primaryDark, 0.8);
    this.panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 14);

    const subjectTag = this.add
      .text(panelX + 16 * s, panelY + 6 * s, subjectName, textStyle(Math.round(15 * s), css(Palette.accent.secondary)))
      .setOrigin(0, 0);
    subjectTag.setDepth(2);

    // 场景单例复用：每次重进答题必须清空上一轮的错题记录
    this.wrongAnswers = [];

    this.questionText = this.add
      .text(w / 2, panelY + panelH / 2, '', textStyle(Math.round(28 * s), css(Palette.text.primary), {
        align: 'center',
        wordWrap: { width: panelW - 30 * s },
      }))
      .setOrigin(0.5, 0.5);

    // 反馈条：位于题干下方 HUD 进度条（panelBottom + 36·s 处）之下，互不重叠
    // 布局序列：卡片底 → +6·s 倒计时(≈26·s 高) → +36·s 进度条(10·s) → +64·s 反馈 → +96·s 解析
    this.resultText = this.add
      .text(w / 2, panelY + panelH + 64 * s, '', textStyle(Math.round(24 * s), css(Palette.text.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0.5);

    this.explanationText = this.add
      .text(w / 2, panelY + panelH + 96 * s, '', textStyle(Math.round(15 * s), css(Palette.text.secondary), {
        align: 'center',
        wordWrap: { width: panelW + 20 * s },
        lineSpacing: 3,
      }))
      .setOrigin(0.5, 0);

    this.hintText = this.add
      .text(
        w / 2,
        h - 24 * s,
        this.modeHint(),
        textStyle(Math.round(16 * s), css(Palette.text.hint)),
      )
      .setOrigin(0.5, 1);
  }

  /** 当前答题模式的底部提示文案（每题开始时复位，答错暂停时临时覆盖） */
  private modeHint(): string {
    const mode = this.questionConfig.answerSettings.mode;
    return mode === 'arrow'
      ? '点击屏幕任意位置 或 按空格 —— 让高亮箭头停在正确选项上'
      : mode === 'cursor'
        ? '点击屏幕任意位置 或 按空格 —— 让游标停在正确选项的判定框里'
        : '点击屏幕任意位置 或 按空格 —— 让正确选项停在金色判定框里';
  }

  /** 注册点击与键盘输入 */
  private registerInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.state === 'moving') this.handleStop(pointer.worldX, pointer.worldY);
      // 答错暂停：看完解题思路后，点击任意位置继续下一题
      else if (this.state === 'wrongPause') this.advanceQuestion();
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.state === 'moving') {
        // 键盘操作没有指针位置，用判定区中心作为反馈原点
        this.handleStop(this.scale.width / 2, this.scale.height / 2);
      } else if (this.state === 'wrongPause') {
        this.advanceQuestion();
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
    this.selector?.destroy();
    this.cursorSel?.destroy();
    this.hud?.destroy();
    this.track = null;
    this.selector = null;
    this.cursorSel = null;
    this.hud = null;
    this.engine = null;
  }
}
