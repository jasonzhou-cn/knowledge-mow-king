/**
 * 武器系统（src/systems/WeaponSystem.ts）
 * 职责：持有三把武器（数值已在 resolve.ts 解析完毕并乘上答题加成），
 *      负责「自动瞄准 + 手动触发」的出手逻辑与按键切换。
 *
 * 交互契约（用户拍板）：
 *  - 瞄准自动：武器自动锁定搜索半径内最近的敌人；没有目标或超出半径时沿用移动朝向；
 *  - 出手手动：只有玩家按下攻击键才触发，系统不自动开火；
 *  - 切换随时：1/2/3 直切、Q/E 循环切，冷却各自独立、互不干扰。
 *
 * 数值纪律（GDD 1.4）：本文件不实现任何成长公式，
 *      伤害 / 冷却 / 射程 / 击退 / 顿帧全部来自 ResolvedWeapon。
 */

import type { AutoAimSettings } from '../config/types';
import type { ResolvedWeapon } from '../config/resolve';
import { distanceSquared } from '../utils/MathUtil';
import type { Monster } from './MonsterSpawner';

const TAU = Math.PI * 2;

/** 一次成功出手的描述，交给场景去落地（近战立即结算 / 远程发射弹丸） */
export interface AttackAction {
  weapon: ResolvedWeapon;
  x: number;
  y: number;
  /** 出手朝向（弧度），已包含自动瞄准的结果 */
  facing: number;
}

export interface WeaponSystemOptions {
  weapons: ResolvedWeapon[];
  autoAim: AutoAimSettings;
}

export class WeaponSystem {
  private readonly weapons: ResolvedWeapon[];
  private readonly autoAim: AutoAimSettings;
  private readonly cooldowns: number[];
  private index = 0;

  constructor(opts: WeaponSystemOptions) {
    this.weapons = opts.weapons.map((w) => ({ ...w }));
    this.autoAim = opts.autoAim;
    this.cooldowns = this.weapons.map(() => 0);
  }

  /** 全部武器（只读引用，供武器栏 UI 展示） */
  get all(): readonly ResolvedWeapon[] {
    return this.weapons;
  }

  /** 当前武器 */
  get current(): ResolvedWeapon {
    return this.weapons[this.index];
  }

  /** 当前武器索引 */
  get currentIndex(): number {
    return this.index;
  }

  /** 武器数量 */
  get count(): number {
    return this.weapons.length;
  }

  /**
   * 当前武器的冷却进度：0 = 刚出手，1 = 可以再次出手。
   * 武器栏用它画冷却条。
   */
  cooldownRatio(index = this.index): number {
    const weapon = this.weapons[index];
    if (!weapon || weapon.cooldown <= 0) return 1;
    const remain = this.cooldowns[index] ?? 0;
    return Math.max(0, Math.min(1, 1 - remain / weapon.cooldown));
  }

  /** 切换到指定索引；越界或重复时返回 false */
  switchTo(index: number): boolean {
    if (index < 0 || index >= this.weapons.length) return false;
    if (index === this.index) return false;
    this.index = index;
    return true;
  }

  /** 循环切到下一把（E 键） */
  nextWeapon(): boolean {
    return this.switchTo((this.index + 1) % this.weapons.length);
  }

  /** 循环切到上一把（Q 键） */
  prevWeapon(): boolean {
    return this.switchTo((this.index - 1 + this.weapons.length) % this.weapons.length);
  }

  /**
   * 自动瞄准：在搜索半径内找最近的存活敌人，把朝向平滑转向它。
   * 找不到目标（或功能关闭、超出半径）时原样返回移动朝向。
   *
   * @param playerX / playerY 角色坐标
   * @param monsters 当前存活小怪
   * @param moveFacing 玩家的移动朝向（无目标时的兜底朝向）
   * @param dt 帧间隔（秒）
   * @returns 本帧武器应指向的弧度
   */
  resolveFacing(
    playerX: number,
    playerY: number,
    monsters: readonly Monster[],
    moveFacing: number,
    dt: number,
  ): number {
    if (!this.autoAim.enabled) return moveFacing;

    const radiusSq = this.autoAim.searchRadius * this.autoAim.searchRadius;
    let best: Monster | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (const monster of monsters) {
      if (!monster.alive) continue;
      const d2 = distanceSquared(playerX, playerY, monster.sprite.x, monster.sprite.y);
      if (d2 > radiusSq || d2 >= bestDistSq) continue;
      bestDistSq = d2;
      best = monster;
    }

    if (!best) return moveFacing;

    const target = Math.atan2(best.sprite.y - playerY, best.sprite.x - playerX);
    const maxTurn = (this.autoAim.aimAssistAngle * Math.PI) / 180; // 度/秒 → 弧度/秒

    // aimAssistAngle 为 0 时立即对齐；否则按最大转向速率平滑逼近，避免朝向瞬移
    if (maxTurn <= 0 || dt <= 0) return target;

    const diff = normalizeAngle(target - moveFacing);
    const step = maxTurn * dt;
    if (Math.abs(diff) <= step) return target;
    return moveFacing + Math.sign(diff) * step;
  }

  /** 推进全部武器冷却 */
  update(dt: number): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i] > 0) {
        this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
      }
    }
  }

  /**
   * 尝试出手。冷却未就绪返回 null。
   * 命中与否不由本系统判断 —— 近战交给 CombatSystem.sweepSector，远程交给 ProjectileSystem。
   */
  tryAttack(x: number, y: number, facing: number): AttackAction | null {
    if (this.cooldowns[this.index] > 0) return null;
    const weapon = this.current;
    this.cooldowns[this.index] = weapon.cooldown;
    return { weapon, x, y, facing };
  }

  /** 关卡结束时重置冷却 */
  reset(): void {
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = 0;
    this.index = 0;
  }
}

/** 把角度差归一到 (-π, π]，避免绕远路转向 */
export function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}
