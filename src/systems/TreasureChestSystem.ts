/**
 * 宝物掉落系统（src/systems/TreasureChestSystem.ts，T-032 小朋友试玩反馈）
 * 职责：击杀小怪概率掉落宝箱（有单关上限），宝箱在场停留 despawnSec 秒（末 3s 闪烁），
 *      玩家拾起后由场景弹出「快问快答」浮层——答对随机获得一种限时加成。
 *
 * 设计：与 ScholarBuffSystem / LazyBuffSystem 同型的掉落-拾取结构；
 *      宝箱为世界坐标物件（大地图下固定在掉落点，相机滚动可见）。
 *      拾取回调只触发一次；答题逻辑在场景侧（世界冻结由场景负责）。
 */

import Phaser from 'phaser';
import type { TreasureChestSettings } from '../config/types';
import { TextureKeys } from '../scenes/BootScene';

interface Chest {
  sprite: Phaser.GameObjects.Image;
  /** 剩余停留时间（秒） */
  life: number;
  /** 上下浮动相位 */
  bobPhase: number;
}

export interface TreasureChestOptions {
  settings: TreasureChestSettings;
  /** 拾取判定半径（px），由场景按玩家半径换算传入 */
  pickupRadius: number;
  /** 拾取成功回调（触发答题浮层）；只触发一次 */
  onPickup: (x: number, y: number) => void;
}

export class TreasureChestSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: TreasureChestSettings;
  private readonly pickupRadius: number;
  private readonly onPickup: (x: number, y: number) => void;
  private readonly chests: Chest[] = [];

  private spawnedThisLevel = 0;

  constructor(scene: Phaser.Scene, opts: TreasureChestOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.pickupRadius = opts.pickupRadius;
    this.onPickup = opts.onPickup;
  }

  /** 本关已掉落宝箱数（debug/验证用） */
  get dropsSpawnedCount(): number {
    return this.spawnedThisLevel;
  }

  /** 场上宝箱数（debug/验证用） */
  get activeCount(): number {
    return this.chests.length;
  }

  /** 击杀小怪后调用：按概率掉宝箱（受单关上限约束） */
  maybeDrop(x: number, y: number): void {
    if (this.settings.maxPerLevel <= 0) return;
    if (this.spawnedThisLevel >= this.settings.maxPerLevel) return;
    if (Math.random() >= this.settings.dropChance) return;

    const sprite = this.scene.add
      .image(x, y, TextureKeys.treasureChest)
      .setDepth(105);
    sprite.setScale(1.15);
    this.spawnedThisLevel++;
    this.chests.push({ sprite, life: this.settings.despawnSec, bobPhase: Math.random() * Math.PI * 2 });
  }

  /** 每帧推进：宝箱浮动/闪烁/超时消失 + 拾取判定 */
  update(dt: number, playerX: number, playerY: number): void {
    const pr2 = this.pickupRadius * this.pickupRadius;
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const chest = this.chests[i];
      chest.life -= dt;
      chest.bobPhase += dt * 3;

      // 上下浮动 + 末 3 秒闪烁
      chest.sprite.y += Math.sin(chest.bobPhase) * 0.35;
      chest.sprite.setAlpha(chest.life < 3 ? (Math.sin(chest.life * 12) > 0 ? 1 : 0.35) : 1);

      if (chest.life <= 0) {
        this.removeAt(i);
        continue;
      }

      const dx = chest.sprite.x - playerX;
      const dy = chest.sprite.y - playerY;
      if (dx * dx + dy * dy <= pr2) {
        const { x, y } = { x: chest.sprite.x, y: chest.sprite.y };
        this.removeAt(i);
        this.onPickup(x, y);
        return; // 一帧最多触发一次拾取
      }
    }
  }

  private removeAt(index: number): void {
    const chest = this.chests[index];
    chest.sprite.destroy();
    this.chests.splice(index, 1);
  }

  /** 场景销毁时清理 */
  destroy(): void {
    for (const chest of this.chests) chest.sprite.destroy();
    this.chests.length = 0;
  }
}
