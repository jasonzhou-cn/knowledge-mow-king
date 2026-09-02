/**
 * Boss 技能统一调度器（src/systems/BossSkillController.ts）
 * 职责：在 Boss 生命周期内按 JSON 配置的 skillList 触发技能，每个技能有自己的冷却与实现。
 *      阶段切换由外部驱动（MonsterSpawner 在 bossHp/maxHp 跨过阈值时回调 onPhaseChange），
 *      控制器收到回调后切换技能列表并重置所有冷却。
 *
 * 实现原则（GDD 1.4 数据代码解耦红线）：
 *  - 技能类型 dispatch 在 JSON 里（skill.type）；
 *  - 技能数值（冷却 / 半径 / 伤害 / 弹速等）全部来自 SkillConfig；
 *  - 本文件不实现任何成长公式，不引入新硬编码。
 *
 * 性能红线（GDD 1.2）：
 *  - 所有技能调用按 Boss 单实例调度，O(1) 每帧；
 *  - doomZone 走 DoomZoneSystem 的对象池；
 *  - 远程弹丸复用 ProjectileSystem 的弹丸池；
 *  - 召唤小怪复用 MonsterSpawner 的小怪池（isBoss=false 槽位）。
 */

import Phaser from 'phaser';
import type { BossTemplate, SkillConfig } from '../config/types';
import { DoomZoneSystem } from './DoomZone';
import type { ProjectileSystem } from './ProjectileSystem';
import type { MonsterSpawner } from './MonsterSpawner';

/** 单个技能的运行时状态：独立冷却计时器 */
interface SkillRuntime {
  skillId: string;
  config: SkillConfig;
  cooldownRemaining: number;
  /** dashBarrage 用：当前 dash 已累计次数 */
  dashIndex: number;
  /** dashBarrage 用：单次冲刺剩余时间 */
  dashRemaining: number;
  /** dashBarrage 用：单次冲刺间隔计时 */
  dashGapRemaining: number;
}

/** 给场景注入的回调：阶段切换 → 沙雕过场文案显示钩子 */
export interface BossSkillHooks {
  /** 阶段切换通知（仅在阶段真的切换时触发） */
  onPhaseChange?: (newPhaseIndex: number) => void;
  /** 召唤小怪：MonsterSpawner 复用普通小怪池，但走 Boss 数值 */
  summonMinion?: (hp: number, damage: number, speed: number, radius: number, score: number) => void;
}

export interface BossSkillControllerOptions {
  scene: Phaser.Scene;
  boss: BossTemplate;
  /** Boss 精灵（远程技能需要它当前坐标） */
  bossSprite: Phaser.GameObjects.Image;
  /** 玩家坐标查询函数（每帧调用，避免控制器缓存过期） */
  getPlayerPosition: () => { x: number; y: number };
  /** 远程弹丸发射（复用 ProjectileSystem.fire） */
  projectileSystem: ProjectileSystem;
  /** 小怪生成器（用于 summon 技能） */
  monsterSpawner: MonsterSpawner;
  /** 持续伤害区域系统（用于 doomZone 技能） */
  doomZoneSystem: DoomZoneSystem;
  /** DoomZone 对玩家的伤害回调：上层（GrassCuttingScene）实现无敌帧/扣血 */
  onDoomZoneHit: (damage: number) => void;
  hooks?: BossSkillHooks;
}

/**
 * 技能调度控制器（每个 Boss 实例一份）。
 * 调用方式：start() 进入战斗，update(dt) 每帧推进，stop() 关卡结束。
 */
export class BossSkillController {
  private readonly scene: Phaser.Scene;
  private readonly boss: BossTemplate;
  private readonly bossSprite: Phaser.GameObjects.Image;
  private readonly getPlayerPosition: () => { x: number; y: number };
  private readonly projectileSystem: ProjectileSystem;
  /** 小怪生成器引用（保留给未来的召唤逻辑；当前 summon 走 hooks.summonMinion） */
  private readonly monsterSpawner: MonsterSpawner;
  private readonly doomZoneSystem: DoomZoneSystem;
  private readonly onDoomZoneHit: (damage: number) => void;
  private readonly hooks: BossSkillHooks;

  /** 当前激活的技能列表（每阶段重置） */
  private activeSkills: SkillRuntime[] = [];
  /** 当前阶段序号 */
  private currentPhaseIndex = 0;
  /** 是否在跑（start() 后 true，stop() 后 false） */
  private running = false;

  constructor(opts: BossSkillControllerOptions) {
    this.scene = opts.scene;
    this.boss = opts.boss;
    this.bossSprite = opts.bossSprite;
    this.getPlayerPosition = opts.getPlayerPosition;
    this.projectileSystem = opts.projectileSystem;
    this.monsterSpawner = opts.monsterSpawner;
    this.doomZoneSystem = opts.doomZoneSystem;
    this.onDoomZoneHit = opts.onDoomZoneHit;
    this.hooks = opts.hooks ?? {};
    // monsterSpawner 当前只在类型签名上保留引用（后续召唤技能会扩展）
    void this.monsterSpawner;
  }

  /** 进入战斗：初始化为第 0 阶段，激活初始技能列表 */
  start(): void {
    this.running = true;
    this.currentPhaseIndex = 0;
    this.activeSkills = this.buildPhaseSkills(0);
  }

  /** 关卡结束：停止调度，技能不清理（关卡销毁时一起回收） */
  stop(): void {
    this.running = false;
  }

  /** 当前阶段序号（调试 / 验证用） */
  get phaseIndex(): number {
    return this.currentPhaseIndex;
  }

  /** 阶段切换入口（MonsterSpawner 在 hp 跨过阈值时调用）。
   *  内部做幂等：phaseIndex 没变就直接返回。 */
  switchPhase(newPhaseIndex: number): void {
    if (!this.running) return;
    if (newPhaseIndex === this.currentPhaseIndex) return;
    if (newPhaseIndex < 0 || newPhaseIndex >= this.boss.phases.length) return;
    this.currentPhaseIndex = newPhaseIndex;
    this.activeSkills = this.buildPhaseSkills(newPhaseIndex);
    if (this.hooks.onPhaseChange) {
      try { this.hooks.onPhaseChange(newPhaseIndex); } catch { /* 忽略回调异常，避免影响战斗 */ }
    }
  }

  /** 每帧推进：扣减冷却 + 触发就绪技能 */
  update(dt: number): void {
    if (!this.running || this.activeSkills.length === 0) return;
    for (const skill of this.activeSkills) {
      skill.cooldownRemaining -= dt;
      // dashBarrage 状态机：先走 dash，dash 之间走 gap
      if (skill.config.type === 'dashBarrage' && skill.dashIndex > 0) {
        if (skill.dashRemaining > 0) {
          skill.dashRemaining -= dt;
          this.tickDashBarrage(skill);
          continue;
        }
        if (skill.dashGapRemaining > 0) {
          skill.dashGapRemaining -= dt;
          if (skill.dashGapRemaining <= 0) this.startNextDash(skill);
          continue;
        }
      }
      if (skill.cooldownRemaining > 0) continue;
      this.fireSkill(skill);
      skill.cooldownRemaining = skill.config.cooldown;
    }
  }

  /** 关卡销毁时复位全部技能状态（场景 shutdown 走这里） */
  destroy(): void {
    this.activeSkills = [];
    this.running = false;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 按 phaseIndex 构建本阶段激活的技能运行时列表 */
  private buildPhaseSkills(phaseIndex: number): SkillRuntime[] {
    const phase = this.boss.phases[phaseIndex];
    if (!phase) return [];
    return phase.skills
      .map((skillId) => this.boss.skills[skillId])
      .filter((s): s is SkillConfig => Boolean(s))
      .map((config) => ({
        skillId: `${this.boss.id}_${phase.phaseIndex}_${config.type}_${Math.random().toString(36).slice(2, 5)}`,
        config,
        cooldownRemaining: Math.random() * 0.5, // 入场随机错开冷却，避免首帧齐发
        dashIndex: 0,
        dashRemaining: 0,
        dashGapRemaining: 0,
      }));
  }

  /** 触发一次技能：根据 type 分发到具体实现 */
  private fireSkill(runtime: SkillRuntime): void {
    const cfg = runtime.config;
    switch (cfg.type) {
      case 'ranged':
        this.fireRanged(cfg);
        break;
      case 'slam':
        this.fireSlam(cfg);
        break;
      case 'summon':
        this.fireSummon(cfg);
        break;
      case 'charge':
        this.fireCharge(cfg);
        break;
      case 'doomZone':
        this.fireDoomZone(cfg);
        break;
      case 'dashBarrage':
        this.beginDashBarrage(runtime);
        break;
      default: {
        // 未知 type：兜底空动作；不会触发任何效果，行为等同冷却照常扣减
        const _exhaustive: never = cfg.type;
        void _exhaustive;
      }
    }
  }

  /** 远程弹丸：单发 / 多发撒射均复用 projectiles.fire */
  private fireRanged(cfg: SkillConfig): void {
    const player = this.getPlayerPosition();
    const pellets = Math.max(1, cfg.pelletCount ?? 1);
    const speed = cfg.projectileSpeed ?? 280;
    const damage = cfg.damage ?? 8;
    const range = cfg.range ?? 480;
    const radius = cfg.projectileRadius ?? 10;
    const spreadRad = ((cfg.spread ?? 0) * Math.PI) / 180;
    const baseAngle = Math.atan2(player.y - this.bossSprite.y, player.x - this.bossSprite.x);

    for (let i = 0; i < pellets; i++) {
      const offset =
        pellets > 1
          ? (i / (pellets - 1) - 0.5) * spreadRad
          : Phaser.Math.FloatBetween(-spreadRad, spreadRad) * 0.5;
      this.projectileSystem.fire({
        x: this.bossSprite.x,
        y: this.bossSprite.y,
        angle: baseAngle + offset,
        speed,
        damage,
        pierce: 0,
        knockback: 220,
        range,
        radius,
        texture: 'fx-bolt',
        tint: this.parseColor(cfg.color),
        weaponId: `boss_${this.boss.id}`,
      });
    }
  }

  /** AOE 震屏：以 Boss 为圆心画一个大圈作为视觉提示（持续 0.4 秒），对圈内玩家造成一次伤害 */
  private fireSlam(cfg: SkillConfig): void {
    const radius = cfg.radius ?? 140;
    const damage = cfg.damage ?? 12;
    const player = this.getPlayerPosition();
    const dx = player.x - this.bossSprite.x;
    const dy = player.y - this.bossSprite.y;
    const r2 = radius * radius;
    if (dx * dx + dy * dy <= r2) {
      this.onDoomZoneHit(damage);
    }
    // 视觉：程序化生成一个 Graphics 圆圈 + 缩放淡出
    const g = this.scene.add.graphics().setDepth(120);
    const color = this.parseColor(cfg.color);
    g.lineStyle(4, color, 0.9);
    g.strokeCircle(this.bossSprite.x, this.bossSprite.y, radius);
    g.fillStyle(color, 0.18);
    g.fillCircle(this.bossSprite.x, this.bossSprite.y, radius);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: (cfg.duration ?? 0.4) * 1000,
      onComplete: () => g.destroy(),
    });
  }

  /** 召唤小怪：往 Boss 四周甩出 count 个普通小怪，HP/Damage 按 phase.damageMult × 配置 */
  private fireSummon(cfg: SkillConfig): void {
    if (!this.hooks.summonMinion) return;
    const phase = this.boss.phases[this.currentPhaseIndex];
    const count = cfg.count ?? 2;
    const hp = this.boss.hp * (cfg.hpMultiplier ?? 0.3) * phase.damageMult;
    const damage = this.boss.damage * phase.damageMult * 0.4;
    const speed = cfg.speed ?? 100;
    const radius = cfg.radius ?? 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = this.bossSprite.x + Math.cos(angle) * 80;
      const y = this.bossSprite.y + Math.sin(angle) * 80;
      this.hooks.summonMinion(hp, damage, speed, radius, 5);
      void x; void y; // x/y 预留，当前实现由 MonsterSpawner 决定生成位置
    }
  }

  /** 直线冲刺：朝玩家方向瞬移一段（按 dashDuration × speed 计算位移） */
  private fireCharge(cfg: SkillConfig): void {
    const player = this.getPlayerPosition();
    const dx = player.x - this.bossSprite.x;
    const dy = player.y - this.bossSprite.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = (cfg.speed ?? 320) * (cfg.duration ?? 0.5);
    this.bossSprite.x += (dx / len) * step;
    this.bossSprite.y += (dy / len) * step;
  }

  /** 持续伤害区域：以 Boss 当前坐标落一个 zone（DoomZoneSystem 自管） */
  private fireDoomZone(cfg: SkillConfig): void {
    this.doomZoneSystem.spawn(cfg, this.bossSprite.x, this.bossSprite.y);
  }

  /** dashBarrage：进入「多次冲刺」状态机 */
  private beginDashBarrage(runtime: SkillRuntime): void {
    runtime.dashIndex = 1;
    this.startNextDash(runtime);
  }

  private startNextDash(runtime: SkillRuntime): void {
    const cfg = runtime.config;
    const totalDashes = cfg.dashes ?? 3;
    if (runtime.dashIndex > totalDashes) {
      // 全部冲刺完成，回到冷却
      runtime.dashIndex = 0;
      runtime.dashRemaining = 0;
      runtime.dashGapRemaining = 0;
      return;
    }
    runtime.dashRemaining = cfg.dashDuration ?? 0.45;
    runtime.dashGapRemaining = 0;
  }

  private tickDashBarrage(runtime: SkillRuntime): void {
    const cfg = runtime.config;
    const dashDuration = cfg.dashDuration ?? 0.45;
    const dashGap = cfg.dashGap ?? 0.5;
    const player = this.getPlayerPosition();
    const dx = player.x - this.bossSprite.x;
    const dy = player.y - this.bossSprite.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = (cfg.dashSpeed ?? 320) * dashDuration;
    this.bossSprite.x += (dx / len) * step;
    this.bossSprite.y += (dy / len) * step;

    if (runtime.dashRemaining <= 0) {
      // 一次 dash 结束，进入 gap 等待
      runtime.dashGapRemaining = dashGap;
      runtime.dashIndex += 1;
    }
  }

  /** 颜色解析（与 DoomZone 一致：失败回落到粉色） */
  private parseColor(hex: string | undefined): number {
    if (typeof hex !== 'string') return 0xff00ff;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return 0xff00ff;
    return parseInt(m[1], 16);
  }
}
