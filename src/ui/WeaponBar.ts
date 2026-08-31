/**
 * 武器栏（src/ui/WeaponBar.ts）
 * 职责：在屏幕底部展示三把武器的格子，显示名称 / 图标 / 快捷键 / 冷却进度，
 *      当前武器高亮，切换带过渡动效，并且移动端可以直接点击切换。
 *
 * 约束：
 *  - 全部用 Graphics + Text 绘制，武器图标复用 BootScene 生成的程序化贴图（零外部素材）；
 *  - 只做展示与输入转发，不持有游戏状态（冷却比例由场景每帧 push 进来）；
 *  - 提供 contains() 让场景能屏蔽「点在武器栏上却触发攻击」的误操作。
 */

import Phaser from 'phaser';
import type { ResolvedWeapon } from '../config/resolve';
import { WEAPON_TEXTURE_PREFIX } from '../scenes/BootScene';
import { Palette, css, textStyle } from './Palette';
import { clamp01 } from '../utils/MathUtil';

/** 单个格子的绘制元素 */
interface Slot {
  bg: Phaser.GameObjects.Graphics;
  /** 武器图标：BootScene 按 weapon-<id> 命名的程序化贴图 */
  icon: Phaser.GameObjects.Image;
  /** 图标把长边缩到 ICON_BOX 后的基准缩放，切换动效要基于它做相对缩放 */
  iconBaseScale: number;
  name: Phaser.GameObjects.Text;
  hotkey: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WeaponBarOptions {
  width: number;
  height: number;
  weapons: readonly ResolvedWeapon[];
  /** 点击某个格子时回调，参数为武器索引 */
  onSelect: (index: number) => void;
  depth?: number;
}

const SLOT_W = 104;
const SLOT_H = 56;
const SLOT_GAP = 10;
const BOTTOM_MARGIN = 10;
/** 图标外框边长：三把武器贴图长宽比不同，取长边缩到这个尺寸，保持比例不拉伸 */
const ICON_BOX = 32;
/** 点击热区在格子基础上向下外扩的高度（上方是战斗区不能挡） */
const HIT_EXTEND_DOWN = 32;

export class WeaponBar {
  private readonly scene: Phaser.Scene;
  private readonly slots: Slot[] = [];
  private readonly bounds: Phaser.Geom.Rectangle;
  private readonly depth: number;
  private index = 0;

  constructor(scene: Phaser.Scene, opts: WeaponBarOptions) {
    this.scene = scene;
    this.depth = opts.depth ?? 1002;

    const count = Math.max(1, opts.weapons.length);
    const totalW = count * SLOT_W + (count - 1) * SLOT_GAP;
    const startX = Math.round((opts.width - totalW) / 2);
    // 热区要向下外扩 HIT_EXTEND_DOWN，格子必须同步上移同样的距离，
    // 否则外扩部分落在屏幕外（格子底边 630 + 外扩 32 > 屏幕高 640），实际可点区域被吃掉大半
    const startY = opts.height - BOTTOM_MARGIN - SLOT_H - HIT_EXTEND_DOWN;

    for (let i = 0; i < count; i++) {
      const x = startX + i * (SLOT_W + SLOT_GAP);
      const y = startY;

      const bg = scene.add.graphics().setDepth(this.depth);

      const icon = scene.add
        .image(x + SLOT_W / 2, y + 16, `${WEAPON_TEXTURE_PREFIX}${opts.weapons[i].id}`)
        .setDepth(this.depth + 1);
      // 等比缩放塞进 ICON_BOX：按贴图原始长边取较小比例，避免拉伸变形
      const iconBaseScale = Math.min(
        ICON_BOX / Math.max(1, icon.width),
        ICON_BOX / Math.max(1, icon.height),
      );
      icon.setScale(iconBaseScale);

      const name = scene.add
        .text(x + SLOT_W / 2, y + 34, opts.weapons[i].name, textStyle(14, css(Palette.text.secondary)))
        .setOrigin(0.5, 0.5)
        .setDepth(this.depth + 1);

      const hotkey = scene.add
        .text(x + 6, y + 4, `${i + 1}`, textStyle(12, css(Palette.text.hint)))
        .setOrigin(0, 0)
        .setDepth(this.depth + 1);

      // 点击热区：向下外扩 32px 方便手指点，上方不动以免遮挡战斗区
      const zone = scene.add
        .zone(x, y, SLOT_W, SLOT_H + HIT_EXTEND_DOWN)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .setDepth(this.depth + 2);
      zone.on('pointerdown', () => opts.onSelect(i));

      this.slots.push({
        bg,
        icon,
        iconBaseScale,
        name,
        hotkey,
        zone,
        x,
        y,
        w: SLOT_W,
        h: SLOT_H,
      });
    }

    // bounds 必须跟着热区一起外扩，否则点在扩展区会被当成「点在战斗区」而触发攻击
    this.bounds = new Phaser.Geom.Rectangle(startX - 6, startY - 6, totalW + 12, SLOT_H + 12 + HIT_EXTEND_DOWN);
    this.setIndex(0, false);
    // 立刻画一次，避免出现「第一帧格子是空的」的闪烁
    this.update(() => 1);
  }

  /** 当前高亮的武器索引 */
  get currentIndex(): number {
    return this.index;
  }

  /** 武器栏整体占据的矩形（场景用它屏蔽误触） */
  get rect(): Phaser.Geom.Rectangle {
    return this.bounds;
  }

  /** 某个坐标是否落在武器栏上 */
  contains(x: number, y: number): boolean {
    return this.bounds.contains(x, y);
  }

  /**
   * 切换高亮。
   * @param animate 是否播放弹入动效（键盘切换播放，初始化时不播放）
   */
  setIndex(index: number, animate = true): void {
    if (index < 0 || index >= this.slots.length) return;
    this.index = index;

    for (let i = 0; i < this.slots.length; i++) {
      const active = i === index;
      const slot = this.slots[i];
      slot.name.setColor(css(active ? Palette.text.primary : Palette.text.hint));
      slot.hotkey.setColor(css(active ? Palette.accent.gold : Palette.text.hint));
      slot.icon.setAlpha(active ? 1 : 0.55);
    }

    if (animate) {
      const slot = this.slots[index];
      const base = slot.iconBaseScale;
      this.scene.tweens.killTweensOf(slot.icon);
      slot.icon.setScale(base);
      this.scene.tweens.add({
        targets: slot.icon,
        scale: { from: base * 1.45, to: base },
        duration: 220,
        ease: 'Back.easeOut',
      });
    }
  }

  /**
   * 刷新冷却进度条。
   * @param ratioOf 传入索引返回 0~1 的就绪比例（1 = 可以出手）
   */
  update(ratioOf: (index: number) => number): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.drawSlot(i, clamp01(ratioOf(i)));
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.bg.destroy();
      slot.icon.destroy();
      slot.name.destroy();
      slot.hotkey.destroy();
      slot.zone.destroy();
    }
    this.slots.length = 0;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private drawSlot(index: number, ratio: number): void {
    const slot = this.slots[index];
    const active = index === this.index;
    const g = slot.bg;

    g.clear();
    g.fillStyle(Palette.background.deep, active ? 0.9 : 0.72);
    g.fillRoundedRect(slot.x, slot.y, slot.w, slot.h, 10);

    // 冷却条：从格子底部横向填充，满了代表可以出手
    const barH = 5;
    const barY = slot.y + slot.h - barH - 3;
    g.fillStyle(Palette.background.panelSoft, 1);
    g.fillRoundedRect(slot.x + 6, barY, slot.w - 12, barH, 2.5);
    if (ratio > 0) {
      g.fillStyle(ratio >= 1 ? Palette.accent.primary : Palette.accent.secondary, 1);
      g.fillRoundedRect(slot.x + 6, barY, (slot.w - 12) * ratio, barH, 2.5);
    }

    g.lineStyle(active ? 3 : 1.5, active ? Palette.accent.gold : Palette.accent.primaryDark, active ? 1 : 0.5);
    g.strokeRoundedRect(slot.x, slot.y, slot.w, slot.h, 10);
  }
}
