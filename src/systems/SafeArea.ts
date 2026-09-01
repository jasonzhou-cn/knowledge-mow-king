/**
 * 安全区计算（src/systems/SafeArea.ts）
 * 职责：基于 viewport 物理尺寸与 Phaser 逻辑分辨率，计算：
 -   - 实际 Phaser 渲染区域（FIT 后的 rect）
 -   - sideMargin / topMargin（FIT 黑边空间）
 -   - safeRect（安全区：实际渲染区域内缩 24 像素，UI 必须放这里）
 *
 * 设计动机（GDD 2.2 + 移动端适配）：方案 D 与方案 A 协同——
 *   - 方案 A（双 canvas）：背景铺满 viewport，Phaser canvas 居中 FIT，
 *     周围黑边/延伸区由背景处理
 *   - 方案 D（本模块）：Phaser canvas 内部的 HUD/HP/武器栏自适应 FIT
 *     黑边区域，确保在任意比例（19.5:9 / 16:9 / 4:3）下 UI 永远在
 *     实际渲染范围内，不会被裁切或浮在空白处
 *
 * 回滚机制（重要）：
 *   - 通过 ENABLE_SAFE_AREA 常量控制是否启用。false 时退化为方案 A 行为，
 *     UI 直接用 this.scale.width/height（即 960×640 逻辑单位，无需任何计算）
 *   - 这是单文件、单常量的最小可逆方案——出问题改一个常量即恢复。
 *
 * 用法示例（GrassCuttingScene.ts）：
 *   this.safeArea = new SafeArea(this, 960, 640, 24);
 *   hud.setY(this.safeArea.bottomY - 12);    // HP 条 / 时间条底部贴齐安全区底部
 *   weaponBar.setX(this.safeArea.rightX - 20); // 武器栏贴齐安全区右侧
 */

import Phaser from 'phaser';

/** 安全区内缩的像素数（逻辑单位，Phaser FIT 缩放后会按比例缩放） */
const DEFAULT_INSET = 24;

/**
 * 方案 D 启用控制：
 *   - true：启用 SafeArea，HUD/武器栏按 viewport 适配（推荐）
 *   - false：退化为方案 A 行为，HUD 直接用 this.scale.width/height
 *
 * 出问题改这一行 + git commit "revert safe area" 即可。
 * 默认 true（方案 D 启用）。如要切换为方案 A 直读模式，改 false。
 */
export const ENABLE_SAFE_AREA = true;

export interface SafeAreaLayout {
  /** Phaser 逻辑分辨率 */
  gameWidth: number;
  gameHeight: number;
  /** viewport 物理尺寸（CSS 像素） */
  viewportWidth: number;
  viewportHeight: number;
  /** FIT 缩放系数 */
  scale: number;
  /** 实际渲染区域（Phaser canvas 在 viewport 中的位置，单位 CSS 像素） */
  render: { x: number; y: number; width: number; height: number };
  /** UI 安全区（render 内缩 inset） */
  safe: Phaser.Geom.Rectangle;
  /** 边缘留白（CSS 像素），0 表示无黑边 */
  sideMargin: number;
  topMargin: number;
}

/**
 * 安全区计算器。每次 viewport 变化（resize / orientationchange）重新实例化。
 */
export class SafeArea {
  /** 当前布局，refresh() 时整体替换 */
  layout: SafeAreaLayout;

  constructor(
    private readonly scene: Phaser.Scene,
    gameWidth: number,
    gameHeight: number,
    inset: number = DEFAULT_INSET,
  ) {
    this.layout = SafeArea.compute(
      scene.scale.width,
      scene.scale.height,
      gameWidth,
      gameHeight,
      inset,
    );
  }

  /** 重算（resize / orientationchange 后调用） */
  refresh(inset: number = DEFAULT_INSET): void {
    this.layout = SafeArea.compute(
      this.scene.scale.width,
      this.scene.scale.height,
      this.layout.gameWidth,
      this.layout.gameHeight,
      inset,
    );
  }

  /** 安全区顶部 Y（CSS 像素） */
  get topY(): number {
    return this.layout.safe.y;
  }

  /** 安全区底部 Y（CSS 像素） */
  get bottomY(): number {
    return this.layout.safe.bottom;
  }

  /** 安全区左侧 X（CSS 像素） */
  get leftX(): number {
    return this.layout.safe.x;
  }

  /** 安全区右侧 X（CSS 像素） */
  get rightX(): number {
    return this.layout.safe.right;
  }

  /** 安全区中心 X（CSS 像素） */
  get centerX(): number {
    return this.layout.safe.centerX;
  }

  /** 安全区中心 Y（CSS 像素） */
  get centerY(): number {
    return this.layout.safe.centerY;
  }

  /** 安全区宽度（CSS 像素） */
  get width(): number {
    return this.layout.safe.width;
  }

  /** 安全区高度（CSS 像素） */
  get height(): number {
    return this.layout.safe.height;
  }

  /** 是否有黑边（sideMargin > 1 表示 viewport 比 FIT 后渲染区域宽） */
  get hasSideMargin(): boolean {
    return this.layout.sideMargin > 1;
  }

  /** 是否有上下黑边 */
  get hasTopMargin(): boolean {
    return this.layout.topMargin > 1;
  }

  // ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 静态计算 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  /**
   * 纯函数：给定 viewport 与逻辑分辨率，计算渲染区与安全区。
   * 可独立测试 / 单测。
   */
  static compute(
    viewportWidth: number,
    viewportHeight: number,
    gameWidth: number,
    gameHeight: number,
    inset: number,
  ): SafeAreaLayout {
    // FIT 缩放：取 viewport 与 game 的最小比例
    const scale = Math.min(viewportWidth / gameWidth, viewportHeight / gameHeight);
    const renderWidth = gameWidth * scale;
    const renderHeight = gameHeight * scale;
    const x = (viewportWidth - renderWidth) / 2;
    const y = (viewportHeight - renderHeight) / 2;

    // 安全区：渲染区内缩 inset，按比例缩放 inset（确保视觉留白一致）
    const safeInset = inset * scale;
    const safe = new Phaser.Geom.Rectangle(
      x + safeInset,
      y + safeInset,
      Math.max(0, renderWidth - safeInset * 2),
      Math.max(0, renderHeight - safeInset * 2),
    );

    return {
      gameWidth,
      gameHeight,
      viewportWidth,
      viewportHeight,
      scale,
      render: { x, y, width: renderWidth, height: renderHeight },
      safe,
      sideMargin: x,
      topMargin: y,
    };
  }
}