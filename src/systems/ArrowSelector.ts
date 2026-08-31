/**
 * 箭头循环选择器（src/systems/ArrowSelector.ts）
 * 职责：实现「固定答案 + 移动箭头」的答题交互——
 *      4 个选项固定显示不动，一个高亮框按固定间隔循环跳转（row：从左到右循环；
 *      grid：Z 形循环），玩家在目标选项高亮时点击 / 空格确认。
 *
 * 设计动机（GDD 2.2）：答案始终静止，眼睛只需追踪一个移动高亮，而不用同时
 *      盯 4 个移动的答案卡片，显著降低儿童认知负荷。
 *
 * 公平保证（GDD 1.3）：4 张卡片由同一工厂创建，尺寸、颜色、描边完全一致，
 *      唯一差异是文本内容；题目顺序随机由 QuestionBank 负责，与 AnswerTrack 一致。
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from '../ui/Palette';
import type { CardState } from './AnswerTrack';

/** 箭头选择器的几何 / 节奏参数，来自 questionConfig.answerSettings */
export interface ArrowSelectorOptions {
  centerX: number;
  centerY: number;
  cardWidth: number;
  cardHeight: number;
  /** 高亮框跳到下一个选项的间隔（秒） */
  interval: number;
  /** 布局：row=一行 4 个（箭头左右扫掠）；grid=2×2 网格（Z 形扫掠） */
  layout: 'row' | 'grid';
}

interface Card {
  container: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  marker: Phaser.GameObjects.Graphics;
}

export class ArrowSelector {
  private readonly scene: Phaser.Scene;
  private readonly opts: ArrowSelectorOptions;
  private readonly cards: Card[] = [];
  /** 当前高亮选项上方的下指箭头（独立图层，避免与卡片状态色冲突） */
  private readonly highlightArrow: Phaser.GameObjects.Graphics;

  private running = false;
  private timer = 0;
  private highlight = 0;
  private count = 0;

  constructor(scene: Phaser.Scene, opts: ArrowSelectorOptions) {
    this.scene = scene;
    this.opts = opts;
    this.highlightArrow = scene.add.graphics().setDepth(26);
  }

  /** 是否处于循环状态 */
  get isMoving(): boolean {
    return this.running;
  }

  /** 当前高亮索引（confirm 时返回它） */
  get currentIndex(): number {
    return this.highlight;
  }

  /**
   * 创建并放置 4 张选项卡片（固定位置，不再移动）。
   * 公平保证：循环内只传文本，样式全部来自同一份配置，无按索引分支。
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
      this.cards.push({ container, fill, border, label, marker });
    }

    this.highlight = 0;
    this.applyHighlight();
  }

  /** 开始循环（高亮从 0 开始） */
  start(): void {
    this.running = true;
    this.timer = 0;
    this.highlight = 0;
    this.applyHighlight();
  }

  /** 推进高亮循环；只在 running 状态下推进 */
  update(dt: number): void {
    if (!this.running || this.count <= 1) return;
    this.timer += dt;
    if (this.timer >= this.opts.interval) {
      this.timer -= this.opts.interval;
      this.highlight = (this.highlight + 1) % this.count;
      this.applyHighlight();
    }
  }

  /**
   * 确认选择：返回当前高亮索引并停止循环。
   * 箭头模式下没有「未命中」——只要确认就选中当前高亮的选项，
   * 判定对错交给场景（engine.submit）。
   */
  confirm(): number {
    this.running = false;
    return this.highlight;
  }

  /** 高亮某张卡片（答对 / 答错 / 复位），形状 + 颜色双重编码 */
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
    this.highlight = 0;
    this.applyHighlight();
  }

  /** 取某张卡片的世界坐标，用于在其上方播放反馈 */
  getCardPosition(index: number): { x: number; y: number } {
    const card = this.cards[index];
    if (!card) return { x: this.opts.centerX, y: this.opts.centerY };
    return { x: card.container.x, y: card.container.y };
  }

  /** 销毁全部显示对象 */
  destroy(): void {
    this.clearCards();
    this.highlightArrow.destroy();
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 按布局计算第 i 张卡片的固定位置 */
  private computePositions(count: number): { x: number; y: number }[] {
    const { centerX, centerY, cardWidth, cardHeight, layout } = this.opts;
    const gap = 28;

    if (layout === 'grid') {
      // 2×2 网格，Z 形顺序：0 左上 → 1 右上 → 2 左下 → 3 右下
      const colW = cardWidth + gap;
      const rowH = cardHeight + gap;
      const x0 = centerX - colW / 2;
      const x1 = centerX + colW / 2;
      const y0 = centerY - rowH / 2;
      const y1 = centerY + rowH / 2;
      return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x0, y: y1 },
        { x: x1, y: y1 },
      ];
    }

    // row：一行水平排列，循环 0 → 1 → 2 → 3 → 0
    const total = count * cardWidth + (count - 1) * gap;
    const startX = centerX - total / 2 + cardWidth / 2;
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      positions.push({ x: startX + i * (cardWidth + gap), y: centerY });
    }
    return positions;
  }

  /** 刷新高亮：放大当前卡片 + 金色描边 + 顶部下指箭头 */
  private applyHighlight(): void {
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const isCurrent = i === this.highlight;
      card.container.setScale(isCurrent ? 1.06 : 1);
      card.border.setTint(isCurrent ? Palette.accent.gold : Palette.quiz.cardBorder);
    }
    const cur = this.cards[this.highlight];
    if (cur) this.drawArrowAt(cur.container.x);
  }

  /** 在当前高亮卡片顶部绘制金色下指箭头（▼），强化「箭头指向答案」的语义 */
  private drawArrowAt(x: number): void {
    const g = this.highlightArrow;
    g.clear();
    const top = this.opts.centerY - (this.layoutHeight() / 2) - 20;
    const s = 12;
    g.fillStyle(Palette.accent.gold, 1);
    g.fillTriangle(x - s, top, x + s, top, x, top + s);
  }

  /** 布局总高度（用于定位箭头） */
  private layoutHeight(): number {
    if (this.opts.layout === 'grid') {
      return this.opts.cardHeight * 2 + 28;
    }
    return this.opts.cardHeight;
  }

  /** 在卡片右上角绘制 ✓ / ✕ 形状标记（与 AnswerTrack 一致） */
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

  /** 清理卡片对象 */
  private clearCards(): void {
    for (const card of this.cards) card.container.destroy();
    this.cards.length = 0;
  }
}
