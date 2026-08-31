/**
 * 奖励计算系统（src/systems/RewardSystem.ts）
 * 职责：把答题与割草表现换算成「奖励游戏时间」，并严格执行单次 / 每日双上限钳制。
 *
 * 奖励可控原则（GDD 1.3）与透明化要求（GDD 2.4）：
 *  - 每一笔奖励都带明确的来源说明，结算界面逐条展示，玩家一眼看懂时间从哪来；
 *  - 先按单次上限钳制总额，再按每日剩余额度钳制，双重保护下不可能刷出无限时间。
 */

import type { QuizResult } from '../config/resolve';
import type { RewardConfig } from '../config/types';

/** 单笔奖励条目：来源 + 秒数，直接用于结算面板展示 */
export interface RewardItem {
  /** 中文来源说明，例如「连对 5 题阶梯奖励」 */
  source: string;
  seconds: number;
}

/** 奖励计算结果 */
export interface RewardCalculation {
  items: RewardItem[];
  /** 钳制前的原始总额 */
  rawTotal: number;
  /** 单次上限钳制后的金额 */
  singleCappedTotal: number;
  /** 最终实际发放金额（再经过每日上限钳制） */
  grantedTotal: number;
  /** 本次发放前的当日累计 */
  dailyUsedBefore: number;
  /** 本次发放后的当日累计 */
  dailyUsedAfter: number;
  dailyLimit: number;
  singleLimit: number;
  /** 是否触发了单次上限 */
  singleCapped: boolean;
  /** 是否触发了每日上限 */
  dailyCapped: boolean;
  /** 达标的最高连对奖励档位；未达标为 null */
  reachedComboTier: number | null;
  /** 下一个连对奖励档位；已满档为 null */
  nextComboTier: number | null;
}

/** 计算奖励所需的表现数据 */
export interface RewardInput {
  /** 答题结果（取最大连对、正确率、平均耗时） */
  quiz: QuizResult;
  /** 本关击杀数 */
  kills: number;
  /** 本关是否全程未受伤 */
  noDamage: boolean;
}

/**
 * 找出达标的最高连对奖励档位。
 * 阶梯式设计：只结算达到的最高档，不做累加，避免高连对玩家收益爆炸。
 */
export function resolveComboTier(
  maxCombo: number,
  comboRewards: RewardConfig['comboRewards'],
): { tier: number | null; seconds: number; next: number | null } {
  let tier: number | null = null;
  let seconds = 0;
  let next: number | null = null;

  // comboRewards 必须按 combo 递增（validator 已保证），直接顺序扫描
  for (const entry of comboRewards) {
    if (maxCombo >= entry.combo) {
      tier = entry.combo;
      seconds = entry.rewardTime;
    } else if (next === null) {
      next = entry.combo;
    }
  }
  return { tier, seconds, next };
}

/**
 * 计算本局奖励。
 * 纯函数：不写任何状态，便于单测与实际发放解耦。
 */
export function calculateRewards(input: RewardInput, config: RewardConfig): RewardCalculation {
  const items: RewardItem[] = [];

  const combo = resolveComboTier(input.quiz.maxCombo, config.comboRewards);
  if (combo.tier !== null && combo.seconds > 0) {
    items.push({ source: `连对 ${combo.tier} 题阶梯奖励`, seconds: combo.seconds });
  }

  const other = config.otherRewards;
  if (input.quiz.totalQuestions > 0 && input.quiz.accuracy >= 1) {
    items.push({ source: '全部答对·完美奖励', seconds: other.perfectAnswerReward });
  }
  if (
    input.quiz.totalQuestions > 0 &&
    input.quiz.averageAnswerTime > 0 &&
    input.quiz.averageAnswerTime <= other.fastAnswerTimeThreshold
  ) {
    items.push({
      source: `极速答题（平均 ${input.quiz.averageAnswerTime.toFixed(1)}s ≤ ${other.fastAnswerTimeThreshold}s）`,
      seconds: other.fastAnswerReward,
    });
  }
  if (input.noDamage) {
    items.push({ source: '全程未受伤·无伤奖励', seconds: other.noDamageReward });
  }

  const rawTotal = items.reduce((sum, item) => sum + item.seconds, 0);

  // 第一重钳制：单次奖励上限
  const singleLimit = config.rewardLimits.singleRewardTimeMax;
  const singleCappedTotal = Math.min(rawTotal, singleLimit);
  const singleCapped = rawTotal > singleLimit;

  return {
    items,
    rawTotal,
    singleCappedTotal,
    grantedTotal: singleCappedTotal,
    dailyUsedBefore: 0,
    dailyUsedAfter: 0,
    dailyLimit: config.rewardLimits.dailyRewardTimeMax,
    singleLimit,
    singleCapped,
    dailyCapped: false,
    reachedComboTier: combo.tier,
    nextComboTier: combo.next,
  };
}

/**
 * 在结算时把「每日上限」也应用上，返回最终发放额并补全统计字段。
 * 需要读写存档，因此与上面的纯计算函数分开。
 */
export function applyDailyCap(
  calculation: RewardCalculation,
  dailyUsedBefore: number,
  dailyLimit: number,
): RewardCalculation {
  const remaining = Math.max(0, dailyLimit - dailyUsedBefore);
  const granted = Math.min(calculation.singleCappedTotal, remaining);
  return {
    ...calculation,
    dailyUsedBefore,
    dailyUsedAfter: dailyUsedBefore + granted,
    dailyLimit,
    grantedTotal: granted,
    dailyCapped: calculation.singleCappedTotal > remaining,
  };
}

/**
 * 计算本局得分。
 * 得分与奖励时间解耦：得分用于长期追求，奖励时间受上限约束。
 */
export function calculateScore(input: RewardInput, config: RewardConfig, maxCombo: number): number {
  const s = config.scoreSettings;
  return Math.round(
    input.kills * s.scorePerKill +
      input.quiz.correctCount * s.scorePerCorrectAnswer +
      maxCombo * s.scoreComboBonusPerCombo,
  );
}

/** 把奖励明细格式化为结算面板可直接展示的多行文本 */
export function formatRewardItems(items: RewardItem[]): string {
  if (items.length === 0) return '暂无奖励，答得更快更准即可获得游戏时间奖励';
  return items.map((item) => `· ${item.source}：+${item.seconds}s`).join('\n');
}
