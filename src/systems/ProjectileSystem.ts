/**
 * 弹丸系统（src/systems/ProjectileSystem.ts）
 * 职责：以对象池承载全部远程弹丸，负责飞行、穿透计数、出界/射程耗尽回收，
 *      并在命中时把「击退向量」交回上层做统一结算。
 *
 * 性能设计（GDD 1.2 碰撞精简原则）：
 *  - 不使用任何物理引擎，弹丸不注册碰撞体，只做「位置推进 + 距离平方」判定；
 *  - 弹丸数量受 performanceSettings.projectilePoolSize 硬上限约束，池满则丢弃新弹丸；
 *  - 采用「子步进」推进：把一帧的位移切成不超过弹丸半径的小段，
 *    既避免了高速弹丸穿透小怪，又不需要提高判定频率。
 *
 * 数值来源：速度 / 射程 / 穿透 / 伤害全部由调用方从 ResolvedWeapon 注入，本文件不做任何数值计算。
 */

import Phaser from 'phaser';
import { distanceSquared } from '../utils/MathUtil';
import type { Monster } from './MonsterSpawner';

/** 发射一枚弹丸所需的全部参数（全部来自解析后的武器数值） */
export interface ProjectileSpawnParams {
  x: number;
  y: number;
  /** 飞行方向（弧度） */
  angle: number;
  speed: number;
  damage: number;
  /** 可穿透次数，0 = 命中一次即消失 */
  pierce: number;
  knockback: number;
  /** 最大飞行距离（像素），超出即回收 */
  range: number;
  /** 命中判定半径（像素） */
  radius: number;
  texture: string;
  tint: number;
  /** 命中回调透出的来源标识（用于伤害飘字升档与击杀特效配色） */
  weaponId: string;
}

/** 弹丸命中时回传给上层的上下文 */
export interface ProjectileHitPayload {
  monster: Monster;
  damage: number;
  /** 击退方向单位向量（由飞行方向决定） */
  dirX: number;
  dirY: number;
  knockback: number;
  weaponId: string;
  /** 命中点坐标，用于生成命中特效 */
  x: number;
  y: number;
}

/** 对象池中的一个弹丸槽位 */
interface Projectile {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  damage: number;
  pierceLeft: number;
  knockback: number;
  traveled: number;
  range: number;
  radius: number;
  weaponId: string;
}

export interface ProjectileSystemOptions {
  poolSize: number;
  /** 判定用的视口范围，超出即回收（含回收余量） */
  viewWidth: number;
  viewHeight: number;
  /** 出界回收余量（像素），允许弹丸飞出屏幕一点再消失 */
  despawnMargin: number;
  /** 弹丸渲染层级 */
  depth?: number;
}

export class ProjectileSystem {
  private readonly scene: Phaser.Scene;
  private readonly opts: ProjectileSystemOptions;
  private readonly pool: Projectile[] = [];
  private activeCount = 0;

  constructor(scene: Phaser.Scene, opts: ProjectileSystemOptions) {
    this.scene = scene;
    this.opts = opts;
    this.preallocate();
  }

  /** 当前飞行中的弹丸数量 */
  get aliveCount(): number {
    return this.activeCount;
  }

  /** 对象池容量（性能红线：运行期恒定，不会动态创建） */
  get capacity(): number {
    return this.pool.length;
  }

  /**
   * 发射一枚弹丸。
   * @returns 是否发射成功；池满时返回 false（丢弃，绝不动态扩容）
   */
  fire(p: ProjectileSpawnParams): boolean {
    const slot = this.acquire();
    if (!slot) return false;

    slot.active = true;
    slot.x = p.x;
    slot.y = p.y;
    slot.dirX = Math.cos(p.angle);
    slot.dirY = Math.sin(p.angle);
    slot.speed = p.speed;
    slot.damage = p.damage;
    slot.pierceLeft = p.pierce;
    slot.knockback = p.knockback;
    slot.traveled = 0;
    slot.range = p.range;
    slot.radius = p.radius;
    slot.weaponId = p.weaponId;

    slot.sprite.setTexture(p.texture);
    slot.sprite.setTint(p.tint);
    slot.sprite.setPosition(p.x, p.y);
    slot.sprite.setRotation(p.angle);
    slot.sprite.setAlpha(1);
    slot.sprite.setActive(true).setVisible(true);

    this.activeCount++;
    return true;
  }

  /**
   * 推进全部弹丸。
   * @param dt 帧间隔（秒），由场景按顿帧缩放后传入
   * @param monsters 当前存活小怪列表
   * @param onHit 命中回调，同一只小怪在一次子步进内只会被同一枚弹丸命中一次
   */
  update(dt: number, monsters: readonly Monster[], onHit: (payload: ProjectileHitPayload) => void): void {
    if (this.activeCount === 0) return;

    for (const proj of this.pool) {
      if (!proj.active) continue;

      let remaining = proj.speed * dt;
      // 子步进上限取弹丸自身半径，保证不会一步跨过一个小怪
      const maxStep = Math.max(2, proj.radius);

      while (remaining > 0 && proj.active) {
        const step = Math.min(remaining, maxStep);
        remaining -= step;
        proj.x += proj.dirX * step;
        proj.y += proj.dirY * step;
        proj.traveled += step;
        proj.sprite.setPosition(proj.x, proj.y);

        for (const monster of monsters) {
          if (!monster.alive) continue;
          const reach = proj.radius + monster.radius;
          if (distanceSquared(proj.x, proj.y, monster.sprite.x, monster.sprite.y) > reach * reach) {
            continue;
          }

          onHit({
            monster,
            damage: proj.damage,
            dirX: proj.dirX,
            dirY: proj.dirY,
            knockback: proj.knockback,
            weaponId: proj.weaponId,
            x: proj.x,
            y: proj.y,
          });

          if (proj.pierceLeft > 0) {
            proj.pierceLeft--;
            // 穿透后伤害不衰减，但视觉上变淡，让玩家感知到「还能再穿一个」
            proj.sprite.setAlpha(Math.max(0.35, 1 - proj.pierceLeft * 0.25));
          } else {
            this.release(proj);
            break;
          }
        }

        if (proj.traveled >= proj.range) {
          this.release(proj);
        }
      }

      if (!proj.active) continue;

      const margin = this.opts.despawnMargin;
      if (
        proj.x < -margin ||
        proj.x > this.opts.viewWidth + margin ||
        proj.y < -margin ||
        proj.y > this.opts.viewHeight + margin
      ) {
        this.release(proj);
      }
    }
  }

  /** 回收全部飞行中的弹丸（关卡结束 / 场景重启） */
  clear(): void {
    for (const proj of this.pool) {
      if (proj.active) this.release(proj);
    }
  }

  /** 销毁对象池及全部显示对象 */
  destroy(): void {
    this.clear();
    for (const proj of this.pool) proj.sprite.destroy();
    this.pool.length = 0;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private preallocate(): void {
    for (let i = 0; i < this.opts.poolSize; i++) {
      const sprite = this.scene.add.image(0, 0, 'fx-bolt');
      sprite.setActive(false).setVisible(false).setDepth(this.opts.depth ?? 120);
      this.pool.push({
        sprite,
        active: false,
        x: 0,
        y: 0,
        dirX: 1,
        dirY: 0,
        speed: 0,
        damage: 0,
        pierceLeft: 0,
        knockback: 0,
        traveled: 0,
        range: 0,
        radius: 4,
        weaponId: '',
      });
    }
  }

  /** 取一个空闲槽位；池满返回 null */
  private acquire(): Projectile | null {
    for (const proj of this.pool) {
      if (!proj.active) return proj;
    }
    return null;
  }

  private release(proj: Projectile): void {
    proj.active = false;
    proj.pierceLeft = 0;
    proj.sprite.setActive(false).setVisible(false);
    this.activeCount = Math.max(0, this.activeCount - 1);
  }
}
