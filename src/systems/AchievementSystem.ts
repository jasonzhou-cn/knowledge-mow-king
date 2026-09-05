/**
 * 成就系统（src/systems/AchievementSystem.ts）
 * 职责：按 achievementConfig.json 的条件清单，对本地统计（累计击杀/通关数/最高连击…）
 *      做达成判定，解锁结果写入 ProgressionSystem 存档（localStorage，纯本地）。
 *
 * 范围说明：排行榜与图鉴同样读 progression 的本地 meta——
 * 「关卡最佳得分」= 本地排行榜，「Boss 图鉴」= bossesDefeated 集合；
 * 接云后这套接口可直接换成云端读写，调用方不变。
 *
 * 调用约定：
 *  - 割草场景每帧事件只 bump 内存统计（不落盘，避免高频写 localStorage）；
 *  - 结算场景 notifyRoundResult() 时统一 checkAll + save，并拿「本次新解锁」做 toast。
 */

import type { AchievementConfig, AchievementEntry } from '../config/types';
import { progression, type MetaSave } from './ProgressionSystem';

export interface RoundResultSummary {
  cleared: boolean;
  noDamage: boolean;
  /** 本轮答题正确率 0~1 */
  accuracy: number;
  /** 是否全对（totalQuestions > 0） */
  perfect: boolean;
  /** 本局最高连击 */
  maxCombo: number;
}

class AchievementSystem {
  private config: AchievementConfig | null = null;

  /** 绑定成就配置（BootScene 在配置校验通过后调用） */
  bind(config: AchievementConfig): void {
    this.config = config;
  }

  /** 成就总数（UI 展示用；未 bind 时 0） */
  get total(): number {
    return this.config?.achievements.length ?? 0;
  }

  /** 已解锁成就 id 列表（只读副本） */
  get unlockedIds(): string[] {
    return [...progression.meta.achievements];
  }

  /** 全部成就定义（只读副本） */
  get all(): AchievementEntry[] {
    return [...(this.config?.achievements ?? [])];
  }

  /**
   * 回合（一关）结束：把结算侧统计写入 meta 并做一次全量达成判定。
   * @returns 本次新解锁的成就（供结算 toast 展示）
   */
  notifyRoundResult(r: RoundResultSummary): AchievementEntry[] {
    const meta = progression.meta;
    meta.totals.bestCombo = Math.max(meta.totals.bestCombo, r.maxCombo);
    meta.totals.bestAccuracy = Math.max(meta.totals.bestAccuracy, r.accuracy);
    if (r.perfect) meta.totals.perfectRounds++;
    if (r.cleared && r.noDamage) meta.totals.noDamageClears++;
    return this.checkAll();
  }

  /** 累计击杀 +1（割草场景高频调用：只动内存，随结算统一落盘） */
  notifyKill(): void {
    progression.meta.totals.kills++;
  }

  /** 拾取 BUFF：kind = scholar | lazy（次数低频，直接判定 + 需要时落盘） */
  notifyBuffPickup(kind: 'scholar' | 'lazy'): AchievementEntry[] {
    if (kind === 'scholar') progression.meta.totals.scholarPickups++;
    else progression.meta.totals.lazyPickups++;
    return this.checkAll();
  }

  /** 击败 Boss：记入图鉴并判定（低频，直接判定 + 需要时落盘） */
  notifyBossDefeat(bossId: string): AchievementEntry[] {
    const meta = progression.meta;
    if (!meta.bossesDefeated.includes(bossId)) meta.bossesDefeated.push(bossId);
    meta.totals.bossKills++;
    return this.checkAll();
  }

  /** 关卡最佳得分（本地排行榜）：更高才写入并落盘 */
  recordLevelScore(level: number, score: number): void {
    const key = String(level);
    const meta = progression.meta;
    if (score > (meta.bestScores[key] ?? 0)) {
      meta.bestScores[key] = score;
      progression.save();
    }
  }

  /**
   * 全量达成判定：对每个未解锁成就按条件类型求值，全部达成的立即解锁。
   * @returns 本次新解锁的成就；无新增则返回空数组
   */
  checkAll(): AchievementEntry[] {
    if (!this.config) return [];
    const meta = progression.meta;
    const newly: AchievementEntry[] = [];

    for (const entry of this.config.achievements) {
      if (meta.achievements.includes(entry.id)) continue;
      if (!this.matches(entry, meta)) continue;
      if (progression.unlockAchievement(entry.id)) {
        newly.push(entry);
      }
    }
    return newly;
  }

  /** 单条成就条件求值 */
  private matches(entry: AchievementEntry, meta: MetaSave): boolean {
    const { type, value } = entry.condition;
    const t = meta.totals;
    switch (type) {
      case 'clears':
        return t.clears >= value;
      case 'level_reach':
        return progression.unlockedLevel >= value;
      case 'perfect_rounds':
        return t.perfectRounds >= value;
      case 'accuracy':
        return t.bestAccuracy >= value;
      case 'combo':
        return t.bestCombo >= value;
      case 'kills_total':
        return t.kills >= value;
      case 'no_damage_clear':
        return t.noDamageClears >= value;
      case 'boss_kills':
        return t.bossKills >= value;
      case 'scholar_pickups':
        return t.scholarPickups >= value;
      case 'lazy_pickups':
        return t.lazyPickups >= value;
      case 'score_total':
        return progression.totalScore >= value;
      default:
        return false;
    }
  }
}

/** 全局成就单例 */
export const achievements = new AchievementSystem();
