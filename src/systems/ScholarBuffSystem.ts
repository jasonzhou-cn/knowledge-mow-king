/**
 * 学霸 BUFF 系统（src/systems/ScholarBuffSystem.ts）
 * 职责：按 fun-event-visual.md 的「学霸 BUFF」实现最低成本的随机趣味事件——
 *      击杀小怪概率掉落书本图标，玩家拾取后短时间内获得攻速（冷却加快）与移速提升。
 *
 * 数值纪律（GDD 1.4）：掉落概率 / 单关上限 / 持续时长 / 两个倍率全部来自
 *      grassCuttingConfig.polishSettings.scholarBuff，本文件只做调度与表现。
 *
 * 性能红线：掉落图标走数组手动管理（同关最多 maxDropsPerLevel 个）；
 *      BUFF 视觉只有一个圆环 + 一个星标，激活期间 1 个轻量呼吸 tween。
 */

import Phaser from 'phaser';
import type { ScholarBuffSettings } from '../config/types';
import { Palette, textStyle, css } from '../ui/Palette';
import { TextureKeys } from '../scenes/BootScene';

export interface ScholarBuffOptions {
  settings: ScholarBuffSettings;
  /** 拾取判定半径（像素），由场景按玩家半径换算传入 */
  pickupRadius: number;
  /** 玩家半径（BUFF 圆环按玩家体型换算显示尺寸） */
  playerRadius: number;
}

export class ScholarBuffSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: ScholarBuffSettings;
  private readonly pickupRadius: number;
  private readonly playerRadius: number;

  /** 场上待拾取的书本图标 */
  private readonly drops: Phaser.GameObjects.Image[] = [];
  /** 本关已掉落总数（受 maxDropsPerLevel 约束） */
  private dropsSpawned = 0;
  /** BUFF 激活视觉：金色圆环 + 头顶星标（懒创建） */
  private ring: Phaser.GameObjects.Image | null = null;
  private star: Phaser.GameObjects.Text | null = null;
  /** BUFF 剩余时间（秒），> 0 表示激活 */
  private buffRemaining = 0;

  constructor(scene: Phaser.Scene, opts: ScholarBuffOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.pickupRadius = opts.pickupRadius;
    this.playerRadius = opts.playerRadius;
  }

  /** BUFF 是否激活 */
  get active(): boolean {
    return this.buffRemaining > 0;
  }

  /** 武器冷却推进倍率：激活时冷却走得更快（<1 的 multiplier → dt × 1/multiplier） */
  get cooldownFactor(): number {
    return this.active ? 1 / Math.max(0.01, this.settings.cooldownMultiplier) : 1;
  }

  /** 移速倍率：激活时 >1 */
  get moveSpeedFactor(): number {
    return this.active ? this.settings.moveSpeedMultiplier : 1;
  }

  /** 本关已掉落数（调试/验证用） */
  get dropsSpawnedCount(): number {
    return this.dropsSpawned;
  }

  /** BUFF 剩余秒数（调试/验证用） */
  get remaining(): number {
    return this.buffRemaining;
  }

  /** 击杀掉落判定：概率命中且未达单关上限时，在击杀点放一本书 */
  maybeDrop(x: number, y: number): void {
    if (this.settings.maxDropsPerLevel <= 0) return;
    if (this.dropsSpawned >= this.settings.maxDropsPerLevel) return;
    if (Math.random() >= this.settings.dropChance) return;

    const drop = this.scene.add.image(x, y, TextureKeys.book);
    drop.setTint(Palette.accent.gold);
    drop.setDepth(90);
    drop.setScale(1);
    this.dropsSpawned++;
    this.drops.push(drop);
    // 轻微上下浮动 + 发光感，提示「可拾取」
    this.scene.tweens.add({
      targets: drop,
      y: y - 6,
      scale: 1.12,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 每帧推进：拾取判定 + BUFF 计时 + 激活视觉跟随玩家 */
  update(dt: number, playerX: number, playerY: number): void {
    // 拾取判定：距离平方，不使用物理
    const pr2 = this.pickupRadius * this.pickupRadius;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      const dx = drop.x - playerX;
      const dy = drop.y - playerY;
      if (dx * dx + dy * dy <= pr2) {
        this.drops.splice(i, 1);
        this.scene.tweens.killTweensOf(drop);
        drop.destroy();
        this.activate(playerX, playerY);
      }
    }

    if (this.buffRemaining > 0) {
      this.buffRemaining -= dt;
      if (this.buffRemaining <= 0) {
        this.buffRemaining = 0;
        this.deactivateVisual();
      } else if (this.ring) {
        this.ring.setPosition(playerX, playerY);
        this.star?.setPosition(playerX, playerY - this.playerRadius - 18);
      }
    }
  }

  /** 场景销毁时清理 */
  destroy(): void {
    for (const drop of this.drops) {
      this.scene.tweens.killTweensOf(drop);
      drop.destroy();
    }
    this.drops.length = 0;
    this.ring?.destroy();
    this.ring = null;
    this.star?.destroy();
    this.star = null;
    this.buffRemaining = 0;
  }

  /** 拾取：激活/续接 BUFF 并给出明确反馈 */
  private activate(x: number, y: number): void {
    this.buffRemaining = this.settings.duration;
    this.ensureVisual();
    const ring = this.ring;
    if (ring) {
      ring.setVisible(true);
      this.scene.tweens.killTweensOf(ring);
      ring.setAlpha(0.75);
    }
    this.star?.setVisible(true);
    // 拾取飘字
    const tip = this.scene.add
      .text(x, y - 34, '学霸 BUFF！', textStyle(20, css(Palette.accent.gold), { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setDepth(3000);
    this.scene.tweens.add({
      targets: tip,
      y: y - 64,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => tip.destroy(),
    });
  }

  /** 懒创建激活视觉：金色圆环（呼吸）+ 头顶 ✦ */
  private ensureVisual(): void {
    if (!this.ring) {
      this.ring = this.scene.add.image(0, 0, 'zone-ring');
      this.ring.setTint(Palette.accent.gold);
      this.ring.setDisplaySize(this.playerRadius * 2 + 26, this.playerRadius * 2 + 26);
      this.ring.setDepth(85);
      this.scene.tweens.add({
        targets: this.ring,
        alpha: { from: 0.75, to: 0.35 },
        scale: { from: 1, to: 1.08 },
        duration: 750,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    if (!this.star) {
      this.star = this.scene.add.text(0, 0, '\u2726', {
        fontFamily: 'sans-serif',
        fontSize: '22px',
        color: css(Palette.accent.gold),
      });
      this.star.setOrigin(0.5);
      this.star.setDepth(86);
    }
  }

  /** BUFF 结束：隐藏视觉 */
  private deactivateVisual(): void {
    this.ring?.setVisible(false);
    this.star?.setVisible(false);
  }
}
