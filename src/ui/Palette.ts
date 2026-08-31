/**
 * 配色与字体常量集中管理（src/ui/Palette.ts）
 * 职责：全游戏唯一的颜色 / 字号 / 字体栈来源，任何绘制代码都不得内联写死颜色值。
 * 注意：当前为工程占位默认值，等待美术总监（林绘澄）提供正式色板后在此文件统一替换，
 *      替换后所有场景自动生效，无需改动任何业务代码。
 */

/** 字体栈：不依赖任何字体文件，使用系统字体并带完整中文 fallback */
export const FONT_FAMILY =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans CN", "Noto Sans CJK SC", "WenQuanYi Micro Hei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** 生成 Phaser 文本样式，统一字体栈避免各处散落 */
export function textStyle(size: number, color: string, extra?: Partial<Phaser.Types.GameObjects.Text.TextStyle>): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color,
    ...extra,
  };
}

/** 主色板：深蓝夜空基调 + 青绿高光，突出「割草」的自然感与「知识」的科技感 */
export const Palette = {
  /** 背景与容器 */
  background: {
    deep: 0x0b1622,
    base: 0x12263a,
    panel: 0x1b3550,
    panelSoft: 0x22425f,
    grassField: 0x16351f,
    grassFieldAlt: 0x1a3d24,
  },

  /** 文字 */
  text: {
    primary: 0xf2f7fb,
    secondary: 0xa8c2d6,
    hint: 0x6f8ba3,
    onAccent: 0x08131e,
  },

  /** 强调色 */
  accent: {
    primary: 0x35d0a5,
    primaryDark: 0x1f9c78,
    secondary: 0x7fd8ff,
    gold: 0xffcc4d,
    orange: 0xff9f45,
  },

  /** 状态色（正确 / 错误 / 未命中） */
  status: {
    correct: 0x3ddc84,
    correctDark: 0x1f8f52,
    wrong: 0xff6b6b,
    wrongDark: 0xb23c3c,
    miss: 0xc9a227,
    warning: 0xffa94d,
  },

  /** 答题场景 */
  quiz: {
    cardFill: 0xf2f7fb,
    cardFillDim: 0xcfdcea,
    cardBorder: 0x7fd8ff,
    cardText: 0x10263a,
    zone: 0xffcc4d,
    zoneGlow: 0xffe9a8,
    trackGuide: 0x2b4c69,
  },

  /** 割草场景 */
  combat: {
    player: 0x7fd8ff,
    playerCore: 0xffffff,
    monster: 0x8fdc6a,
    monsterElite: 0xf2a25c,
    monsterHurt: 0xffffff,
    zoneRing: 0x35d0a5,
    zoneFill: 0x1f9c78,
    hpBarBg: 0x2a1a1f,
    hpBarFill: 0xff6b6b,
    monsterHpFill: 0xd94f4f,
    /** 武器剪影配色：按攻击形态区分，方便一眼看出当前拿的是哪把 */
    weapon: {
      melee_sector: 0xdaf2ff,
      ranged_bolt: 0xa8f5dc,
      ranged_spread: 0xffd9a8,
    },
  },
} as const;

/** 按攻击形态取武器剪影的配色；未知形态回落到近战色 */
export function weaponTint(attackType: string): number {
  if (attackType === 'ranged_bolt') return Palette.combat.weapon.ranged_bolt;
  if (attackType === 'ranged_spread') return Palette.combat.weapon.ranged_spread;
  return Palette.combat.weapon.melee_sector;
}

/** 十六进制数值转 CSS 颜色字符串（用于 Phaser Text 的 color 字段） */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** 常用文本颜色字符串，避免在场景里反复转换 */
export const CssColor = {
  primary: css(Palette.text.primary),
  secondary: css(Palette.text.secondary),
  hint: css(Palette.text.hint),
  accent: css(Palette.accent.primary),
  secondaryAccent: css(Palette.accent.secondary),
  gold: css(Palette.accent.gold),
  correct: css(Palette.status.correct),
  wrong: css(Palette.status.wrong),
  miss: css(Palette.status.miss),
  onDark: css(Palette.text.onAccent),
} as const;
