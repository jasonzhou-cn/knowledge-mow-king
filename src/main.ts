/**
 * 游戏入口（src/main.ts）
 * 职责：创建 Phaser.Game 实例、注册全部场景、配置缩放策略与渲染参数。
 * 约定：逻辑分辨率固定 960×640，使用 Scale.FIT 自适应任意窗口 / 手机屏幕，
 *      保证不同设备上的判定区与选项尺寸比例完全一致（答题公平原则的前提）。
 */

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GrassCuttingScene } from './scenes/GrassCuttingScene';
import { MenuScene } from './scenes/MenuScene';
import { QuestionScene } from './scenes/QuestionScene';
import { ResultScene } from './scenes/ResultScene';
import { CANVAS_MODE_DESC, getCanvasMode, getPhaserScaleConfig } from './config/CanvasMode';

/** 逻辑分辨率（所有配置里的坐标都基于这个尺寸） */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;

// 打印当前 canvas 适配模式（生产构建也保留，便于部署定位问题）
// eslint-disable-next-line no-console
console.log('[KB Canvas Mode]', getCanvasMode(), '—', CANVAS_MODE_DESC[getCanvasMode()]);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0b1622',
  scale: getPhaserScaleConfig(),
  input: {
    // Phaser 默认只创建 1 个触摸 Pointer，第二根手指会被直接丢弃；
    // 移动端必须支持「一根手指拖摇杆走位 + 另一根手指点攻击」，所以至少要 2 个
    activePointers: 2,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
  // 关闭 Phaser 的居中问候语，保持界面干净
  banner: false,
  scene: [BootScene, MenuScene, QuestionScene, GrassCuttingScene, ResultScene],
};

const game = new Phaser.Game(config);

// 移动端横屏 + 全屏体验（尽力而为）：
//  ① 竖屏时由 index.html 的 #rotate-overlay 引导用户旋转；
//  ② 首次用户交互时尝试把屏幕锁定为横屏 + 进入浏览器全屏——
//     Android Chrome 直接生效；iOS 16.4+ 支持 lock 但 fullscreen 仅 video 元素，
//     旧版本或未授权时静默失败，不阻断游戏。
// 注：本 TS 版本的 ScreenOrientation 类型未声明 lock，用类型断言兼容运行时能力检测。
const orient = screen.orientation as
  | (ScreenOrientation & { lock?: (orientation: string) => Promise<void> })
  | null;
const tryLockLandscape = (): void => {
  orient?.lock?.('landscape')?.catch(() => {
    /* 不支持 / 已被浏览器拒绝：交给 CSS 旋转提示兜底 */
  });
};
const tryFullscreen = (): void => {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const r = req.call(el);
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {
        /* 无用户激活 / 被拒绝时静默 */
      });
    }
  } catch {
    /* 静默 */
  }
};
const onFirstInteraction = (): void => {
  tryLockLandscape();
  tryFullscreen();
};
window.addEventListener('pointerdown', onFirstInteraction, { once: true });
window.addEventListener('touchstart', onFirstInteraction, { once: true });

// 供无头浏览器（CDP）自动化验证读取游戏实例（当前活跃场景等）。
// 仅在开发模式暴露；生产构建时 import.meta.env.DEV 为 false，整行被 tree-shaking 剔除。
if (import.meta.env.DEV) {
  (window as unknown as { __KB_GAME__?: Phaser.Game }).__KB_GAME__ = game;
}
