/**
 * 成长与存档系统（src/systems/ProgressionSystem.ts）
 * 职责：管理玩家等级、经验、累计得分、关卡解锁进度，并通过 localStorage 做本地存档。
 * 范围说明：MVP 明确不做云存档（用户已拍板），仅本地持久化；云同步接口以 TODO 形式预留。
 *
 * 奖励可控原则（GDD 1.3）：本系统同时维护「当日累计奖励时间」，
 *      任何奖励写入前都必须先经过每日上限钳制，避免玩家刷满无限游戏时间。
 */

import { resolveExpToNextLevel } from '../config/resolve';
import type { GameSettings } from '../config/types';

/** 存档结构版本，结构变更时递增以便做兼容迁移 */
const SAVE_VERSION = 2;
const STORAGE_KEY = 'knowledge-mow-king.save.v1';

/** 当日奖励记录：日期变化时自动归零 */
export interface DailyRewardRecord {
  /** YYYY-MM-DD */
  date: string;
  /** 当日已发放的奖励时间（秒） */
  rewardTime: number;
}

/** 成就/图鉴/关卡记录共用的本地统计（AchievementSystem 读写） */
export interface MetaTotals {
  kills: number;
  clears: number;
  bossKills: number;
  perfectRounds: number;
  noDamageClears: number;
  scholarPickups: number;
  lazyPickups: number;
  bestCombo: number;
  bestAccuracy: number;
}

/** 存档 v2 新增的元数据块：成就 + Boss 图鉴 + 每关最佳得分（本地排行榜） */
export interface MetaSave {
  achievements: string[];
  bossesDefeated: string[];
  /** key = 关卡号字符串 */
  bestScores: Record<string, number>;
  totals: MetaTotals;
}

/** 存档数据 */
export interface ProgressSave {
  version: number;
  level: number;
  exp: number;
  totalScore: number;
  unlockedLevel: number;
  daily: DailyRewardRecord;
  meta: MetaSave;
  updatedAt: number;
}

/** 升级事件 */
export interface LevelUpEvent {
  from: number;
  to: number;
  levelsGained: number;
}

/** 取当天日期字符串（本地时区） */
function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class ProgressionSystem {
  private settings: GameSettings | null = null;
  private data: ProgressSave = ProgressionSystem.createDefault();

  /** 绑定全局配置（等级上限与成长曲线来自 gameSettings） */
  bind(gameSettings: GameSettings): void {
    this.settings = gameSettings;
  }

  /** 从 localStorage 读取存档；无存档或损坏时回退到默认值（v1 存档自动迁移：进度保留、meta 清空） */
  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.data = ProgressionSystem.createDefault();
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ProgressSave>;
      if (parsed.version !== SAVE_VERSION) {
        if (parsed.version === 1) {
          // v1 → v2 迁移：老玩家的等级/经验/得分/解锁全部保留，成就与记录从零开始
          this.data = {
            ...ProgressionSystem.createDefault(),
            level: Math.max(1, Math.floor(parsed.level ?? 1)),
            exp: Math.max(0, parsed.exp ?? 0),
            totalScore: Math.max(0, parsed.totalScore ?? 0),
            unlockedLevel: Math.max(1, Math.floor(parsed.unlockedLevel ?? 1)),
            daily: this.normalizeDaily(parsed.daily),
          };
          this.save();
          return;
        }
        this.data = ProgressionSystem.createDefault();
        return;
      }
      this.data = {
        version: SAVE_VERSION,
        level: Math.max(1, Math.floor(parsed.level ?? 1)),
        exp: Math.max(0, parsed.exp ?? 0),
        totalScore: Math.max(0, parsed.totalScore ?? 0),
        unlockedLevel: Math.max(1, Math.floor(parsed.unlockedLevel ?? 1)),
        daily: this.normalizeDaily(parsed.daily),
        meta: this.normalizeMeta(parsed.meta),
        updatedAt: parsed.updatedAt ?? Date.now(),
      };
    } catch {
      // 存档损坏时静默回退，绝不让存档问题阻断游戏启动
      this.data = ProgressionSystem.createDefault();
    }
  }

  /** 写入 localStorage */
  save(): void {
    try {
      this.data.updatedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // 隐私模式或配额不足时忽略，游戏仍可继续
    }
  }

  get level(): number {
    return this.data.level;
  }

  get exp(): number {
    return this.data.exp;
  }

  get totalScore(): number {
    return this.data.totalScore;
  }

  /** 已解锁的最高关卡号 */
  get unlockedLevel(): number {
    return this.data.unlockedLevel;
  }

  /** 成就/图鉴/记录元数据（AchievementSystem 与面板读写的唯一入口） */
  get meta(): MetaSave {
    return this.data.meta;
  }

  /** 解锁一个成就；已解锁返回 false（幂等） */
  unlockAchievement(id: string): boolean {
    if (this.data.meta.achievements.includes(id)) return false;
    this.data.meta.achievements.push(id);
    this.save();
    return true;
  }

  /** 升到下一级所需经验；已满级返回 Infinity */
  get expToNextLevel(): number {
    if (!this.settings) return 100;
    return resolveExpToNextLevel(this.settings, this.data.level);
  }

  /** 当前等级进度 0~1（满级为 1） */
  get levelProgress(): number {
    const need = this.expToNextLevel;
    if (!Number.isFinite(need)) return 1;
    return Math.max(0, Math.min(1, this.data.exp / need));
  }

  /**
   * 增加经验并处理升级。
   * @returns 升级事件；未升级返回 null
   */
  addExp(amount: number): LevelUpEvent | null {
    if (amount <= 0) return null;
    if (!this.settings) return null;

    const from = this.data.level;
    this.data.exp += amount;

    let guard = 0;
    const maxLevel = this.settings.levelSettings.maxLevel;
    while (this.data.level < maxLevel && guard < 1000) {
      const need = resolveExpToNextLevel(this.settings, this.data.level);
      if (this.data.exp < need) break;
      this.data.exp -= need;
      this.data.level++;
      guard++;
    }

    if (this.data.level > from) {
      this.save();
      return { from, to: this.data.level, levelsGained: this.data.level - from };
    }
    return null;
  }

  /** 累加总得分 */
  addScore(amount: number): void {
    if (amount <= 0) return;
    this.data.totalScore += amount;
  }

  /** 解锁到指定关卡（只增不减） */
  unlockLevel(level: number): void {
    if (level > this.data.unlockedLevel) {
      this.data.unlockedLevel = level;
      this.save();
    }
  }

  /** 当日已发放的奖励时间（秒） */
  get dailyRewardTime(): number {
    this.rollDailyIfNeeded();
    return this.data.daily.rewardTime;
  }

  /**
   * 写入一笔当日奖励时间。
   * @param seconds 期望发放的秒数
   * @param dailyLimit 每日上限
   * @returns 实际发放的秒数（已被每日上限钳制）
   */
  addDailyRewardTime(seconds: number, dailyLimit: number): number {
    this.rollDailyIfNeeded();
    const remaining = Math.max(0, dailyLimit - this.data.daily.rewardTime);
    const granted = Math.max(0, Math.min(seconds, remaining));
    this.data.daily.rewardTime += granted;
    this.save();
    return granted;
  }

  /** 当日剩余可发放奖励时间 */
  dailyRewardRemaining(dailyLimit: number): number {
    return Math.max(0, dailyLimit - this.dailyRewardTime);
  }

  /** 清空存档（设置页「重置进度」用） */
  reset(): void {
    this.data = ProgressionSystem.createDefault();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private static createDefault(): ProgressSave {
    return {
      version: SAVE_VERSION,
      level: 1,
      exp: 0,
      totalScore: 0,
      unlockedLevel: 1,
      daily: { date: todayKey(), rewardTime: 0 },
      meta: {
        achievements: [],
        bossesDefeated: [],
        bestScores: {},
        totals: {
          kills: 0,
          clears: 0,
          bossKills: 0,
          perfectRounds: 0,
          noDamageClears: 0,
          scholarPickups: 0,
          lazyPickups: 0,
          bestCombo: 0,
          bestAccuracy: 0,
        },
      },
      updatedAt: Date.now(),
    };
  }

  /** 补全 meta 缺失字段（兼容手改存档 / 老结构片段） */
  private normalizeMeta(meta: Partial<MetaSave> | undefined): MetaSave {
    const base = ProgressionSystem.createDefault().meta;
    if (!meta) return base;
    const t: Partial<MetaTotals> = meta.totals ?? {};
    return {
      achievements: Array.isArray(meta.achievements) ? meta.achievements.filter((s) => typeof s === 'string') : base.achievements,
      bossesDefeated: Array.isArray(meta.bossesDefeated) ? meta.bossesDefeated.filter((s) => typeof s === 'string') : base.bossesDefeated,
      bestScores: meta.bestScores && typeof meta.bestScores === 'object' ? meta.bestScores : base.bestScores,
      totals: {
        kills: Math.max(0, t.kills ?? 0),
        clears: Math.max(0, t.clears ?? 0),
        bossKills: Math.max(0, t.bossKills ?? 0),
        perfectRounds: Math.max(0, t.perfectRounds ?? 0),
        noDamageClears: Math.max(0, t.noDamageClears ?? 0),
        scholarPickups: Math.max(0, t.scholarPickups ?? 0),
        lazyPickups: Math.max(0, t.lazyPickups ?? 0),
        bestCombo: Math.max(0, t.bestCombo ?? 0),
        bestAccuracy: Math.max(0, Math.min(1, t.bestAccuracy ?? 0)),
      },
    };
  }

  /** 日期变更时把当日累计清零 */
  private rollDailyIfNeeded(): void {
    const today = todayKey();
    if (this.data.daily.date !== today) {
      this.data.daily = { date: today, rewardTime: 0 };
    }
  }

  private normalizeDaily(daily: DailyRewardRecord | undefined): DailyRewardRecord {
    const today = todayKey();
    if (!daily || daily.date !== today) return { date: today, rewardTime: 0 };
    return { date: daily.date, rewardTime: Math.max(0, daily.rewardTime) };
  }
}

/**
 * 全局成长系统单例。
 * ES Module 单例，跨场景共享同一份进度，场景重建不会丢档。
 */
export const progression = new ProgressionSystem();
