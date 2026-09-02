/**
 * 关卡导航工具（src/config/levelNavigation.ts）
 * 职责：从 resolve.ts 拆出"按关卡号查询下一关"等纯查询逻辑，便于单测与复用。
 */
import type { LevelConfig } from './types';

/** 下一关的关卡号；已是最后一关则返回自身（循环推进） */
export function resolveNextLevel(levelConfig: LevelConfig, level: number): number {
  const levels = levelConfig.levels;
  if (levels.length === 0) return level;
  const last = levels[levels.length - 1];
  for (const entry of levels) {
    if (entry.level > level) return entry.level;
  }
  return last.level;
}
