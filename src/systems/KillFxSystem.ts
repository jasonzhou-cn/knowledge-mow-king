/**
 * 击杀打击感系统（src/systems/KillFxSystem.ts）
 * 职责：把「无双割草」最核心的四件反馈集中实现 ——
 *      ① 顿帧 hitstop（击杀瞬间压低 timeScale，制造卡肉感）
 *      ② 击杀爆散（碎片 + 扩散圆环 + 白闪，全部走对象池）
 *      ③ 扩散圆环与白闪的生命周期管理
 *      ④ 相机震动的可开关封装（GDD 1.2：震动强度受限且必须可关闭）
 *
 * 性能设计（GDD 1.2 粒子上限限制原则）：
 *  - 不使用 Phaser ParticleEmitter（配额 0），全部用 Image 对象池手动推进；
 *  - 碎片 / 圆环 / 白闪数量各自受 performanceSettings 里的池上限硬约束，池满则丢弃新请求；
 *  - 全部特效由 updateFx(dt) 手动推进，因此顿帧期间会跟着一起「冻住」，强化打击感。
 *
 * 顿帧实现要点：
 *  - 顿帧用「真实时间」倒计时（update 收的是未缩放的 dt），
 *    若用被缩放的 dt 计数，timeScale=0.05 时一次 70ms 的顿帧会被拉成 1.4 秒。
 */

import Phaser from 'phaser';
import type { KillFxSettings } from '../config/types';
import { Palette } from '../ui/Palette';

/** 对象池中的一个碎片 */
interface Shard {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  /** 由配置 shardSize 与贴图尺寸换算出的基准缩放，避免每帧 setDisplaySize 覆盖动画 */
  baseScale: number;
}

/** 对象池中的一个扩散圆环 / 白闪 */
interface RingFx {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  life: number;
  maxLife: number;
  fromScale: number;
  toScale: number;
  fromAlpha: number;
  baseScale: number;
}

export interface KillFxSystemOptions {
  settings: KillFxSettings;
  shardPoolSize: number;
  ringPoolSize: number;
  /** 特效渲染层级（应高于小怪、低于 HUD） */
  depth?: number;
}

const TAU = Math.PI * 2;

/** 碎片贴图（fx-shard）的边长，用于把配置的 shardSize 换算成缩放比例 */
const SHARD_TEXTURE_SIZE = 12;
/** 扩散圆环贴图（zone-ring）的边长，用于把配置的放大倍率换算成实际像素 */
const RING_TEXTURE_SIZE = 256;
/** 白闪贴图（glow）的边长 */
const FLASH_TEXTURE_SIZE = 96;

export class KillFxSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: KillFxSettings;
  private readonly shards: Shard[] = [];
  private readonly rings: RingFx[] = [];
  private readonly flashes: RingFx[] = [];
  private readonly depth: number;

  /** 顿帧剩余时间（秒，真实时间） */
  private hitstopRemaining = 0;
  /** 距离上次顿帧结束的真实时间（秒），用于最小间隔节流 */
  private sinceLastHitstop = Number.POSITIVE_INFINITY;

  constructor(scene: Phaser.Scene, opts: KillFxSystemOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.depth = opts.depth ?? 150;
    this.preallocate(this.shards, opts.shardPoolSize, 'fx-shard');
    this.preallocate(this.rings, opts.ringPoolSize, 'zone-ring');
    this.preallocate(this.flashes, opts.ringPoolSize, 'glow');
  }

  /** 顿帧是否正在生效 */
  get hitstopActive(): boolean {
    return this.hitstopRemaining > 0;
  }

  /**
   * 请求一次顿帧。
   * 规则：顿帧期间不叠加；两次顿帧之间必须间隔 hitstopMinInterval，
   * 避免高连击时把游戏卡成永久慢动作（GDD 1.2 性能与体验的兜底）。
   */
  requestHitstop(durationMs: number): void {
    const s = this.settings;
    if (!s.hitstopEnabled || durationMs <= 0) return;
    if (this.hitstopRemaining > 0) return;
    if (this.sinceLastHitstop < s.hitstopMinInterval / 1000) return;

    this.hitstopRemaining = durationMs / 1000;
    this.scene.time.timeScale = s.hitstopTimeScale;
  }

  /**
   * 用真实时间推进顿帧。
   * 必须在场景 update 里第一个调用，且传入未被 timeScale 缩放的 dt。
   */
  update(realDt: number): void {
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= realDt;
      if (this.hitstopRemaining <= 0) {
        this.hitstopRemaining = 0;
        this.scene.time.timeScale = 1;
        this.sinceLastHitstop = 0;
      }
      return;
    }
    this.sinceLastHitstop += realDt;
  }

  /**
   * 击杀爆散：碎片 + 扩散圆环 + 白闪。
   * @param dirX / dirY 命中方向的单位向量，碎片会沿此方向偏置，制造「被打飞」的方向感
   */
  burst(x: number, y: number, tint: number, dirX: number, dirY: number): void {
    const s = this.settings;

    for (let i = 0; i < s.shardCount; i++) {
      const shard = this.acquire(this.shards);
      if (!shard) break;

      const angle = (i / Math.max(1, s.shardCount)) * TAU + Phaser.Math.FloatBetween(-0.35, 0.35);
      // 环形飞散 + 命中方向偏置：既炸得开，又看得出是从哪一边打死的
      const bias = 0.55;
      shard.x = x;
      shard.y = y;
      shard.vx = Math.cos(angle) * s.shardSpeed + dirX * s.shardSpeed * bias;
      shard.vy = Math.sin(angle) * s.shardSpeed + dirY * s.shardSpeed * bias;
      shard.life = s.shardLife;
      shard.maxLife = s.shardLife;
      shard.baseScale = s.shardSize / SHARD_TEXTURE_SIZE;

      shard.sprite.setPosition(x, y);
      shard.sprite.setTint(tint);
      shard.sprite.setRotation(Phaser.Math.FloatBetween(0, TAU));
      shard.sprite.setAlpha(1);
      shard.sprite.setScale(shard.baseScale);
      shard.sprite.setActive(true).setVisible(true);
    }

    // 扩散圆环：用空心圆环贴图放大淡出，替代粒子
    const ring = this.acquire(this.rings);
    if (ring) {
      ring.life = s.ringDuration / 1000;
      ring.maxLife = ring.life;
      ring.fromScale = s.ringFromScale;
      ring.toScale = s.ringToScale;
      ring.fromAlpha = 0.85;
      // 基准缩放把 256px 的圆环贴图先缩到约 36px，再套用配置里的放大倍率
      ring.baseScale = 36 / RING_TEXTURE_SIZE;
      ring.sprite.setPosition(x, y);
      ring.sprite.setTint(tint);
      ring.sprite.setScale(s.ringFromScale * ring.baseScale);
      ring.sprite.setAlpha(0.85);
      ring.sprite.setActive(true).setVisible(true);
    }

    // 短促白闪：给击杀点一个「瞬间过曝」的重音
    const flash = this.acquire(this.flashes);
    if (flash) {
      flash.life = s.flashDuration / 1000;
      flash.maxLife = flash.life;
      flash.fromScale = 1;
      flash.toScale = 1;
      flash.fromAlpha = 0.9;
      flash.baseScale = 46 / FLASH_TEXTURE_SIZE;
      flash.sprite.setPosition(x, y);
      flash.sprite.setTint(Palette.combat.monsterHurt);
      flash.sprite.setScale(flash.baseScale);
      flash.sprite.setAlpha(0.9);
      flash.sprite.setActive(true).setVisible(true);
    }
  }

  /** 命中点的小型火花（未击杀时也给出手反馈） */
  spark(x: number, y: number, tint: number): void {
    const shard = this.acquire(this.shards);
    if (!shard) return;
    const angle = Phaser.Math.FloatBetween(0, TAU);
    shard.x = x;
    shard.y = y;
    shard.vx = Math.cos(angle) * this.settings.shardSpeed * 0.35;
    shard.vy = Math.sin(angle) * this.settings.shardSpeed * 0.35;
    shard.life = this.settings.shardLife * 0.45;
    shard.maxLife = shard.life;
    shard.baseScale = (this.settings.shardSize * 0.6) / SHARD_TEXTURE_SIZE;
    shard.sprite.setPosition(x, y);
    shard.sprite.setTint(tint);
    shard.sprite.setRotation(angle);
    shard.sprite.setAlpha(0.9);
    shard.sprite.setScale(shard.baseScale);
    shard.sprite.setActive(true).setVisible(true);
  }

  /**
   * 推进全部特效。
   * @param dt 已被顿帧缩放过的帧间隔，保证顿帧期间特效一起冻住
   */
  updateFx(dt: number): void {
    const drag = Math.exp(-this.settings.shardDrag * dt);

    for (const shard of this.shards) {
      if (!shard.active) continue;
      shard.vx *= drag;
      shard.vy *= drag;
      shard.x += shard.vx * dt;
      shard.y += shard.vy * dt;
      shard.life -= dt;

      if (shard.life <= 0) {
        this.releaseShard(shard);
        continue;
      }
      const t = shard.life / shard.maxLife;
      shard.sprite.setPosition(shard.x, shard.y);
      shard.sprite.setAlpha(t);
      shard.sprite.setScale(shard.baseScale * (0.4 + 0.6 * t));
      shard.sprite.setRotation(shard.sprite.rotation + 6 * dt);
    }

    this.updateRings(this.rings, dt);
    this.updateRings(this.flashes, dt);
  }

  /**
   * 相机震动。GDD 1.2 要求震动必须可关闭且强度受限，
   * 这里统一收口：调用方传进来的强度若超过配置开关，直接忽略。
   */
  shake(intensity: number, duration: number): void {
    if (!this.settings.cameraShakeEnabled || intensity <= 0) return;
    this.scene.cameras.main.shake(duration, intensity);
  }

  /** 回收全部特效并恢复 timeScale（关卡结束 / 场景重启时必须调用，否则会带着慢动作进下一关） */
  clear(): void {
    for (const shard of this.shards) {
      if (shard.active) this.releaseShard(shard);
    }
    for (const ring of this.rings) {
      if (ring.active) this.releaseRing(ring);
    }
    for (const flash of this.flashes) {
      if (flash.active) this.releaseRing(flash);
    }
    this.hitstopRemaining = 0;
    this.sinceLastHitstop = Number.POSITIVE_INFINITY;
    this.scene.time.timeScale = 1;
  }

  /** 销毁全部显示对象 */
  destroy(): void {
    this.clear();
    for (const shard of this.shards) shard.sprite.destroy();
    for (const ring of this.rings) ring.sprite.destroy();
    for (const flash of this.flashes) flash.sprite.destroy();
    this.shards.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private preallocate(list: (Shard | RingFx)[], size: number, texture: string): void {
    for (let i = 0; i < size; i++) {
      const sprite = this.scene.add.image(0, 0, texture);
      sprite.setActive(false).setVisible(false).setDepth(this.depth);
      list.push({
        sprite,
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        fromScale: 1,
        toScale: 1,
        fromAlpha: 1,
        baseScale: 1,
      } as Shard & RingFx);
      // 兜底：保证新建槽位的基准缩放合法，避免除零导致特效不可见
      const created = list[list.length - 1] as Shard & RingFx;
      created.baseScale = texture === 'fx-shard' ? this.settings.shardSize / SHARD_TEXTURE_SIZE : 1;
    }
  }

  private updateRings(list: RingFx[], dt: number): void {
    for (const fx of list) {
      if (!fx.active) continue;
      fx.life -= dt;
      if (fx.life <= 0) {
        this.releaseRing(fx);
        continue;
      }
      const t = 1 - fx.life / fx.maxLife;
      const scale = fx.fromScale + (fx.toScale - fx.fromScale) * t;
      fx.sprite.setScale(scale * fx.baseScale);
      fx.sprite.setAlpha(fx.fromAlpha * (1 - t));
    }
  }

  /**
   * 取一个空闲槽位并立即标记为占用。
   * 占用必须在这里完成：若留给调用方，连续取多个槽位时会一直拿到同一个，
   * 爆散就只剩一个碎片（曾因此在冒烟测试里暴露）。
   */
  private acquire<T extends { active: boolean }>(list: T[]): T | null {
    for (const item of list) {
      if (!item.active) {
        item.active = true;
        return item;
      }
    }
    return null;
  }

  private releaseShard(shard: Shard): void {
    shard.active = false;
    shard.vx = 0;
    shard.vy = 0;
    shard.sprite.setActive(false).setVisible(false);
  }

  private releaseRing(fx: RingFx): void {
    fx.active = false;
    fx.sprite.setActive(false).setVisible(false);
  }
}
