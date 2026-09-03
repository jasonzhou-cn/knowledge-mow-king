/**
 * Canvas 模式配置（src/config/CanvasMode.ts）
 * 职责：单一可信源，控制游戏用哪种 canvas 适配方案。
 *
 * 【锁定状态 2026-09-02】CANVAS_MODE = 'c'（Scale.RESIZE 铺满）
 *  - 用户决策：画布 CSS 尺寸必须与视口一致（小米设备 2340×1080，19.5:9），
 *    接受 3:2 内容在 19.5:9 下的比例变化（原 GDD「判定区比例 FIT 保护」红线由用户主动放开）。
 *  - 锁定规则：本常量是画布尺寸/样式的唯一权威来源，任何后续操作不得改回其他模式；
 *    如需回滚，走三层回滚机制（L1 改本文件 → L2 VITE_CANVAS_MODE 构建期覆盖 → L3 git revert），
 *    禁止在运行时用脚本/CDP 注入样式修改 canvas 尺寸。
 *  - 回归门禁：node scripts/verify-canvas-lock.mjs（断言 canvas CSS=物理=视口 2340×1080）。
 *
 * 三种模式：
 *  - 'a'（双 canvas）：背景 canvas 铺满 viewport + Phaser canvas FIT 居中
 *      0 黑边、不变形；此前默认（2026-09-02 前真实部署均为此模式）
 *  - 'c'（Phaser RESIZE）：Phaser canvas 物理 = viewport，画满整个屏幕
 *      0 黑边但内容比例随屏幕变化；【当前锁定】
 *  - 'd'（SafeArea）：方案 A + 内部 UI 安全区
 *
 * 切换方式（任选其一）：
 *  1. 改文件：CANVAS_MODE = 'c' → 'a'
 *  2. 改环境变量：build 时 Vite 会替换 import.meta.env.VITE_CANVAS_MODE
 *  3. 部署回滚：git revert <commit_hash>
 */

import Phaser from 'phaser';

/** 构建期模式（锁定值，勿改；改前先看文件头「锁定状态」说明） */
export const CANVAS_MODE = 'c' as CanvasMode;

export type CanvasMode = 'a' | 'c' | 'd';

/** 环境变量覆盖（构建时生效） */
export function getCanvasMode(): CanvasMode {
  const env = (import.meta.env.VITE_CANVAS_MODE as string | undefined)?.toLowerCase();
  if (env === 'a' || env === 'c' || env === 'd') return env;
  return CANVAS_MODE;
}

/** 根据模式返回 Phaser scale 配置（用于 src/main.ts） */
export function getPhaserScaleConfig(): Phaser.Types.Core.ScaleConfig {
  const mode = getCanvasMode();

  switch (mode) {
    case 'c':
      // 方案 C：物理 canvas = viewport，整个屏幕无黑边
      return {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      };
    case 'a':
    case 'd':
    default:
      // 方案 A/D：FIT 居中（不变形，背景 canvas 填满 viewport 周围）
      return {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      };
  }
}

/** 模式说明（控制台日志） */
export const CANVAS_MODE_DESC: Record<CanvasMode, string> = {
  a: 'A: 双 canvas（背景铺满 + Phaser FIT 居中）',
  c: 'C: Phaser RESIZE（物理 = viewport，会变形）',
  d: 'D: 方案 A + 内部 UI 安全区（推荐生产）',
};