/**
 * 无厘头陷阱系统（src/systems/TrapSystem.ts，T-032 小朋友试玩反馈）
 * 职责：开局在世界内铺设一批「踩到就触发」的陷阱（踩屎/触电/水洼/香蕉皮/
 *      妈妈的怒吼/断网路由器），玩家碰到后触发对应 debuff 并消失（可配置再生）。
 *
 * 设计：
 *  - 陷阱为世界坐标静态物件（大地图下铺满世界），出生点周围保留安全区；
 *  - 类型按 weight 加权随机；一帧最多触发一次；
 *  - 效果结算在场景侧（applyTrap），本系统只做「铺设 + 碰撞判定 + 再生调度」。
 */

import Phaser from 'phaser';
import type { TrapSettings, TrapTypeSettings } from '../config/types';

interface TrapInstance {
  sprite: Phaser.GameObjects.Image;
  type: TrapTypeSettings;
  alive: boolean;
  /** 再生倒计时（秒）；<0 表示不再生 */
  respawnTimer: number;
}

export interface TrapSystemOptions {
  settings: TrapSettings;
  worldW: number;
  worldH: number;
  /** 玩家判定半径（px） */
  playerRadius: number;
  /** 玩家出生点（世界坐标），陷阱避开该点附近 */
  spawnSafeX: number;
  spawnSafeY: number;
  /** 玩家踩到陷阱时的回调 */
  onTrigger: (type: TrapTypeSettings) => void;
}

export class TrapSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: TrapSettings;
  private readonly worldW: number;
  private readonly worldH: number;
  private readonly playerRadius: number;
  private readonly safeX: number;
  private readonly safeY: number;
  private readonly onTrigger: (type: TrapTypeSettings) => void;
  private readonly traps: TrapInstance[] = [];

  constructor(scene: Phaser.Scene, opts: TrapSystemOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.playerRadius = opts.playerRadius;
    this.safeX = opts.spawnSafeX;
    this.safeY = opts.spawnSafeY;
    this.onTrigger = opts.onTrigger;

    if (this.settings.enabled) this.spawnAll();
  }

  /** 场上存活陷阱数（debug/验证用） */
  get aliveCount(): number {
    return this.traps.filter((t) => t.alive).length;
  }

  /** 加权随机挑一种陷阱 */
  private pickType(): TrapTypeSettings {
    const total = this.settings.types.reduce((sum, t) => sum + Math.max(0, t.weight), 0);
    let roll = Math.random() * Math.max(0.0001, total);
    for (const t of this.settings.types) {
      roll -= Math.max(0, t.weight);
      if (roll <= 0) return t;
    }
    return this.settings.types[0];
  }

  /** 铺设开局陷阱 */
  private spawnAll(): void {
    for (let i = 0; i < this.settings.spawnCount; i++) {
      this.spawnOne();
    }
  }

  /** 铺一只：位置避开出生点、彼此保持间距 */
  private spawnOne(): void {
    const pad = 90;
    for (let tries = 0; tries < 24; tries++) {
      const x = pad + Math.random() * Math.max(1, this.worldW - pad * 2);
      const y = pad + Math.random() * Math.max(1, this.worldH - pad * 2);
      // 离玩家出生点至少 260px
      const dxs = x - this.safeX;
      const dys = y - this.safeY;
      if (dxs * dxs + dys * dys < 260 * 260) continue;
      // 彼此至少 140px
      let tooClose = false;
      for (const t of this.traps) {
        const dx = x - t.sprite.x;
        const dy = y - t.sprite.y;
        if (dx * dx + dy * dy < 140 * 140) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const type = this.pickType();
      const sprite = this.scene.add
        .image(x, y, this.textureKey(type.id))
        .setDepth(60)
        .setAlpha(0.95);
      sprite.setScale(1.1);
      this.traps.push({ sprite, type, alive: true, respawnTimer: -1 });
      return;
    }
  }

  private textureKey(id: string): string {
    const keys: Record<string, string> = {
      poop: 'tex-trap-poop',
      bolt: 'tex-trap-bolt',
      puddle: 'tex-trap-puddle',
      banana: 'tex-trap-banana',
      megaphone: 'tex-trap-megaphone',
      router: 'tex-trap-router',
    };
    return keys[id] ?? 'tex-trap-poop';
  }

  /** 每帧推进：再生调度 + 玩家碰撞判定 */
  update(dt: number, playerX: number, playerY: number): void {
    const reach = this.playerRadius + 20;
    for (const trap of this.traps) {
      if (!trap.alive) {
        if (trap.respawnTimer > 0) {
          trap.respawnTimer -= dt;
          if (trap.respawnTimer <= 0) {
            // 原地复活（位置不变，简单可预期）
            trap.alive = true;
            trap.type = this.pickType();
            trap.sprite.setTexture(this.textureKey(trap.type.id));
            trap.sprite.setAlpha(0.95);
            trap.respawnTimer = -1;
          }
        }
        continue;
      }

      const dx = trap.sprite.x - playerX;
      const dy = trap.sprite.y - playerY;
      if (dx * dx + dy * dy <= reach * reach) {
        trap.alive = false;
        if (this.settings.respawnSec > 0) {
          trap.respawnTimer = this.settings.respawnSec;
          trap.sprite.setAlpha(0.12);
        } else {
          trap.sprite.destroy();
        }
        this.onTrigger(trap.type);
        return; // 一帧最多触发一次
      }
    }
  }

  /** 场景销毁时清理 */
  destroy(): void {
    for (const trap of this.traps) trap.sprite.destroy();
    this.traps.length = 0;
  }
}
