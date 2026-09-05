/**
 * 动态难度下调（src/systems/DifficultyAssist.ts）
 * 职责：按玩家实时表现计算 assistFactor ∈ [0,1]，并把难度进度向 Start 端回拉。
 *
 * 设计原则（GDD 1.3 软失败保护 / 红线 3）：
 *  - **只降不升**：assist 只会把难度进度乘以 ≤1 的系数，绝不会把难度抬到原曲线之上，
 *    否则会构成「打得好 → 更难」的新正反馈失衡；
 *  - **表现 → 难度单向**：assist 由「答题正确率 + 当前 HP 占比 + 近期掉血速率」加权得出，
 *    全部输入与权重来自配置 assistSettings，本文件不做任何数值决策；
 *  - **平滑过渡**：调用方按 smoothingSec 做指数平滑，避免难度跳变。
 *
 * 本文件保持纯函数（零 Phaser 依赖），便于单元测试直接覆盖插值与加权逻辑。
 */

import { clamp01 } from '../utils/MathUtil';
import type { AssistSettings } from '../config/types';

/** 计算 assist 的一帧表现输入 */
export interface AssistInputs {
  /** 本关答题正确率 0~1（答题已结束，全程恒定） */
  accuracy: number;
  /** 当前 HP 占比 0~1 */
  hpRatio: number;
  /** 近期掉血速率（HP/秒），统计窗口由 settings.lossWindowSec 决定 */
  recentLossPerSec: number;
}

/**
 * 计算 assist 目标值 ∈ [0,1]：表现越好越接近 1（难度保持原曲线），
 * 表现越差越接近 0（难度向 Start 端回拉到 pullMin 档）。
 */
export function computeAssistTarget(inputs: AssistInputs, settings: AssistSettings): number {
  const weightSum = settings.accuracyWeight + settings.hpWeight + settings.lossWeight;
  if (weightSum <= 0) return 1;

  // 掉血速率归一化：0 = 没掉血（最好），1 = 达到 lossRefHpPerSec（最差），更高也钳到 1
  const lossPenalty =
    settings.lossRefHpPerSec > 0
      ? clamp01(inputs.recentLossPerSec / settings.lossRefHpPerSec)
      : 0;

  const score =
    (settings.accuracyWeight * clamp01(inputs.accuracy) +
      settings.hpWeight * clamp01(inputs.hpRatio) +
      settings.lossWeight * (1 - lossPenalty)) /
    weightSum;
  return clamp01(score);
}

/**
 * 把 assist 应用到时间难度进度上：effectiveT = t × (pullMin + (1 - pullMin) × assist)。
 * assist=1 → effectiveT = t（原曲线）；assist=0 → effectiveT = t × pullMin（最强保护）。
 * 结果永远 ≤ 原 t，保证「只降不升」。
 */
export function applyAssistToProgress(t: number, assist: number, pullMin: number): number {
  const clampedPull = clamp01(Math.max(0, pullMin));
  const factor = clampedPull + (1 - clampedPull) * clamp01(assist);
  return clamp01(t) * factor;
}

/**
 * 帧级指数平滑：把当前 assist 向目标值靠拢一步。
 * dt 为帧间隔（秒）；smoothingSec 越大跟踪越慢（难度变化越柔和）。
 */
export function smoothAssist(current: number, target: number, dt: number, smoothingSec: number): number {
  if (smoothingSec <= 0 || dt <= 0) return target;
  const k = 1 - Math.exp(-dt / smoothingSec);
  return current + (target - current) * k;
}
