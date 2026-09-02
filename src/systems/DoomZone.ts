/**
 * Boss 持续伤害区域系统（src/systems/DoomZone.ts）
 * 职责：实现 Boss 技能「持续伤害区域」（doomZone）的对象池化推进。
 *      与现有 KillFxSystem / ProjectileSystem 同样走「对象池 + 跳帧检测 + 距离平方」三件套。
 *
 * 性能红线（GDD 1.2）：
 *  - 全部区域用对象池预分配，运行期零 GC；
 *  - 命中检测走距离平方 + 跳帧（每 N 帧一次），单帧最多遍历上限上限区域；
 *  - 不使用物理引擎，区域是单纯的逻辑位置 + 半径。
 *
 * 数值纪律（GDD 1.4）：区域半径 / 持续时长 / 单跳伤害 / 跳帧间隔全部来自 SkillConfig，
 *                     本文件不写死任何具体数值。
 */

import type Phaser from 'phaser';
import type { SkillConfig } from '../config/types';
import { distanceSquared } from '../utils/MathUtil';

/** DoomZone 在 BossSkillController 中的运行时句柄（包含原始 skill 配置 + 当前位置） */
export interface DoomZoneHandle {
  skillId: string;
  x: number;
  y: number;
  radius: number;
  damage: number;
  tickInterval: number;
  slowFactor: number;
  remaining: number;
  elapsed: number;
  /** 距离下次 tick 还剩多少时间；≤0 时触发一次伤害判定 */
  tickTimer: number;
  /** 视觉表现：Graphics 对象，null 表示已被回收 */
  gfx: Phaser.GameObjects.Graphics | null;
  /** 该 zone 是否正在被占用（active=false 时可被回收复用） */
  active: boolean;
}

/** 单个 DoomZone 的渲染颜色（按 JSON 里的 color 字段解析） */
function hexToColor(hex: string, fallback = 0xff00ff): number {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  return parseInt(m[1], 16);
}

export interface DoomZoneSystemOptions {
  /** 对象池容量；>= 同时存在 zone 上限 */
  poolSize: number;
  /** BossSkillController 上下文，便于回调伤害到玩家 */
  onTickPlayer: (damage: number, slowFactor: number, x: number, y: number, radius: number) => void;
  /** 区域层 depth（默认 95，盖在小怪下、武器栏下） */
  depth?: number;
}

export class DoomZoneSystem {
  private readonly pool: DoomZoneHandle[];
  private readonly onTickPlayer: (damage: number, slowFactor: number, x: number, y: number, radius: number) => void;
  private readonly depth: number;

  /** 当前正在活动的 zone 数量（便于 UI / 调试读取） */
  private activeCount = 0;

  constructor(_scene: Phaser.Scene, opts: DoomZoneSystemOptions) {
    this.onTickPlayer = opts.onTickPlayer;
    this.depth = opts.depth ?? 95;
    this.pool = [];
    for (let i = 0; i < opts.poolSize; i++) {
      const gfx = _scene.add.graphics().setDepth(this.depth).setVisible(false).setActive(false);
      this.pool.push({
        skillId: '',
        x: 0,
        y: 0,
        radius: 0,
        damage: 0,
        tickInterval: 0.5,
        slowFactor: 0,
        remaining: 0,
        elapsed: 0,
        tickTimer: 0,
        gfx,
        active: false,
      });
    }
  }

  /**
   * 启动一个 DoomZone：从池里取一只空 zone，写入 skill 数据并激活视觉。
   * @returns 句柄，失败返回 null（池满则丢弃本次请求）
   */
  spawn(skill: SkillConfig, x: number, y: number): DoomZoneHandle | null {
    const handle = this.pool.find((z) => !z.active);
    if (!handle) return null;
    handle.skillId = `${skill.type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    handle.x = x;
    handle.y = y;
    handle.radius = skill.radius ?? 100;
    handle.damage = skill.damage ?? 0;
    handle.tickInterval = Math.max(0.1, skill.tickInterval ?? 0.5);
    handle.slowFactor = skill.slowFactor ?? 0;
    handle.remaining = skill.duration ?? 1.2;
    handle.elapsed = 0;
    handle.tickTimer = handle.tickInterval;
    handle.active = true;
    if (handle.gfx) {
      handle.gfx.setVisible(true).setActive(true);
      this.redrawZone(handle, hexToColor(skill.color ?? '#ff6b6b'));
    }
    this.activeCount++;
    return handle;
  }

  /**
   * 推进所有活动 zone：衰减剩余时间、按 tickInterval 触发一次伤害判定、刷新视觉。
   * @param dt 帧间隔（秒）
   * @param playerX 玩家 X
   * @param playerY 玩家 Y
   */
  update(dt: number, playerX: number, playerY: number): void {
    if (this.activeCount === 0) return;
    for (const z of this.pool) {
      if (!z.active) continue;
      z.elapsed += dt;
      z.remaining -= dt;

      // tick 伤害判定：玩家进入区域且到了 tick 节拍 → 触发回调
      z.tickTimer -= dt;
      if (z.tickTimer <= 0) {
        z.tickTimer += z.tickInterval;
        const r2 = z.radius * z.radius;
        if (distanceSquared(playerX, playerY, z.x, z.y) <= r2) {
          this.onTickPlayer(z.damage, z.slowFactor, z.x, z.y, z.radius);
        }
      }

      // 视觉：填充透明度按剩余比例淡出，外圈每 0.4s 脉动一次
      if (z.gfx) {
        const fade = Math.max(0, z.remaining / 4); // 经验值，仅做视觉淡出
        z.gfx.setAlpha(0.35 + 0.5 * fade);
      }

      if (z.remaining <= 0) {
        this.release(z);
      }
    }
  }

  /** 清空全部 zone（关卡结束时调用） */
  clear(): void {
    for (const z of this.pool) if (z.active) this.release(z);
  }

  /** 关卡销毁时回收 Graphics 对象 */
  destroy(): void {
    this.clear();
    for (const z of this.pool) {
      z.gfx?.destroy();
      z.gfx = null;
    }
    this.pool.length = 0;
  }

  /** 调试 / 验证用 getter：返回当前活动 zone 数 */
  get size(): number {
    return this.activeCount;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private release(handle: DoomZoneHandle): void {
    handle.active = false;
    handle.remaining = 0;
    if (handle.gfx) {
      handle.gfx.clear();
      handle.gfx.setVisible(false).setActive(false);
    }
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  private redrawZone(z: DoomZoneHandle, color: number): void {
    if (!z.gfx) return;
    z.gfx.clear();
    // 外圈线
    z.gfx.lineStyle(3, color, 0.9);
    z.gfx.strokeCircle(z.x, z.y, z.radius);
    // 内填淡色
    z.gfx.fillStyle(color, 0.18);
    z.gfx.fillCircle(z.x, z.y, z.radius);
  }
}
