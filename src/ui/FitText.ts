/**
 * 文本适配工具（src/ui/FitText.ts）
 * 职责：为选项卡片 / 题干面板生成「保证完整显示」的文本：
 *  1. **CJK 断行**：Phaser wordWrap 默认按空格断行，中文/长英文单词不会换行，
 *     是「答案显示不全」的根因——这里强制 useAdvancedWrap 按字符断行；
 *  2. **自动缩字号**：从基准字号起，若换行后高度仍超出容器则逐级缩小，
 *     保证任何长度的答案都完整落在卡片内。
 */

import Phaser from 'phaser';
import { FONT_FAMILY } from './Palette';

export interface FittedTextOptions {
  /** 文字颜色（css 字符串） */
  color: string;
  /** 自动换行宽度（px） */
  wrapWidth: number;
  /** 允许的最大高度（px），超出则缩小字号 */
  maxHeight: number;
  /** 基准字号（px） */
  baseSize: number;
  /** 最小字号下限，默认 13 */
  minSize?: number;
  /** 对齐，默认 center */
  align?: 'left' | 'center' | 'right';
  /** 行距，默认 2 */
  lineSpacing?: number;
}

/** 创建一个「断行正确 + 高度自适应缩字」的文本对象（调用方自行 setPosition/setOrigin） */
export function createFittedText(
  scene: Phaser.Scene,
  content: string,
  opts: FittedTextOptions,
): Phaser.GameObjects.Text {
  const minSize = opts.minSize ?? 13;
  const text = scene.add.text(0, 0, content, {
    fontFamily: FONT_FAMILY,
    fontSize: `${Math.round(opts.baseSize)}px`,
    color: opts.color,
    align: opts.align ?? 'center',
    lineSpacing: opts.lineSpacing ?? 2,
    wordWrap: { width: Math.max(40, opts.wrapWidth), useAdvancedWrap: true },
  });
  let size = Math.round(opts.baseSize);
  while (text.height > opts.maxHeight && size - 2 >= minSize) {
    size -= 2;
    text.setFontSize(size);
  }
  return text;
}

/** 对已存在的文本对象做内容替换并重新缩字适配（题干面板复用同一 Text 实例时使用） */
export function refitText(
  text: Phaser.GameObjects.Text,
  content: string,
  opts: Pick<FittedTextOptions, 'maxHeight' | 'baseSize' | 'minSize'>,
): void {
  text.setText(content);
  let size = Math.round(opts.baseSize);
  text.setFontSize(size);
  while (text.height > opts.maxHeight && size - 2 >= (opts.minSize ?? 13)) {
    size -= 2;
    text.setFontSize(size);
  }
}
