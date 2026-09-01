/**
 * 移动端虚拟摇杆（src/ui/TouchJoystick.ts）
 * 职责：在触屏设备上用一个程序化绘制的摇杆替代键盘做「手动走位」，
 *      把手指相对圆心的位移换算成归一化方向向量供场景消费。
 *
 * 约束：
 *  - 零外部素材：底座与摇杆头全部由 Graphics 画圆生成，与 BootScene.generateTextures 的惯例一致；
 *  - 零数值硬编码：几何与透明度全部来自 TouchSettings（public/config/grassCuttingConfig.json）；
 *  - 只做输入采集，不持有任何游戏状态，也不主动驱动角色移动；
 *  - 多指安全：由场景按 pointer.id 分派，本组件只认 activate 时登记的那根手指。
 */

import Phaser from 'phaser';
import type { TouchSettings } from '../config/types';
import { Palette } from './Palette';

export interface TouchJoystickOptions {
  settings: TouchSettings;
  depth?: number;
}

/** 摇杆输出的移动方向向量（已归一化，未激活或处于死区内时为 0 向量） */
export interface JoystickVector {
  x: number;
  y: number;
}

export class TouchJoystick {
  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Graphics;
  private readonly knob: Phaser.GameObjects.Graphics;

  private readonly centerX: number;
  private readonly centerY: number;
  private readonly baseRadius: number;
  private readonly knobRadius: number;
  private readonly deadZone: number;
  private readonly idleAlpha: number;
  private readonly activeAlpha: number;
  /** 摇杆头中心允许偏离圆心的最大距离：保证摇杆头不会溢出底座 */
  private readonly maxOffset: number;

  private active = false;
  /** 当前登记的手指；null 表示没有手指占用摇杆 */
  private heldPointerId: number | null = null;
  private vecX = 0;
  private vecY = 0;

  constructor(scene: Phaser.Scene, opts: TouchJoystickOptions) {
    this.scene = scene;
    const s = opts.settings;
    const depth = opts.depth ?? 900;

    // viewport 缩放：摇杆位置和半径都按 viewport 实际尺寸计算
    // 避免在 1024×540 窄屏上摇杆贴边、在 2340×1080 全面屏上摇杆太小
    const vpScale = Math.min(scene.scale.width / 960, scene.scale.height / 640);
    this.centerX = s.joystickCenterX * vpScale;
    this.centerY = s.joystickCenterY * vpScale;
    this.baseRadius = s.joystickBaseRadius * vpScale;
    this.knobRadius = s.joystickKnobRadius * vpScale;
    this.deadZone = s.joystickDeadZone * vpScale;
    this.idleAlpha = s.joystickIdleAlpha;
    this.activeAlpha = s.joystickActiveAlpha;
    this.maxOffset = Math.max(1, this.baseRadius - this.knobRadius);

    this.base = scene.add.graphics().setDepth(depth);
    this.knob = scene.add.graphics().setDepth(depth + 1);

    this.drawBase();
    this.drawKnob();

    this.base.setAlpha(this.idleAlpha);
    this.knob.setAlpha(this.idleAlpha);
    this.knob.setPosition(this.centerX, this.centerY);
  }

  /** 是否正在被手指拖动 */
  get isActive(): boolean {
    return this.active;
  }

  /** 占用摇杆的手指 id；null 表示空闲 */
  get pointerId(): number | null {
    return this.heldPointerId;
  }

  /** 底座右边缘 x：底部文案需要据此避让，避免被摇杆压住 */
  get rightEdge(): number {
    return this.centerX + this.baseRadius;
  }

  /** 当前移动方向（归一化；死区内或未激活时为 0 向量） */
  get vector(): JoystickVector {
    return { x: this.vecX, y: this.vecY };
  }

  /**
   * 某个坐标是否落在摇杆判定区内。
   * 判定区即底座圆本身，不做外扩：摇杆只在触屏显示，外扩会吃掉战斗区的点击。
   */
  contains(x: number, y: number): boolean {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    return dx * dx + dy * dy <= this.baseRadius * this.baseRadius;
  }

  /** 手指按下并落在摇杆内：登记手指、提亮、立刻算一次方向 */
  activate(pointer: Phaser.Input.Pointer): void {
    this.active = true;
    this.heldPointerId = pointer.id;
    this.base.setAlpha(this.activeAlpha);
    this.knob.setAlpha(this.activeAlpha);
    this.track(pointer.x, pointer.y);
  }

  /** 摇杆已激活且是本组件登记的手指时才响应，避免攻击手指干扰走位 */
  updateFromPointer(pointer: Phaser.Input.Pointer): void {
    if (!this.active || pointer.id !== this.heldPointerId) return;
    this.track(pointer.x, pointer.y);
  }

  /** 抬指 / 指针离开：摇杆头回中、方向归零、恢复半透明 */
  release(): void {
    this.active = false;
    this.heldPointerId = null;
    this.vecX = 0;
    this.vecY = 0;
    this.knob.setPosition(this.centerX, this.centerY);
    this.base.setAlpha(this.idleAlpha);
    this.knob.setAlpha(this.idleAlpha);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.base);
    this.scene.tweens.killTweensOf(this.knob);
    this.base.destroy();
    this.knob.destroy();
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 把指针位置换算成「摇杆头位置 + 归一化方向」 */
  private track(px: number, py: number): void {
    const dx = px - this.centerX;
    const dy = py - this.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 摇杆头贴着底座内壁滑动，手指拖得再远也不会跑出底座
    const clamped = Math.min(dist, this.maxOffset);
    const k = dist > 0.0001 ? clamped / dist : 0;
    this.knob.setPosition(this.centerX + dx * k, this.centerY + dy * k);

    if (dist < this.deadZone) {
      this.vecX = 0;
      this.vecY = 0;
      return;
    }
    this.vecX = dx / dist;
    this.vecY = dy / dist;
  }

  /** 底座：深色实心圆 + 描边环 */
  private drawBase(): void {
    const g = this.base;
    g.clear();
    g.fillStyle(Palette.background.deep, 0.85);
    g.fillCircle(this.centerX, this.centerY, this.baseRadius);
    g.lineStyle(3, Palette.accent.primaryDark, 1);
    g.strokeCircle(this.centerX, this.centerY, this.baseRadius);
  }

  /** 摇杆头：以自身原点为圆心，靠 setPosition 移动，避免每帧重绘 */
  private drawKnob(): void {
    const g = this.knob;
    g.clear();
    g.fillStyle(Palette.accent.primary, 0.9);
    g.fillCircle(0, 0, this.knobRadius);
    g.lineStyle(2, Palette.text.primary, 0.85);
    g.strokeCircle(0, 0, this.knobRadius);
  }
}
