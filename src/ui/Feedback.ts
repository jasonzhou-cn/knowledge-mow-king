/**
 * 轻量反馈动效集（src/ui/Feedback.ts）
 * 职责：集中提供「点击扩散、弹性缓冲、飘字、闪烁、抖动」等即时反馈动效。
 * 设计要点：
 *  - 全部基于 Phaser Tween，不引入任何图片 / 音频资源；
 *  - 所有飘字走对象池 + 数量上限，避免割草高频击杀时对象爆炸（GDD 1.2 粒子上限限制原则）；
 *  - 答对 / 答错的反馈必须同时具备「形状 + 颜色」差异，不能只靠颜色（无障碍与 9 岁可读性要求）。
 */

import Phaser from 'phaser';
import { CssColor, FONT_FAMILY } from './Palette';
import type { FloatingTextSettings } from '../config/types';
import { easeOutBack } from '../utils/MathUtil';

/** 飘字字号分档兜底值（正式来源：polishSettings.floatingText，红线 1 收口） */
const FALLBACK_FONTS: FloatingTextSettings = { fontNormal: 20, fontBig: 27, fontHuge: 34 };

/** 点击瞬间的扩散圆环反馈 */
export function ripple(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  maxRadius = 90,
  duration = 380,
): void {
  const ring = scene.add.circle(x, y, 6, color, 0.55);
  ring.setStrokeStyle(3, color, 0.9);
  ring.setDepth(2000);
  scene.tweens.add({
    targets: ring,
    scale: maxRadius / 6,
    alpha: 0,
    duration,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}

/**
 * 可被 Phaser Tween 缩放的最小结构约束。
 * 直接引用 Phaser 的 Components.Scale 在部分版本的类型定义里不可导出，
 * 这里用结构化类型，既能接收任意 GameObject，又不依赖具体的命名空间路径。
 */
export interface Scalable {
  scale: number;
  scaleX: number;
  scaleY: number;
}

/** 选项卡片停止时的弹性缓冲动画（仅缩放，不改变最终位置，保证判定公平） */
export function bounceSettle(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform & Scalable,
  bounceVelocity: number,
  dragDamping: number,
  duration: number,
): void {
  const overshoot = 1 + Math.max(0, bounceVelocity) * 0.12;
  // dragDamping 越大收敛越快：把 0~1 的阻尼映射为合理的缓动时长
  const settleMs = Math.max(80, Math.round(duration * 1000 * (0.6 + dragDamping * 0.8)));
  scene.tweens.add({
    targets: target,
    scaleX: { from: overshoot, to: 1 },
    scaleY: { from: 1 / overshoot, to: 1 },
    duration: settleMs,
    ease: (t: number) => easeOutBack(t),
  });
}

/** 通用缩放脉冲，用于按钮与卡片被点中 */
export function popScale(scene: Phaser.Scene, target: Scalable, to = 1.12, duration = 160): void {
  scene.tweens.add({
    targets: target,
    scale: { from: to, to: 1 },
    duration,
    ease: 'Back.easeOut',
  });
}

/** 闪烁：在两种透明度之间来回，用于倒计时告警、无敌帧提示 */
export function flash(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Alpha,
  times = 3,
  duration = 120,
): void {
  scene.tweens.add({
    targets: target,
    alpha: { from: 1, to: 0.25 },
    duration,
    yoyo: true,
    repeat: Math.max(0, times - 1),
  });
}

/** 左右抖动，用于答错时的负反馈 */
export function shake(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  distance = 8,
  duration = 260,
): void {
  const originX = target.x;
  scene.tweens.add({
    targets: target,
    x: originX + distance,
    duration: Math.round(duration / 4),
    yoyo: true,
    repeat: 3,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      target.x = originX;
    },
  });
}

/** 飘字对象池：限制同屏数量，超出时复用最老的一个 */
export class FloatingTextPool {
  private readonly items: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly limit = 12) {}

  /**
   * 在世界坐标处冒出一段飘字。
   * @param shape 形状前缀（如 "✓" / "✕"），保证不只靠颜色传达结果
   * @param fontSize 字号，用于高连击时把飘字升档（暴击感）
   */
  spawn(x: number, y: number, content: string, color: string, shape = '', fontSize = 20): void {
    let item: Phaser.GameObjects.Text;
    if (this.items.length < this.limit) {
      item = this.scene.add.text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color,
        stroke: '#08131e',
        strokeThickness: 4,
      });
      item.setOrigin(0.5, 0.5).setDepth(3000);
      this.items.push(item);
    } else {
      item = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.items.length;
      // 复用时强制中断上一次动画，避免残留 tween 把新飘字拽走
      this.scene.tweens.killTweensOf(item);
    }

    item.setText(shape ? `${shape} ${content}` : content);
    item.setColor(color);
    item.setFontSize(fontSize);
    item.setPosition(x, y);
    item.setAlpha(1);
    item.setScale(0.7);
    item.setActive(true).setVisible(true);

    this.scene.tweens.add({
      targets: item,
      y: y - 46,
      alpha: 0,
      scale: 1.05,
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        item.setActive(false).setVisible(false);
      },
    });
  }

  /**
   * 伤害数字：连击越高字号越大、颜色越亮，制造「越割越暴击」的正反馈。
   * @param tier 0=普通，1=大连击，2=超大连击
   */
  damage(x: number, y: number, amount: number, tier = 0): void {
    const jitterX = x + Phaser.Math.Between(-10, 10);
    const jitterY = y + Phaser.Math.Between(-4, 4);
    this.spawn(jitterX, jitterY, `${Math.round(amount)}`, damageColor(tier), '', damageFontSize(tier));
  }

  /** 击杀提示（金色星形，随连击升档） */
  kill(x: number, y: number, score: number, tier = 0): void {
    this.spawn(x, y, `+${Math.round(score)}`, CssColor.gold, '★', killFontSize(tier));
  }

  /** 连击提示（青色） */
  combo(x: number, y: number, combo: number): void {
    this.spawn(x, y, `${combo} 连击!`, CssColor.secondaryAccent, '⚡', 20 + Math.min(10, combo / 5));
  }

  /** 场景销毁时清理 */
  destroy(): void {
    for (const item of this.items) item.destroy();
    this.items.length = 0;
  }
}

/** 伤害数字的颜色分档：白 → 青绿 → 金，越高连击越「暴击」 */
function damageColor(tier: number): string {
  if (tier >= 2) return CssColor.gold;
  if (tier >= 1) return CssColor.accent;
  return CssColor.primary;
}

/** 伤害/击杀飘字的字号分档（配置驱动，未绑定时用兜底值） */
let floatingFonts: FloatingTextSettings = { ...FALLBACK_FONTS };

/** 绑定飘字字号配置（GrassCuttingScene 构建对象池时传入 polishSettings.floatingText） */
export function bindFloatingTextFonts(settings: FloatingTextSettings): void {
  floatingFonts = { ...FALLBACK_FONTS, ...settings };
}

function damageFontSize(tier: number): number {
  if (tier >= 2) return floatingFonts.fontHuge;
  if (tier >= 1) return floatingFonts.fontBig;
  return floatingFonts.fontNormal;
}

/** 击杀飘字的字号分档（比伤害数字略大一号的普通档） */
function killFontSize(tier: number): number {
  if (tier >= 2) return floatingFonts.fontHuge;
  if (tier >= 1) return floatingFonts.fontBig;
  return floatingFonts.fontNormal + 2;
}

/** 屏幕震动（短促，用于受伤 / 关卡失败） */
export function cameraShake(scene: Phaser.Scene, intensity = 0.008, duration = 180): void {
  scene.cameras.main.shake(duration, intensity);
}
