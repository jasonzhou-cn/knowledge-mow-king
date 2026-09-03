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
 *      BUFF 视觉只有一个蓝色圆环 + 一组头顶 Z z z 文字（3 个轻量循环 tween），
 *      激活期间圆环 1 个呼吸 tween。
 *
 * T-027 BUFF 并存优先级（fun-event-visual.md §8）：学霸 BUFF > 躺平 BUFF。
 *      学霸激活期间躺平被「压制」：视觉隐藏、无敌/移速效果暂停、剩余时间冻结保留；
 *      学霸结束后自动恢复显示并继续倒计时（setSuppressed 由场景每帧同步）。
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
  /** BUFF 激活视觉：蓝色圆环 + 头顶 Z z z（懒创建） */
  private ring: Phaser.GameObjects.Image | null = null;
  private zzzGroup: Phaser.GameObjects.Container | null = null;
  /** BUFF 剩余时间（秒），> 0 表示激活 */
  private buffRemaining = 0;
  /** T-027：被学霸 BUFF 压制中（视觉隐藏 + 效果暂停 + 计时冻结） */
  private suppressed = false;

  constructor(scene: Phaser.Scene, opts: LazyBuffOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.pickupRadius = opts.pickupRadius;
    this.playerRadius = opts.playerRadius;
  }

  /** BUFF 是否激活（激活期间玩家无敌，但移速 × moveSpeedMultiplier；被压制时视为未激活） */
  get active(): boolean {
    return this.buffRemaining > 0 && !this.suppressed;
  }

  /** 移速倍率：激活时 <1（躺平的代价感）；被压制时不生效 */
  get moveSpeedFactor(): number {
    return this.active ? this.settings.moveSpeedMultiplier : 1;
  }

  /** 是否处于被学霸 BUFF 压制状态（调试/验证用） */
  get isSuppressed(): boolean {
    return this.suppressed;
  }

  /**
   * T-027：同步压制状态（场景每帧调用：suppressed = scholar.active）。
   * 压制瞬间隐藏视觉；解除压制且仍有剩余时间时恢复视觉并继续倒计时。
   */
  setSuppressed(value: boolean): void {
    if (this.suppressed === value) return;
    this.suppressed = value;
    if (value) {
      this.hideVisual();
    } else if (this.buffRemaining > 0) {
      this.showVisual();
    }
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
      // T-027：被学霸压制期间计时冻结（剩余时间保留，解除后继续倒数）
      if (!this.suppressed) {
        this.buffRemaining -= dt;
        if (this.buffRemaining <= 0) {
          this.buffRemaining = 0;
          this.hideVisual();
        }
      }
      if (this.ring && !this.suppressed) {
        this.ring.setPosition(playerX, playerY);
        this.zzzGroup?.setPosition(playerX + this.playerRadius + 6, playerY - this.playerRadius - 14);
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
    this.zzzGroup?.destroy();
    this.zzzGroup = null;
    this.buffRemaining = 0;
    this.suppressed = false;
  }

  /** 拾取：激活/续接 BUFF 并给出明确反馈 */
  private activate(x: number, y: number): void {
    this.buffRemaining = this.settings.duration;
    this.ensureVisual();
    if (this.suppressed) {
      // T-027：学霸生效中拾取躺平 → 时间冻结保留，视觉不出现（学霸优先级覆盖）
      const tip = this.scene.add
        .text(x, y - 34, '躺平已冻结（学霸生效中）', textStyle(16, css(Palette.text.secondary), { fontStyle: 'bold' }))
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
      return;
    }
    this.showVisual();
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

  /** 懒创建激活视觉：蓝色圆环（呼吸）+ 头顶 Z z z（程序化，替代 emoji） */
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
    if (!this.zzzGroup) {
      // T-027：💤 emoji → 程序化「Z z z」三个字母渐次缩小漂浮（零素材红线）
      const specs = [
        { ch: 'Z', size: 20, ox: 8, oy: -4, floatMs: 1300, delay: 0 },
        { ch: 'z', size: 15, ox: -3, oy: -13, floatMs: 1500, delay: 350 },
        { ch: 'z', size: 11, ox: -11, oy: -20, floatMs: 1700, delay: 700 },
      ];
      const texts = specs.map((s) => {
        const t = this.scene.add.text(s.ox, s.oy, s.ch, {
          fontFamily: 'sans-serif',
          fontSize: `${s.size}px`,
          color: css(Palette.text.secondary),
          fontStyle: 'bold',
        });
        t.setOrigin(0.5);
        // 缓慢上浮 + 淡出的无限循环（错峰，模拟打瞌睡的呼吸感）
        this.scene.tweens.add({
          targets: t,
          y: s.oy - 10,
          alpha: { from: 0.9, to: 0 },
          duration: s.floatMs,
          delay: s.delay,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        return t;
      });
      this.zzzGroup = this.scene.add.container(0, 0, texts);
      this.zzzGroup.setDepth(86);
    }
  }

  /** 显示激活视觉（解除压制 / 首次激活） */
  private showVisual(): void {
    const ring = this.ring;
    if (ring) {
      ring.setVisible(true);
      this.scene.tweens.killTweensOf(ring);
      ring.setAlpha(0.7);
      this.scene.tweens.add({
        targets: ring,
        alpha: { from: 0.7, to: 0.3 },
        scale: { from: 1, to: 1.06 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.zzzGroup?.setVisible(true);
  }

  /** 隐藏激活视觉（BUFF 结束或被学霸压制），圆环呼吸 tween 一并停掉 */
  private hideVisual(): void {
    if (this.ring) {
      this.scene.tweens.killTweensOf(this.ring);
      this.ring.setVisible(false);
    }
    this.zzzGroup?.setVisible(false);
  }
}
