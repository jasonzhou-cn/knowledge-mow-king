/**
 * 箭头循环选择器（src/systems/ArrowSelector.ts）
 * 职责：实现「固定答案 + 平滑移动游标」的答题交互——
 *      4 个选项固定显示不动，一个独立「游标框」（金色描边 + 半透明填充 +
 *      顶部 ▼ 箭头）在选项间**平滑滑动**（tween，而非瞬间跳格），玩家在游标
 *      指向目标选项时点击 / 空格确认。
 *
 * 设计动机（GDD 2.2）：答案始终静止，眼睛只需追踪一个平滑移动的游标，而不用
 *      同时盯 4 个移动的答案卡片，显著降低儿童认知负荷；平滑滑动比瞬间跳格
 *      更易追踪、更符合「箭头扫过答案」的直觉。
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
  /** 游标移动到下一个选项的间隔（秒），移动动画占其一部分，其余时间停驻 */
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
  /**
   * 独立游标框：金色描边 + 半透明金色填充 + 顶部 ▼ 箭头。
   * 是「当前选中项」的唯一视觉指示，通过 tween 在卡片间平滑滑动。
   */
  private readonly cursor: Phaser.GameObjects.Container;
  private cursorTween: Phaser.Tweens.Tween | null = null;

  private running = false;
  private timer = 0;
  private highlight = 0;
  private count = 0;

  constructor(scene: Phaser.Scene, opts: ArrowSelectorOptions) {
    this.scene = scene;
    this.opts = opts;

    const { cardWidth, cardHeight } = opts;
    const pad = 14;
    const frame = scene.add.graphics();
    frame.fillStyle(Palette.accent.gold, 0.08);
    frame.fillRoundedRect(-cardWidth / 2 - pad, -cardHeight / 2 - pad, cardWidth + pad * 2, cardHeight + pad * 2, 12);
    frame.lineStyle(3, Palette.accent.gold, 1);
    frame.strokeRoundedRect(-cardWidth / 2 - pad, -cardHeight / 2 - pad, cardWidth + pad * 2, cardHeight + pad * 2, 12);

    // 顶部下指箭头 ▼：从卡片上缘向上伸出
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
    this.moveCursorTo(0, false);
  }

  /** 开始循环（游标从 0 开始） */
  start(): void {
    this.running = true;
    this.timer = 0;
    this.highlight = 0;
    this.moveCursorTo(0, false);
  }

  /** 推进游标循环；只在 running 状态下推进 */
  update(dt: number): void {
    if (!this.running || this.count <= 1) return;
    this.timer += dt;
    if (this.timer >= this.opts.interval) {
      this.timer -= this.opts.interval;
      this.highlight = (this.highlight + 1) % this.count;
      this.moveCursorTo(this.highlight, true);
    }
  }

  /**
   * 确认选择：返回游标当前指向的选项索引并停止循环。
   * 若游标正处于滑动中途，先定格到目标位置，保证「所见即所选」。
   * 箭头模式下没有「未命中」——只要确认就选中游标指向的选项。
   */
  confirm(): number {
    this.running = false;
    if (this.cursorTween) {
      this.cursorTween.stop();
      this.cursorTween = null;
      const card = this.cards[this.highlight];
      if (card) this.cursor.setPosition(card.container.x, card.container.y);
    }
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

  /** 重置全部卡片到初始状态（下一题），游标回到第 0 个选项 */
  reset(): void {
    for (let i = 0; i < this.cards.length; i++) this.setState(i, 'normal');
    this.highlight = 0;
    this.moveCursorTo(0, false);
  }

  /** 取某张卡片的世界坐标，用于在其上方播放反馈 */
  getCardPosition(index: number): { x: number; y: number } {
    const card = this.cards[index];
    if (!card) return { x: this.opts.centerX, y: this.opts.centerY };
    return { x: card.container.x, y: card.container.y };
  }

  /** 销毁全部显示对象 */
  destroy(): void {
    this.cursorTween?.stop();
    this.cursorTween = null;
    this.cursor.destroy();
    this.clearCards();
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

  /**
   * 把游标平滑移动到第 index 张卡片。
   * @param animate 是否使用 tween 动画；新题目 / 复位时传 false 直接放置
   */
  private moveCursorTo(index: number, animate: boolean): void {
    const card = this.cards[index];
    if (!card) return;

    this.cursorTween?.stop();
    this.cursorTween = null;
    this.cursor.setVisible(true);

    if (animate) {
      // 滑动时长取间隔的一部分（最多 450ms），其余时间游标停驻让玩家看清选项
      const duration = Math.min(450, this.opts.interval * 380);
      this.cursorTween = this.scene.tweens.add({
        targets: this.cursor,
        x: card.container.x,
        y: card.container.y,
        duration,
        ease: 'Quad.easeInOut',
        onComplete: () => {
          this.cursorTween = null;
        },
      });
    } else {
      this.cursor.setPosition(card.container.x, card.container.y);
    }
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
