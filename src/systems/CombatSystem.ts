/**
 * 命中结算中心（src/systems/CombatSystem.ts）
 * 职责：统一接收来自近战扇形与远程弹丸的命中事件，在一个地方完成
 *      「扣血 → 击退 → 伤害飘字 → 击杀判定 → 击杀特效触发 → 连击登记」的完整链路。
 *
 * 改造说明：本文件原先是「按冷却自动释放环形 AOE 的自动战斗系统」，
 *      现按「自动瞄准 + 手动触发」的新战斗形态去掉了自动施法，
 *      只保留并复用两样东西：跳帧检测（damageCheckFrameInterval）与距离平方 / 点积判定。
 *
 * 性能设计（GDD 1.2 碰撞精简原则）：
 *  - 全程不使用物理引擎，不注册任何碰撞体；
 *  - 群体判定走「跳帧检测 + 距离平方」，扇形额外用单位向量点积判夹角，避免三角函数；
 *  - 伤害检测频率由配置 damageCheckFrameInterval 控制，非每帧全量遍历。
 *
 * 数值纪律（GDD 1.4）：伤害、击退、击杀击退倍率全部由外部注入，本文件不实现成长公式。
 */

import Phaser from 'phaser';
import { distanceSquared } from '../utils/MathUtil';
import type { Monster } from './MonsterSpawner';

/** 结算所需的外部能力；全部由割草场景注入，本系统不直接依赖具体子系统 */
export interface CombatHooks {
  /**
   * 扣血并判定死亡。
   * @returns 本次伤害是否致死（致死时由生成器决定是立即回收还是转入尸体飞散）
   */
  applyDamage: (monster: Monster, amount: number) => boolean;
  /** 沿单位方向击退 */
  knockback: (monster: Monster, dirX: number, dirY: number, strength: number) => void;
  /** 命中未致死时的伤害飘字 + 受击闪白 */
  showDamage: (monster: Monster, amount: number) => void;
  /** 击杀特效触发（爆散、顿帧、震动、击杀飘字由外部实现） */
  onKill: (monster: Monster, x: number, y: number, dirX: number, dirY: number) => void;
  /** 连击登记，返回递增后的连击数 */
  registerKill: () => void;
}

export interface CombatSystemOptions {
  /** 伤害检测的跳帧间隔 */
  damageCheckFrameInterval: number;
  /** 击杀时击退力相对受击击退的倍率（来自 weaponConfig.killFx） */
  killKnockbackMultiplier: number;
  hooks: CombatHooks;
}

/** 单次命中的入参 */
export interface HitParams {
  monster: Monster;
  /** 单次命中基础伤害（不含连击乘数） */
  damage: number;
  /** 连击乘数，由 ComboSystem 提供 */
  comboMultiplier: number;
  /** 命中方向单位向量，决定击退与爆散方向 */
  dirX: number;
  dirY: number;
  /** 受击击退力度（像素/秒） */
  knockback: number;
}

/** 单次命中的结算结果 */
export interface HitResult {
  amount: number;
  killed: boolean;
}

/** 近战扇形立即结算的入参 */
export interface SectorSweepParams {
  x: number;
  y: number;
  /** 扇形中轴朝向（弧度） */
  facing: number;
  /** 扇形半径（像素） */
  range: number;
  /** 扇形总张角（度） */
  sectorAngle: number;
  damage: number;
  comboMultiplier: number;
  knockback: number;
  monsters: readonly Monster[];
}

export class CombatSystem {
  private readonly hooks: CombatHooks;
  private readonly opts: CombatSystemOptions;
  private frameCounter = 0;

  constructor(_scene: Phaser.Scene, opts: CombatSystemOptions) {
    this.opts = opts;
    this.hooks = opts.hooks;
  }

  /** 推进帧计数；场景每帧调用一次 */
  update(): void {
    this.frameCounter++;
  }

  /**
   * 本帧是否该做伤害检测（跳帧检测，GDD 1.2 碰撞精简原则）。
   * 接触伤害等高频判定共用同一个节拍，保证全场景的检测密度一致。
   */
  shouldCheckThisFrame(): boolean {
    return this.frameCounter % this.opts.damageCheckFrameInterval === 0;
  }

  /**
   * 近战扇形立即结算：遍历候选小怪，用「距离平方 + 单位向量点积」判定是否落在扇形内。
   * @returns 命中数量与击杀数量
   */
  sweepSector(params: SectorSweepParams): { hits: number; kills: number } {
    const radiusSq = params.range * params.range;
    const halfAngle = (params.sectorAngle * Math.PI) / 360;
    const cosHalf = Math.cos(halfAngle);
    const axisX = Math.cos(params.facing);
    const axisY = Math.sin(params.facing);

    let hits = 0;
    let kills = 0;

    for (const monster of params.monsters) {
      if (!monster.alive) continue;

      const dx = monster.sprite.x - params.x;
      const dy = monster.sprite.y - params.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;

      // 点积判夹角：只用一次开方，避免 atan2
      const len = Math.sqrt(distSq);
      if (len < 0.001) continue;
      const dot = (dx / len) * axisX + (dy / len) * axisY;
      if (dot < cosHalf) continue;

      // 击退沿「施法点 → 小怪」的方向，横扫时自然形成向外的推力
      const result = this.applyHit({
        monster,
        damage: params.damage,
        comboMultiplier: params.comboMultiplier,
        dirX: dx / len,
        dirY: dy / len,
        knockback: params.knockback,
      });
      hits++;
      if (result.killed) kills++;
    }

    return { hits, kills };
  }

  /**
   * 单次命中结算：一次走完「击退 → 扣血 → 伤害飘字 → 击杀判定 → 击杀特效 → 连击登记」。
   *
   * 击退必须在扣血之前：致死时生成器会把这只小怪转入「尸体飞散」，
   * 只有提前设好速度，才能让它带着 killKnockbackMultiplier 的强化力道飞出去。
   */
  applyHit(params: HitParams): HitResult {
    const monster = params.monster;
    if (!monster.alive) return { amount: 0, killed: false };

    const amount = params.damage * params.comboMultiplier;
    const lethal = monster.hp - amount <= 0;
    const strength = params.knockback * (lethal ? this.opts.killKnockbackMultiplier : 1);

    this.hooks.knockback(monster, params.dirX, params.dirY, strength);

    // 先取位置：死后小怪会被回收或转入尸体列表，坐标可能马上被改写
    const x = monster.sprite.x;
    const y = monster.sprite.y;

    const killed = this.hooks.applyDamage(monster, amount);

    if (killed) {
      this.hooks.onKill(monster, x, y, params.dirX, params.dirY);
      this.hooks.registerKill();
    } else {
      this.hooks.showDamage(monster, amount);
    }

    return { amount, killed };
  }

  /** 重置帧计数（关卡结束 / 场景重启） */
  reset(): void {
    this.frameCounter = 0;
  }

  /** 兼容旧调用：本系统已无持续区域可销毁，仅做状态复位 */
  destroy(): void {
    this.reset();
  }
}

/**
 * 供外部复用的范围检测工具：判断某点是否落在指定圆内。
 * 与战斗系统保持同一套「距离平方」实现，避免口径分裂。
 */
export function isInsideCircle(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  return distanceSquared(px, py, cx, cy) <= radius * radius;
}
