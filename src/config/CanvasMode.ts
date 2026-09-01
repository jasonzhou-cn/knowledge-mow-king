/**
 * Canvas 模式配置（src/config/CanvasMode.ts）
 * 职责：单一可信源，控制游戏用哪种 canvas 适配方案。
 *
 * 三种模式：
 *  - 'a'（默认，双 canvas）：背景 canvas 铺满 viewport + Phaser canvas FIT 居中
 *      0 黑边、不变形；最稳的方案，推荐生产环境
 *  - 'c'（Phaser RESIZE）：Phaser canvas 物理 = viewport，画满整个屏幕
 *      0 黑边但会变形（圆变椭圆）；适合 16:9 屏原生游戏
 *  - 'd'（SafeArea）：方案 A + 内部 UI 安全区；当前 GrassCuttingScene 默认
 *
 * 切换方式（任选其一）：
 *  1. 改文件：CANVAS_MODE = 'a' → 'c'
 *  2. 改环境变量：build 时 Vite 会替换 import.meta.env.VITE_CANVAS_MODE
 *  3. 部署回滚：git revert <commit_hash>
 *
 * 三种回滚机制：
 *  L1（构建期）：改本文件 CANVAS_MODE 常量 → 重建
 *  L2（环境变量）：VITE_CANVAS_MODE=c 时构建自动启用方案 C
 *  L3（Git）：git revert <方案C commit hash>
 */

import Phaser from 'phaser';

/** 构建期模式（默认值） */
export const CANVAS_MODE = 'a' as CanvasMode;

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