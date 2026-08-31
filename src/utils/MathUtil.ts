/**
 * 数学与通用工具（src/utils/MathUtil.ts）
 * 职责：集中承载所有数值公式（钳制、缓动、成长曲线、随机与洗牌），
 *      避免各场景各写一份公式导致数值口径不一致（GDD 1.4 多表关联原则的落地保障）。
 */

/** 把数值钳制到 [min, max] 闭区间 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 把数值钳制到 [0, 1] */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 三次缓出曲线，用于 UI 弹入 */
export function easeOutCubic(t: number): number {
  const p = 1 - clamp01(t);
  return 1 - p * p * p;
}

/** 回弹缓动（超过目标再回落），用于选项停止的弹性缓冲 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = clamp01(t) - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

/** 指数趋近平滑，帧率无关的阻尼 interpolation */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * 指数成长曲线：base * growth^(level-1)
 * 用于小怪血量（growth>1 递增）、技能冷却（growth<1 递减）等倍率型成长。
 */
export function growthExponential(base: number, growth: number, level: number): number {
  return base * Math.pow(growth, Math.max(0, level - 1));
}

/**
 * 线性百分比成长曲线：base * (1 + growthPerLevel * (level-1))
 * 用于技能伤害、持续时间等「按基础值百分比叠加」的成长。
 */
export function growthLinearPercent(base: number, growthPerLevel: number, level: number): number {
  return base * (1 + growthPerLevel * Math.max(0, level - 1));
}

/** 返回 [min, max) 区间内的随机整数 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Fisher-Yates 原地洗牌。
 * 答题公平原则（GDD 1.3）要求选项位置随机打乱，必须用无偏洗牌算法。
 */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = items[i];
    const b = items[j];
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** 距离平方判定：割草场景碰撞检测禁用开方，符合 GDD 1.2 碰撞精简原则 */
export function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

/** 秒数格式化为「M:SS」，用于倒计时展示 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** 保留一位小数的字符串，用于结算面板展示平均耗时 */
export function formatOneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** 将 #RRGGBB 字符串解析为 Phaser 可用的数值颜色；解析失败回退到粉色以便暴露问题 */
export function hexToColor(hex: string, fallback = 0xff00ff): number {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  return parseInt(m[1], 16);
}
