/**
 * 连击系统（src/systems/ComboSystem.ts）
 * 职责：统计割草场景内「连击时间窗」中的连续击杀，并把连击数换算为伤害加成。
 * 设计：在 comboTimeWindow 秒内每击杀一只即累加连击，超时归零；
 *      伤害乘数 = 1 + comboDamageGrowth × (combo - 1)，并钳制在 comboMaxDamageMultiplier 以内（配置驱动）。
 */

import { clamp } from '../utils/MathUtil';

export interface ComboSystemOptions {
  /** 连击窗口（秒） */
  timeWindow: number;
  /** 每级连击提升的伤害比例 */
  damageGrowth: number;
  /** 连击伤害乘数上限 */
  maxDamageMultiplier: number;
}

export class ComboSystem {
  private readonly opts: ComboSystemOptions;
  private count = 0;
  private best = 0;
  private elapsedSinceKill = 0;
  private active = false;

  constructor(opts: ComboSystemOptions) {
    this.opts = opts;
  }

  /** 当前连击数 */
  get current(): number {
    return this.count;
  }

  /** 本局最高连击 */
  get max(): number {
    return this.best;
  }

  /** 连击是否仍在窗口内（用于 UI 高亮） */
  get isActive(): boolean {
    return this.active && this.count >= 2;
  }

  /** 距离连击断掉的剩余时间（秒），未在连击中返回 0 */
  get remainingWindow(): number {
    if (!this.active || this.count < 1) return 0;
    return Math.max(0, this.opts.timeWindow - this.elapsedSinceKill);
  }

  /**
   * 记录一次击杀，返回递增后的连击数。
   */
  registerKill(): number {
    this.count++;
    this.elapsedSinceKill = 0;
    this.active = true;
    if (this.count > this.best) this.best = this.count;
    return this.count;
  }

  /**
   * 推进计时。
   * @param dt 帧间隔（秒）
   * @returns 连击因超时被清零时返回 true，否则 false
   */
  update(dt: number): boolean {
    if (!this.active || this.count <= 0) return false;
    this.elapsedSinceKill += dt;
    if (this.elapsedSinceKill >= this.opts.timeWindow) {
      this.reset();
      return true;
    }
    return false;
  }

  /**
   * 当前连击带来的伤害乘数。
   * 1 连击（即无连击）时为 1，随连击线性提升并受上限保护。
   */
  get damageMultiplier(): number {
    if (this.count <= 1) return 1;
    return clamp(
      1 + this.opts.damageGrowth * (this.count - 1),
      1,
      this.opts.maxDamageMultiplier,
    );
  }

  /** 清空连击（玩家受伤或关卡结束时调用） */
  reset(): void {
    this.count = 0;
    this.elapsedSinceKill = 0;
    this.active = false;
  }
}
