/**
 * 躺平 BUFF 系统（src/systems/LazyBuffSystem.ts）
 * 职责：按 fun-event-visual.md 的「躺平 BUFF」实现第二个随机趣味事件（拾取物版）——
 *      击杀小怪概率掉落「躺平胶囊」，拾取后短时间内获得无敌保护，但移速小幅下降
 *      （躺平的代价感，符合「手残党安慰奖」的立意）。
 *
 * 结构与 ScholarBuffSystem 同型（拾取物数组 + 计时 + 圆环视觉），便于维护。
 *
 * 数值纪律（GDD 1.4）：掉落概率 / 单关上限 / 持续时长 / 移速倍率全部来自
 *      grassCuttingConfig.polishSettings.lazyBuff，本文件只做调度与表现。
 *
 * 性能红线：掉落图标走数组手动管理（同关最多 maxDropsPerLevel 个）；
 *      BUFF 视觉只有一个蓝色圆环 + 一个头顶 💤 文字，激活期间 1 个轻量呼吸 tween。
 */

import Phaser from 'phaser';
import type { LazyBuffSettings } from '../config/types';
import { Palette, css, textStyle } from '../ui/Palette';
import { TextureKeys } from '../scenes/BootScene';

export interface LazyBuffOptions {
  settings: LazyBuffSettings;
  /** 拾取判定半径（像素），由场景按玩家半径换算传入 */
  pickupRadius: number;
  /** 玩家半径（BUFF 圆环按玩家体型换算显示尺寸） */
  playerRadius: number;
}

export class LazyBuffSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: LazyBuffSettings;
  private readonly pickupRadius: number;
  private readonly playerRadius: number;

  /** 场上待拾取的躺平胶囊 */
  private readonly drops: Phaser.GameObjects.Image[] = [];
  /** 本关已掉落总数（受 maxDropsPerLevel 约束） */
  private dropsSpawned = 0;
  /** BUFF 激活视觉：蓝色圆环 + 头顶 💤（懒创建） */
  private ring: Phaser.GameObjects.Image | null = null;
  private zzz: Phaser.GameObjects.Text | null = null;
  /** BUFF 剩余时间（秒），> 0 表示激活 */
  private buffRemaining = 0;

  constructor(scene: Phaser.Scene, opts: LazyBuffOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.pickupRadius = opts.pickupRadius;
    this.playerRadius = opts.playerRadius;
  }

  /** BUFF 是否激活（激活期间玩家无敌，但移速 × moveSpeedMultiplier） */
  get active(): boolean {
    return this.buffRemaining > 0;
  }

  /** 移速倍率：激活时 <1（躺平的代价感） */
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

  /** 击杀掉落判定：概率命中且未达单关上限时，在击杀点放一颗躺平胶囊 */
  maybeDrop(x: number, y: number): void {
    if (this.settings.maxDropsPerLevel <= 0) return;
    if (this.dropsSpawned >= this.settings.maxDropsPerLevel) return;
    if (Math.random() >= this.settings.dropChance) return;

    const drop = this.scene.add.image(x, y, TextureKeys.lazyCapsule);
    drop.setTint(Palette.accent.secondary);
    drop.setDepth(90);
    this.dropsSpawned++;
    this.drops.push(drop);
    // 轻微上下浮动，提示「可拾取」
    this.scene.tweens.add({
      targets: drop,
      y: y - 6,
      scale: 1.12,
      duration: 800,
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
        this.zzz?.setPosition(playerX + this.playerRadius + 4, playerY - this.playerRadius - 16);
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
    this.zzz?.destroy();
    this.zzz = null;
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
      ring.setAlpha(0.7);
    }
    this.zzz?.setVisible(true);
    // 拾取飘字
    const tip = this.scene.add
      .text(x, y - 34, '躺平 BUFF！短暂无敌', textStyle(18, css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setDepth(3000);
    this.scene.tweens.add({
      targets: tip,
      y: y - 64,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => tip.destroy(),
    });
  }

  /** 懒创建激活视觉：蓝色圆环（呼吸）+ 头顶 💤 */
  private ensureVisual(): void {
    if (!this.ring) {
      this.ring = this.scene.add.image(0, 0, 'zone-ring');
      this.ring.setTint(Palette.accent.secondary);
      this.ring.setDisplaySize(this.playerRadius * 2 + 24, this.playerRadius * 2 + 24);
      this.ring.setDepth(85);
      this.scene.tweens.add({
        targets: this.ring,
        alpha: { from: 0.7, to: 0.3 },
        scale: { from: 1, to: 1.06 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    if (!this.zzz) {
      this.zzz = this.scene.add.text(0, 0, '💤', {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: css(Palette.text.secondary),
      });
      this.zzz.setOrigin(0.5);
      this.zzz.setDepth(86);
    }
  }

  /** BUFF 结束：隐藏视觉 */
  private deactivateVisual(): void {
    this.ring?.setVisible(false);
    this.zzz?.setVisible(false);
  }
}
