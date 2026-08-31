/**
 * 移动选项轨道（src/systems/AnswerTrack.ts）
 * 职责：实现「Stop the Cloud」式答题交互的核心逻辑——
 *      4 个选项沿轨道匀速移动 → 玩家点击/空格 → 全部停止 → 计算每张卡片与判定区的重叠面积比例 →
 *      取最大者，达到 overlapThreshold 判定为选中，否则判定为未命中（miss）。
 *
 * 铁律（GDD 1.3 答题公平原则）：4 张卡片由同一个工厂方法创建，
 *      尺寸、颜色、描边、速度、移动方式完全一致，唯一差异只有「文本内容」；
 *      位置随机打乱由 QuestionBank 负责。代码中不得出现任何按索引区分样式的分支。
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from '../ui/Palette';
import { bounceSettle } from '../ui/Feedback';
import { clamp01 } from '../utils/MathUtil';
import type { MovementType } from '../config/types';

/** 轨道与判定区的全部几何 / 运动参数，均来自 questionConfig.answerSettings */
export interface AnswerTrackOptions {
  movementType: MovementType;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  linearSpan: number;
  cardWidth: number;
  cardHeight: number;
  zoneWidth: number;
  zoneHeight: number;
  /** 移动速度（像素/秒），由 resolve.ts 按等级计算后传入 */
  speed: number;
  /** 判定为「命中」的最小重叠面积比例 */
  overlapThreshold: number;
  /** 停止后的弹性缓冲时长（秒） */
  stopSettleDuration: number;
  bounceVelocity: number;
  dragDamping: number;
}

/** 停止判定结果 */
export interface OverlapResult {
  /** 命中的选项索引；-1 表示未命中 */
  index: number;
  /** 最佳选项的重叠比例 0~1 */
  ratio: number;
  /** 全部 4 个选项的重叠比例，便于调试与教学提示 */
  ratios: number[];
  /** 是否达到阈值 */
  hit: boolean;
}

/** 卡片高亮状态 */
export type CardState = 'normal' | 'selected' | 'correct' | 'wrong';

interface Card {
  container: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  /** 结果形状标记（✓ / ✕），保证反馈不只依赖颜色 */
  marker: Phaser.GameObjects.Graphics;
  /** 轨道相位 0~1 */
  phase: number;
}

export class AnswerTrack {
  private readonly scene: Phaser.Scene;
  private readonly opts: AnswerTrackOptions;
  private readonly cards: Card[] = [];
  private readonly zoneGraphics: Phaser.GameObjects.Graphics;
  private readonly trackGuide: Phaser.GameObjects.Graphics;

  /** 是否处于移动状态 */
  private moving = false;
  /** 轨道基准相位（4 张卡片在此基础上各偏移 1/4 圈） */
  private basePhase = 0;

  constructor(scene: Phaser.Scene, opts: AnswerTrackOptions) {
    this.scene = scene;
    this.opts = opts;

    // 轨道参考线：只做视觉引导，不参与任何判定
    this.trackGuide = scene.add.graphics().setDepth(10);
    this.drawTrackGuide();

    // 判定区（光门）：明确的描边矩形 + 四角标记
    this.zoneGraphics = scene.add.graphics().setDepth(12);
    this.drawZone();
  }

  /** 判定区的世界坐标 X（线性轨道与环形轨道都以轨道中心为判定中心） */
  get zoneX(): number {
    return this.opts.centerX;
  }

  /** 判定区的世界坐标 Y：环形轨道贴在椭圆最低点，线性轨道贴在轨道线上 */
  get zoneY(): number {
    return this.opts.movementType === 'circular'
      ? this.opts.centerY + this.opts.radiusY
      : this.opts.centerY;
  }

  /** 是否已停止（未移动） */
  get isMoving(): boolean {
    return this.moving;
  }

  /**
   * 创建 4 张选项卡片。
   * 公平保证：循环内只传文本内容，所有样式参数取自同一份配置，无任何按索引分支。
   */
  setOptions(labels: string[]): void {
    this.clearCards();
    const count = labels.length;
    for (let i = 0; i < count; i++) {
      const container = this.scene.add.container(0, 0).setDepth(20);

      // 卡片底色与描边分层，便于用 tint 表达不同状态
      const fill = this.scene.add.image(0, 0, 'card-fill');
      fill.setDisplaySize(this.opts.cardWidth, this.opts.cardHeight);
      fill.setTint(Palette.quiz.cardFill);

      const border = this.scene.add.image(0, 0, 'card-border');
      border.setDisplaySize(this.opts.cardWidth, this.opts.cardHeight);
      border.setTint(Palette.quiz.cardBorder);

      const label = this.scene.add.text(
        0,
        0,
        labels[i],
        textStyle(24, css(Palette.quiz.cardText), {
          align: 'center',
          wordWrap: { width: this.opts.cardWidth - 24 },
        }),
      );
      label.setOrigin(0.5, 0.5);

      const marker = this.scene.add.graphics();

      container.add([fill, border, label, marker]);
      this.cards.push({
        container,
        fill,
        border,
        label,
        marker,
        // 4 张卡片在轨道上均匀分布，起始相位随机避免每次都从同一位置开始
        phase: i / Math.max(1, count),
      });
    }
    // 起始相位随机化，防止玩家靠节奏记忆而非阅读来作答
    this.basePhase = Math.random();
    this.applyPositions();
  }

  /** 开始移动 */
  start(): void {
    this.moving = true;
  }

  /** 更新轨道运动；仅在移动状态下推进相位 */
  update(dt: number): void {
    if (!this.moving) return;

    const { speed, movementType, radiusX, radiusY, linearSpan } = this.opts;
    if (movementType === 'circular') {
      // 用局部弧长微分推进角度，保证线速度基本恒定（椭圆上不会出现忽快忽慢）
      const theta = this.basePhase * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const localSpeed = Math.sqrt(radiusX * radiusX * sinT * sinT + radiusY * radiusY * cosT * cosT);
      const dTheta = (speed * dt) / Math.max(1, localSpeed);
      this.basePhase = (this.basePhase + dTheta / (Math.PI * 2)) % 1;
    } else {
      this.basePhase = (this.basePhase + (speed * dt) / Math.max(1, linearSpan)) % 1;
    }
    this.applyPositions();
  }

  /**
   * 停止移动并计算重叠判定。
   * 判定使用「停止瞬间的冻结位置」，之后的弹性动画只改变缩放，不改变位置，
   * 确保玩家看到的判定结果与视觉完全一致。
   */
  stop(): OverlapResult {
    this.moving = false;

    const ratios = this.cards.map((_, i) => this.overlapRatioOf(i));
    let bestIndex = -1;
    let bestRatio = -1;
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] > bestRatio) {
        bestRatio = ratios[i];
        bestIndex = i;
      }
    }
    const hit = bestRatio >= this.opts.overlapThreshold;

    // 弹性缓冲：所有卡片同时回弹，视觉上表达「停住了」
    for (const card of this.cards) {
      bounceSettle(
        this.scene,
        card.container,
        this.opts.bounceVelocity,
        this.opts.dragDamping,
        this.opts.stopSettleDuration,
      );
    }

    return { index: hit ? bestIndex : -1, ratio: Math.max(0, bestRatio), ratios, hit };
  }

  /** 高亮某张卡片（选中 / 答对 / 答错），用形状 + 颜色双重编码 */
  setState(index: number, state: CardState): void {
    const card = this.cards[index];
    if (!card) return;

    card.marker.clear();
    switch (state) {
      case 'selected':
        card.fill.setTint(Palette.quiz.cardFillDim);
        card.border.setTint(Palette.accent.secondary);
        break;
      case 'correct':
        card.fill.setTint(Palette.status.correct);
        card.border.setTint(Palette.status.correctDark);
        this.drawMarker(card, true);
        break;
      case 'wrong':
        card.fill.setTint(Palette.status.wrong);
        card.border.setTint(Palette.status.wrongDark);
        this.drawMarker(card, false);
        break;
      case 'normal':
      default:
        card.fill.setTint(Palette.quiz.cardFill);
        card.border.setTint(Palette.quiz.cardBorder);
        break;
    }
  }

  /** 重置全部卡片到初始状态，用于进入下一题 */
  reset(): void {
    for (let i = 0; i < this.cards.length; i++) this.setState(i, 'normal');
  }

  /** 取某张卡片的世界坐标，用于在其上方播放飘字 / 粒子反馈 */
  getCardPosition(index: number): { x: number; y: number } {
    const card = this.cards[index];
    if (!card) return { x: this.zoneX, y: this.zoneY };
    return { x: card.container.x, y: card.container.y };
  }

  /** 动态更新速度（配置热更新后需要重新计算） */
  setSpeed(speed: number): void {
    this.opts.speed = speed;
  }

  /** 销毁全部显示对象 */
  destroy(): void {
    this.clearCards();
    this.zoneGraphics.destroy();
    this.trackGuide.destroy();
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 计算第 index 张卡片当前位置并应用到显示对象 */
  private applyPositions(): void {
    for (const card of this.cards) {
      const p = this.phaseToPosition(card.phase);
      card.container.setPosition(p.x, p.y);
    }
  }

  /** 把卡片自身的相位（含基准相位偏移）换算为世界坐标 */
  private phaseToPosition(cardPhase: number): { x: number; y: number } {
    const { movementType, centerX, centerY, radiusX, radiusY, linearSpan } = this.opts;
    const phase = (this.basePhase + cardPhase) % 1;

    if (movementType === 'circular') {
      const theta = phase * Math.PI * 2;
      return {
        x: centerX + radiusX * Math.cos(theta),
        y: centerY + radiusY * Math.sin(theta),
      };
    }
    // 线性轨道：在水平区间内循环平移
    return {
      x: centerX - linearSpan / 2 + phase * linearSpan,
      y: centerY,
    };
  }

  /** 计算第 index 张卡片与判定区的重叠面积占卡片面积的比例 */
  private overlapRatioOf(index: number): number {
    const card = this.cards[index];
    if (!card) return 0;

    const cardX = card.container.x;
    const cardY = card.container.y;
    const { cardWidth, cardHeight, zoneWidth, zoneHeight } = this.opts;

    // 轴对齐矩形交集：无需物理引擎，纯算术，符合 GDD 1.2 碰撞精简原则
    const overlapW = Math.max(
      0,
      Math.min(cardX + cardWidth / 2, this.zoneX + zoneWidth / 2) -
        Math.max(cardX - cardWidth / 2, this.zoneX - zoneWidth / 2),
    );
    const overlapH = Math.max(
      0,
      Math.min(cardY + cardHeight / 2, this.zoneY + zoneHeight / 2) -
        Math.max(cardY - cardHeight / 2, this.zoneY - zoneHeight / 2),
    );

    const cardArea = Math.max(1, cardWidth * cardHeight);
    return clamp01((overlapW * overlapH) / cardArea);
  }

  /** 绘制轨道参考线（虚线圆 / 直线），纯装饰，不参与判定 */
  private drawTrackGuide(): void {
    const g = this.trackGuide;
    g.clear();
    g.lineStyle(2, Palette.quiz.trackGuide, 0.5);

    if (this.opts.movementType === 'circular') {
      g.strokeEllipse(this.opts.centerX, this.opts.centerY, this.opts.radiusX * 2, this.opts.radiusY * 2);
    } else {
      g.lineBetween(
        this.opts.centerX - this.opts.linearSpan / 2,
        this.opts.centerY,
        this.opts.centerX + this.opts.linearSpan / 2,
        this.opts.centerY,
      );
    }
  }

  /** 绘制判定区：半透明填充 + 描边 + 四角括号，位置明确可见 */
  private drawZone(): void {
    const g = this.zoneGraphics;
    g.clear();
    const { zoneWidth, zoneHeight } = this.opts;
    const x = this.zoneX - zoneWidth / 2;
    const y = this.zoneY - zoneHeight / 2;

    g.fillStyle(Palette.quiz.zone, 0.1);
    g.fillRoundedRect(x, y, zoneWidth, zoneHeight, 10);
    g.lineStyle(3, Palette.quiz.zone, 0.9);
    g.strokeRoundedRect(x, y, zoneWidth, zoneHeight, 10);

    // 四角括号强化「光门」的视觉语义
    const c = 18;
    g.lineStyle(4, Palette.quiz.zoneGlow, 1);
    g.lineBetween(x, y, x + c, y);
    g.lineBetween(x, y, x, y + c);
    g.lineBetween(x + zoneWidth, y, x + zoneWidth - c, y);
    g.lineBetween(x + zoneWidth, y, x + zoneWidth, y + c);
    g.lineBetween(x, y + zoneHeight, x + c, y + zoneHeight);
    g.lineBetween(x, y + zoneHeight, x, y + zoneHeight - c);
    g.lineBetween(x + zoneWidth, y + zoneHeight, x + zoneWidth - c, y + zoneHeight);
    g.lineBetween(x + zoneWidth, y + zoneHeight, x + zoneWidth, y + zoneHeight - c);
  }

  /** 在卡片右上角绘制 ✓ / ✕ 形状标记 */
  private drawMarker(card: Card, correct: boolean): void {
    const g = card.marker;
    const w = this.opts.cardWidth;
    const h = this.opts.cardHeight;
    const cx = w / 2 - 26;
    const cy = -h / 2 + 26;

    g.lineStyle(5, correct ? Palette.status.correctDark : Palette.status.wrongDark, 1);
    if (correct) {
      // 对勾
      g.lineBetween(cx - 10, cy, cx - 2, cy + 8);
      g.lineBetween(cx - 2, cy + 8, cx + 11, cy - 10);
    } else {
      // 叉
      g.lineBetween(cx - 9, cy - 9, cx + 9, cy + 9);
      g.lineBetween(cx + 9, cy - 9, cx - 9, cy + 9);
    }
  }

  /** 清理卡片对象 */
  private clearCards(): void {
    for (const card of this.cards) card.container.destroy();
    this.cards.length = 0;
  }
}
