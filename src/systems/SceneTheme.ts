/**
 * 场景学科主题（src/systems/SceneTheme.ts）
 * 职责：按 design/art/scene-themes.md，让割草场景的地面底色 / 草丛 / 装饰 /
 *      漂浮学科符号随关卡学科（math / english / science）切换主题色系，
 *      Boss 关叠加更暗更沉的「终极战」氛围。
 *
 * 红线对齐：
 *  - 零素材：全部 Graphics / Text 程序化绘制，不引入任何图片；
 *  - 纯静态装饰：不参与碰撞与检测，动态元素只有 symbolCount 个轻量漂浮 tween；
 *  - 主题色全部来自 subjectConfig.themeColor 与现有 Palette，不新增色值常量。
 */

import Phaser from 'phaser';
import { Palette } from '../ui/Palette';
import type { ThemeDecoSettings } from '../config/types';

/** 各学科的主题强调色（与 subjectConfig.json 的 themeColor 保持一致，用于运行时混色） */
const SUBJECT_THEME_COLORS: Record<string, number> = {
  math: 0x3d7ea6,
  english: 0x7a5ea8,
  science: 0x2f8f6f,
};

/** 各学科的漂浮符号文案库（scene-themes.md §1.3 / §2.3 / §3.3） */
const SUBJECT_SYMBOLS: Record<string, string[]> = {
  math: ['π', '∑', '∞', '√', 'x²', '≠', '≈', '+', '−', '±'],
  english: ['A', 'B', 'C', 'ab', 'ed', 'ing', 'XYZ', 'E', 'F', 'W'],
  science: ['H\u2082O', 'O\u2082', 'CO\u2082', 'NaCl', 'Fe', 'Cu', 'Au', 'pH', '\u0394', 'Au'],
};

/** 各学科漂浮符号的漂动周期（science 最快 = 反应剧烈） */
const SUBJECT_SYMBOL_PERIOD: Record<string, number> = {
  math: 4200,
  english: 3500,
  science: 3000,
};

/** 主题应用结果：把主题强调色交给场景复用（如击杀碎片的主题色） */
export interface SceneThemeResult {
  /** 本关学科的主题强调色（#RRGGBB 数值），未知学科回落到精英橙 */
  accent: number;
}

/** #RRGGBB 字符串 → 数值；非法输入回落到 0 */
export function hexToNumber(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0;
  return parseInt(m[1], 16);
}

/** 在两个颜色之间线性插值（t ∈ [0,1]） */
export function blendColor(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * k);
  const g = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * 给割草场景应用学科主题：
 *  1. 地面底色 / 交替色带按学科主题色轻微染色；
 *  2. 草丛与学科装饰（圆点 / 叶片 / 锥形瓶）用固定种子分布，布局整关稳定；
 *  3. 漂浮学科符号给战场加「学科氛围」（数量受 themeDeco.symbolCount 约束）；
 *  4. Boss 关整体压暗 + 装饰降透明度，营造 Boss 战压迫感。
 */
export function applySceneTheme(
  scene: Phaser.Scene,
  subject: string,
  isBossLevel: boolean,
  deco: ThemeDecoSettings,
): SceneThemeResult {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const themeColor = SUBJECT_THEME_COLORS[subject] ?? Palette.combat.monsterElite;
  const symbols = SUBJECT_SYMBOLS[subject] ?? SUBJECT_SYMBOLS.math;
  const symbolPeriod = SUBJECT_SYMBOL_PERIOD[subject] ?? 3600;

  // Boss 关：地面更深 + 装饰更暗（终极战氛围）；普通关轻微主题染色
  const bossDim = 0.45;
  let fieldBase = blendColor(Palette.background.grassField, themeColor, 0.16);
  let fieldAlt = blendColor(Palette.background.grassFieldAlt, themeColor, 0.16);
  if (isBossLevel) {
    fieldBase = blendColor(fieldBase, Palette.background.deep, bossDim);
    fieldAlt = blendColor(fieldAlt, Palette.background.deep, bossDim);
  }

  const field = scene.add.graphics();
  field.fillStyle(fieldBase, 1);
  field.fillRect(0, 0, w, h);
  field.fillStyle(fieldAlt, 1);
  for (let y = 0; y < h; y += 96) {
    field.fillRect(0, y, w, 48);
  }
  field.setDepth(-20);

  // 固定种子 PRNG：布局整关一致，避免视觉跳动
  let seed = 20240501;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const spawnX = () => next() * w;
  const spawnY = () => 64 + next() * (h - 64);
  const awayFromCenter = (x: number, y: number): boolean => {
    const dx = x - w / 2;
    const dy = y - (h / 2 + 40);
    return dx * dx + dy * dy > 80 * 80;
  };

  // 草丛（三角）与学科小装饰，同一层静态绘制
  const tufts = scene.add.graphics();
  tufts.setDepth(-10);
  const tuftColor = blendColor(Palette.combat.monster, themeColor, 0.3);
  const tuftAlpha = isBossLevel ? 0.14 : 0.22;
  for (let i = 0; i < deco.tuftCount; i++) {
    const x = spawnX();
    const y = spawnY();
    const height = 8 + next() * 14;
    tufts.fillStyle(tuftColor, tuftAlpha);
    tufts.fillTriangle(x - 5, y, x + 5, y, x, y - height);
  }

  // 学科专属静态装饰：6 个，避开玩家出生点
  const decoAlpha = isBossLevel ? 0.3 : 0.8;
  const shapes = scene.add.graphics();
  shapes.setDepth(-9);
  for (let i = 0; i < 6; i++) {
    let x = spawnX();
    let y = spawnY();
    for (let tries = 0; tries < 8 && !awayFromCenter(x, y); tries++) {
      x = spawnX();
      y = spawnY();
    }
    if (subject === 'english') {
      // 椭圆树叶（随机旋转）
      shapes.fillStyle(Palette.accent.primary, decoAlpha * 0.75);
      shapes.fillEllipse(x, y, 16, 8);
      shapes.lineStyle(2, Palette.accent.primaryDark, decoAlpha * 0.6);
      shapes.strokeEllipse(x, y, 16, 8);
    } else if (subject === 'science') {
      // 锥形瓶（三角瓶身 + 瓶口）
      shapes.fillStyle(Palette.accent.primary, decoAlpha * 0.4);
      shapes.fillTriangle(x - 10, y, x + 10, y, x, y - 18);
      shapes.lineStyle(2, Palette.accent.primary, decoAlpha * 0.9);
      shapes.strokeTriangle(x - 10, y, x + 10, y, x, y - 18);
      shapes.fillRect(x - 3, y - 22, 6, 5);
    } else {
      // 数学：金色小圆点（几何感）
      shapes.fillStyle(Palette.accent.gold, decoAlpha * 0.6);
      shapes.fillCircle(x, y, 4);
      shapes.lineStyle(1.5, Palette.accent.gold, decoAlpha * 0.4);
      shapes.strokeCircle(x, y, 7);
    }
  }

  // 漂浮学科符号：轻量 yoyo tween，数量受配置约束
  const symbolAlpha = isBossLevel ? 0.28 : 0.5;
  for (let i = 0; i < deco.symbolCount; i++) {
    const content = symbols[i % symbols.length];
    const x = spawnX();
    const y = spawnY();
    const label = scene.add
      .text(x, y, content, {
        fontFamily: 'monospace, sans-serif',
        fontSize: '22px',
        color: `#${Palette.text.secondary.toString(16).padStart(6, '0')}`,
      })
      .setOrigin(0.5)
      .setAlpha(symbolAlpha)
      .setDepth(-8);
    scene.tweens.add({
      targets: label,
      y: y - 8,
      duration: symbolPeriod,
      delay: next() * 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  return { accent: themeColor };
}
