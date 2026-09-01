/**
 * 游标停住式选择器（src/systems/CursorSelector.ts）
 * 职责：实现「游标平滑移动 + 用户主动停住」的答题交互——
 *      一个高亮游标沿 4 个答案之间持续平滑往返移动，用户点击/空格停住，
 *      停住时判定游标中心**当前处于哪个答案的判定框**内：
 *        - 在答案 N 判定框内 → 选中答案 N
 *        - 都不在（间隙处）→ 算 miss
 *
 * 与 ArrowSelector 的区别：
 *  - ArrowSelector：4 答案固定，高亮框循环跳到下一选项，用户在目标高亮时点击 = 选中
 *  - CursorSelector：4 答案固定，游标持续平滑滑动，用户主动停住时按位置选
 *    （经典 Stop the Cloud 玩法，9-18 岁儿童更熟悉；保留认知负荷但更"游戏化"）
 *
 * 公平保证：4 张卡片由同一工厂创建，尺寸/颜色/描边完全一致，文本随机由 QuestionBank 负责。
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from '../ui/Palette';
import type { CardState } from './AnswerTrack';

/** 游标选择器的几何 / 节奏参数，来自 questionConfig.answerSettings */
export interface CursorSelectorOptions {
  centerX: number;
  centerY: number;
  cardWidth: number;
  cardHeight: number;
  /** 游标在 4 个答案间往返一轮的时长（秒） */
  cycleDuration: number;
  /** 判定区：每张答案卡片正中央的小框大小（px），用户需让游标落进此区域才算选中 */
  hitZoneWidth: number;
  hitZoneHeight: number;
}

interface Card {
  container: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  marker: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
}

export class CursorSelector {
  private readonly scene: Phaser.Scene;
  private readonly opts: CursorSelectorOptions;
  private readonly cards: Card[] = [];
  private readonly hitZoneGfx: Phaser.GameObjects.Graphics;
  /**
   * 独立游标框（金色描边 + 半透明填充 + ▼）：持续在卡片间平滑往返移动
   * 这是用户唯一需要追踪的移动元素
   */
  private readonly cursor: Phaser.GameObjects.Container;

  private running = false;
  private count = 0;
  /** 游标当前 x/y（物理 px）；通过 update() 按 tween 推进 */
  private cursorX = 0;
  private cursorY = 0;
  /** 用户停住时返回的索引（外部使用 ratio 即可，stoppedIndex 暂作为状态保留） */
  // private stoppedIndex = -1;
  /** 游标在跑动中还是已停 */
  private stopped = false;

  constructor(scene: Phaser.Scene, opts: CursorSelectorOptions) {
    this.scene = scene;
    this.opts = opts;

    // 判定区装饰（每张卡中央画一个半透明金色框，让玩家知道"停这里算正确"）
    this.hitZoneGfx = scene.add.graphics().setDepth(20);

    // 游标主体（金色描边圆角框 + 顶部下指箭头）
    const { cardWidth, cardHeight } = opts;
    const pad = 14;
    const frame = scene.add.graphics();
    frame.fillStyle(Palette.accent.gold, 0.1);
    frame.fillRoundedRect(-cardWidth / 2 - pad, -cardHeight / 2 - pad, cardWidth + pad * 2, cardHeight + pad * 2, 12);
    frame.lineStyle(3, Palette.accent.gold, 1);
    frame.strokeRoundedRect(-cardWidth / 2 - pad, -cardHeight / 2 - pad, cardWidth + pad * 2, cardHeight + pad * 2, 12);

    const arrow = scene.add.graphics();
    const arrowTipY = -cardHeight / 2 - 8;
    arrow.fillStyle(Palette.accent.gold, 1);
    arrow.fillTriangle(-11, arrowTipY - 14, 11, arrowTipY - 14, 0, arrowTipY);

    this.cursor = scene.add.container(0, 0).setDepth(30);
    this.cursor.add([frame, arrow]);
    this.cursor.setVisible(false);
  }

  /** 是否处于循环状态 */
  get isMoving(): boolean {
    return this.running && !this.stopped;
  }

  /** 当前游标 x（用于调试 / 进度条 UI） */
  get x(): number {
    return this.cursorX;
  }

  /** 当前游标 y */
  get y(): number {
    return this.cursorY;
  }

  /**
   * 创建并放置 4 张选项卡片（固定位置）+ 绘制判定框
   * 公平保证：循环内只传文本，样式全部来自同一份配置
   */
  setOptions(labels: string[]): void {
    this.clearCards();
    this.count = labels.length;

    const positions = this.computePositions(this.count);
    for (let i = 0; i < this.count; i++) {
      const container = this.scene.add.container(0, 0).setDepth(20);

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
      container.setPosition(positions[i].x, positions[i].y);
      this.cards.push({
        container,
        fill,
        border,
        label,
        marker,
        x: positions[i].x,
        y: positions[i].y,
      });
    }

    this.drawHitZones();
    // 游标初始位置：从最左卡片左边缘外开始
    this.cursorX = positions[0].x - this.opts.cardWidth / 2 - 14;
    this.cursorY = positions[0].y;
    this.cursor.setPosition(this.cursorX, this.cursorY);
    this.cursor.setVisible(true);
  }

  /** 开始循环（游标从初始位置出发） */
  start(): void {
    this.running = true;
    this.stopped = false;
    if (this.cards.length > 0) {
      this.cursorX = this.cards[0].x - this.opts.cardWidth / 2 - 14;
      this.cursorY = this.cards[0].y;
      this.cursor.setPosition(this.cursorX, this.cursorY);
    }
  }

  /**
   * 推进游标位置（线性往返）
   * 用 sin 函数在 0..1..0 周期内往返：t = (sin(time * 2π / cycleDuration) + 1) / 2
   * 越接近卡片中心速度越慢 → 玩家有"在中央停住"的机会
   */
  update(dt: number): void {
    if (!this.running || this.stopped || this.count <= 1) return;
    this.elapsed = (this.elapsed ?? 0) + dt;
    const t = (this.elapsed / this.opts.cycleDuration) * Math.PI * 2;
    const phase = (Math.sin(t) + 1) / 2; // 0..1..0
    const positions = this.computePositions(this.count);
    const firstX = positions[0].x;
    const lastX = positions[positions.length - 1].x;
    this.cursorX = firstX + (lastX - firstX) * phase;
    this.cursorY = positions[0].y;
    this.cursor.setPosition(this.cursorX, this.cursorY);
  }

  private elapsed = 0;

  /**
   * 用户停住：返回游标当前所在答案索引（-1 = 间隙，miss）
   * 判定逻辑：游标 x 落在哪张卡片的判定框水平范围内 → 选中该卡片
   * 每张判定框宽度 hitZoneWidth（可配置），中心与卡片中心对齐
   */
  confirm(): { index: number; ratio: number } {
    if (!this.running) return { index: -1, ratio: 0 };
    this.running = false;
    this.stopped = true;

    // 判定：游标 x 是否在某张卡片判定框水平范围内
    const halfW = this.opts.hitZoneWidth / 2;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const dx = Math.abs(this.cursorX - card.x);
      if (dx <= halfW) {
        // 在判定框内
        const ratio = 1 - dx / halfW; // 越接近卡片中心比例越高
        if (ratio < bestDist) {
          bestDist = 1 - ratio;
          bestIndex = i;
        }
      } else if (bestIndex === -1 && dx < bestDist) {
        // 记录最近的（用于 miss 时的反馈）
        bestDist = dx;
      }
    }

    // bestIndex: -1 表示停在间隙（miss），0..n-1 表示选中对应答案
    const finalRatio = bestIndex === -1 ? 0 : 1 - (Math.abs(this.cursorX - this.cards[bestIndex].x) / halfW);
    return { index: bestIndex, ratio: Math.max(0, finalRatio) };
  }

  /** 高亮某张卡片 */
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

  /** 重置全部卡片到初始状态（下一题） */
  reset(): void {
    for (let i = 0; i < this.cards.length; i++) this.setState(i, 'normal');
    this.stopped = false;
    this.elapsed = 0;
    if (this.cards.length > 0) {
      this.cursorX = this.cards[0].x - this.opts.cardWidth / 2 - 14;
      this.cursorY = this.cards[0].y;
      this.cursor.setPosition(this.cursorX, this.cursorY);
    }
  }

  /** 取某张卡片的世界坐标 */
  getCardPosition(index: number): { x: number; y: number } {
    const card = this.cards[index];
    if (!card) return { x: this.opts.centerX, y: this.opts.centerY };
    return { x: card.x, y: card.y };
  }

  /** 销毁全部显示对象 */
  destroy(): void {
    this.cursor.destroy();
    this.hitZoneGfx.destroy();
    this.clearCards();
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private computePositions(count: number): { x: number; y: number }[] {
    const { centerX, centerY, cardWidth } = this.opts;
    const gap = 18;

    const total = count * cardWidth + (count - 1) * gap;
    const startX = centerX - total / 2 + cardWidth / 2;
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      positions.push({ x: startX + i * (cardWidth + gap), y: centerY });
    }
    return positions;
  }

  /** 在每张卡片中央绘制半透明金色判定框（让玩家知道目标区） */
  private drawHitZones(): void {
    const g = this.hitZoneGfx;
    g.clear();
    const hw = this.opts.hitZoneWidth;
    const hh = this.opts.hitZoneHeight;
    for (const card of this.cards) {
      g.fillStyle(Palette.accent.gold, 0.08);
      g.fillRoundedRect(card.x - hw / 2, card.y - hh / 2, hw, hh, 8);
      g.lineStyle(2, Palette.accent.gold, 0.5);
      g.strokeRoundedRect(card.x - hw / 2, card.y - hh / 2, hw, hh, 8);
    }
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
      g.lineBetween(cx - 10, cy, cx - 2, cy + 8);
      g.lineBetween(cx - 2, cy + 8, cx + 11, cy - 10);
    } else {
      g.lineBetween(cx - 9, cy - 9, cx + 9, cy + 9);
      g.lineBetween(cx + 9, cy - 9, cx - 9, cy + 9);
    }
  }

  private clearCards(): void {
    for (const card of this.cards) card.container.destroy();
    this.cards.length = 0;
  }
}