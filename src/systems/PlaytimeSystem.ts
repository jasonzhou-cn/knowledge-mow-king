/**
 * 防沉迷系统（src/systems/PlaytimeSystem.ts）
 * 职责：记录连续游玩时长，达到配置上限后强制进入休息倒计时（GDD 2.6：
 *      严格游戏时长限制 + 到时间强制下线）。纯前端实现，不依赖云开发。
 *
 * 持久化：localStorage 独立键（与进度存档分离，清进度不清防沉迷记录），
 * 记录「连续游玩起点」与「休息截止时刻」——中途刷新页面不会绕过限制：
 * 刷新后 sessionStart 仍是第一次进入的时间，超时立即回到休息状态。
 *
 * 使用方式：各场景 create() 时调用 shouldRest()，为 true 时展示 RestOverlay
 * （MenuScene 直接展示；Question/Grass 场景先送回 MenuScene 统一处理）。
 * 休息倒计时结束调用 finishRest()，重新开始计一段连续游玩。
 */

import type { PlaytimeSettings } from '../config/types';

const STORAGE_KEY = 'knowledge-mow-king.playtime.v1';

/** 持久化记录 */
interface PlaytimeRecord {
  /** 当前连续游玩段的起点（epoch ms） */
  sessionStart: number;
  /** 强制休息截止时刻（epoch ms）；0 = 不在休息 */
  restUntil: number;
}

class PlaytimeSystem {
  private settings: PlaytimeSettings = { enabled: false, sessionLimitMin: 30, restMin: 10 };
  private record: PlaytimeRecord = { sessionStart: Date.now(), restUntil: 0 };

  /** 绑定配置（BootScene 在配置校验通过后调用，随后 load()） */
  bind(settings: PlaytimeSettings): void {
    this.settings = settings;
  }

  /** 从 localStorage 恢复记录；损坏时静默重置 */
  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PlaytimeRecord>;
      this.record = {
        sessionStart: typeof parsed.sessionStart === 'number' ? parsed.sessionStart : Date.now(),
        restUntil: typeof parsed.restUntil === 'number' ? parsed.restUntil : 0,
      };
    } catch {
      this.record = { sessionStart: Date.now(), restUntil: 0 };
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.record));
    } catch {
      // 隐私模式下忽略，本局仍生效
    }
  }

  /** 是否必须休息（达到连续上限，或仍在强制休息倒计时内） */
  get shouldRest(): boolean {
    if (!this.settings.enabled) return false;
    if (this.record.restUntil > Date.now()) return true;
    return Date.now() - this.record.sessionStart >= this.settings.sessionLimitMin * 60_000;
  }

  /** 休息剩余秒数（不在休息时返回 0） */
  get restRemainingSec(): number {
    return Math.max(0, Math.ceil((this.record.restUntil - Date.now()) / 1000));
  }

  /** 已连续游玩的秒数 */
  get playedSec(): number {
    return Math.max(0, Math.floor((Date.now() - this.record.sessionStart) / 1000));
  }

  /** 连续游玩上限（分钟），UI 展示用 */
  get sessionLimitMin(): number {
    return this.settings.sessionLimitMin;
  }

  /**
   * 进入强制休息：起点重置为现在，休息截止 = 现在 + restMin。
   * 只在 shouldRest 为 true 时由 UI 调用；重复调用会顺延休息（幂等保护：倒计时取较大值）。
   */
  startRest(): void {
    if (!this.settings.enabled) return;
    const until = Date.now() + this.settings.restMin * 60_000;
    this.record.restUntil = Math.max(this.record.restUntil, until);
    this.record.sessionStart = Date.now();
    this.persist();
  }

  /** 休息结束：清掉截止时刻，重新开始一段连续游玩 */
  finishRest(): void {
    this.record.restUntil = 0;
    this.record.sessionStart = Date.now();
    this.persist();
  }
}

/** 全局防沉迷单例 */
export const playtime = new PlaytimeSystem();
