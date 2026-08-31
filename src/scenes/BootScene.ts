/**
 * 启动场景（src/scenes/BootScene.ts）
 * 职责：
 *  1. 用 Phaser.Graphics 程序化生成全部贴图并缓存（零外部素材约束：不依赖任何 png/jpg/字体文件）；
 *  2. 通过 ConfigLoader 并行加载并校验全部 JSON 配置，校验失败立即阻断启动；
 *  3. 初始化题库与本地存档，然后跳转到主菜单。
 *
 * 生成的贴图统一为「白色灰度图」，运行期通过 setTint 上色，
 * 这样同一张贴图可以服务于任意配色，改配色不需要重新生成贴图。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { questionBank } from '../data/QuestionBank';
import { progression } from '../systems/ProgressionSystem';
import { Palette, css, textStyle } from '../ui/Palette';
import { showFatalError } from '../utils/FatalError';

/** 贴图 key 常量集中管理，避免各处硬编码字符串 */
export const TextureKeys = {
  pixel: 'pixel',
  cardFill: 'card-fill',
  cardBorder: 'card-border',
  player: 'player',
  monster: 'monster',
  zoneFill: 'zone-fill',
  zoneRing: 'zone-ring',
  glow: 'glow',
  shard: 'fx-shard',
  bolt: 'fx-bolt',
  pellet: 'fx-pellet',
  swing: 'fx-swing',
} as const;

/**
 * 武器贴图 key 的前缀：贴图 key = 前缀 + 配置里的 weapon.id。
 * 这样新增武器只需在 weaponConfig.json 里加一条配置、在本文件的 makeWeapons() 里生成同名贴图，
 * 业务代码里不需要维护「id → 贴图」的映射表。
 */
export const WEAPON_TEXTURE_PREFIX = 'weapon-';

/** 挥砍弧光贴图的半径（像素），场景靠它把弧光缩放到武器的实际射程 */
export const SWING_TEXTURE_RADIUS = 60;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.generateTextures();
    this.drawLoadingText();

    // 异步加载配置，失败则阻断；await 在 create 中是安全的，场景会等待 Promise
    void this.bootstrap();
  }

  /** 顺序完成：加载配置 → 初始化题库 → 初始化存档 → 进入主菜单 */
  private async bootstrap(): Promise<void> {
    const loader = ConfigLoader.getInstance();

    try {
      await loader.loadAllConfigs();
    } catch (error) {
      showFatalError(
        `${(error as Error).message}\n\n` +
          '请修正 public/config/ 下对应的 JSON 配置后刷新页面。' +
          '游戏不会在配置非法的情况下启动，以避免脏数据影响体验。',
      );
      return;
    }

    try {
      questionBank.load(loader.getConfig('questionBank'));
    } catch (error) {
      showFatalError(`题库加载失败：${(error as Error).message}`);
      return;
    }

    progression.bind(loader.getConfig('gameSettings'));
    progression.load();

    this.scene.start('MenuScene');
  }

  /** 绘制加载提示 */
  private drawLoadingText(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.add
      .text(w / 2, h / 2, '正在加载配置…', textStyle(24, css(Palette.text.secondary)))
      .setOrigin(0.5);
  }

  // ─────────────────── 程序化贴图生成 ───────────────────

  /** 生成全部贴图；所有图形均为白色，运行期靠 tint 上色 */
  private generateTextures(): void {
    this.makePixel();
    this.makeCardFill();
    this.makeCardBorder();
    this.makePlayer();
    this.makeMonster();
    this.makeZoneFill();
    this.makeZoneRing();
    this.makeGlow();
    this.makeFxShard();
    this.makeFxProjectiles();
    this.makeSwingArc();
    this.makeWeapons();
  }

  /** 1x1 白色像素（放大后用于血条、进度条等纯色矩形） */
  private makePixel(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
    g.generateTexture(TextureKeys.pixel, 8, 8);
    g.destroy();
  }

  /** 选项卡片底色：圆角矩形 */
  private makeCardFill(): void {
    const w = 200;
    const h = 76;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, w, h, 12);
    g.generateTexture(TextureKeys.cardFill, w, h);
    g.destroy();
  }

  /** 选项卡片描边：空心圆角矩形（与底色分层，便于分别 tint） */
  private makeCardBorder(): void {
    const w = 200;
    const h = 76;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeRoundedRect(3, 3, w - 6, h - 6, 10);
    g.generateTexture(TextureKeys.cardBorder, w, h);
    g.destroy();
  }

  /** 玩家：圆形主体 + 高光核心 + 朝向缺口 */
  private makePlayer(): void {
    const size = 48;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(r, r, r - 2);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(r, r, r - 12);
    // 朝向缺口：一个不对称的小三角，让玩家能看出面朝方向
    g.fillStyle(0x000000, 0.35);
    g.fillTriangle(r + 4, r - 9, r + 4, r + 9, r - 14, r);
    g.generateTexture(TextureKeys.player, size, size);
    g.destroy();
  }

  /** 小怪：带尖角的草团轮廓 */
  private makeMonster(): void {
    const size = 36;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    // 主体
    g.fillCircle(r, r, r - 3);
    // 四周尖角，营造「草丛怪」的锯齿感
    const spikes = 8;
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const inner = r - 5;
      const outer = r - 0.5;
      const ax = r + Math.cos(angle) * inner;
      const ay = r + Math.sin(angle) * inner;
      const bx = r + Math.cos(angle + Math.PI / spikes) * outer;
      const by = r + Math.sin(angle + Math.PI / spikes) * outer;
      const cx = r + Math.cos(angle - Math.PI / spikes) * outer;
      const cy = r + Math.sin(angle - Math.PI / spikes) * outer;
      g.fillTriangle(ax, ay, bx, by, cx, cy);
    }
    g.generateTexture(TextureKeys.monster, size, size);
    g.destroy();
  }

  /** 技能区域填充：柔和实心圆（用于范围提示） */
  private makeZoneFill(): void {
    const size = 256;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // 同心圆叠加模拟径向渐变，避免依赖任何图片资源
    const layers = 10;
    for (let i = layers; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.1);
      g.fillCircle(r, r, (r - 2) * (i / layers));
    }
    g.generateTexture(TextureKeys.zoneFill, size, size);
    g.destroy();
  }

  /** 技能区域描边：空心圆环 */
  private makeZoneRing(): void {
    const size = 256;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(r, r, r - 4);
    g.generateTexture(TextureKeys.zoneRing, size, size);
    g.destroy();
  }

  /** 通用光晕：用于点击反馈、奖励提示等 */
  private makeGlow(): void {
    const size = 96;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const layers = 8;
    for (let i = layers; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.08);
      g.fillCircle(r, r, r * (i / layers));
    }
    g.generateTexture(TextureKeys.glow, size, size);
    g.destroy();
  }

  /** 击杀碎片：菱形，运行期靠 tint 上色、靠 rotation 制造飞散感 */
  private makeFxShard(): void {
    const size = 12;
    const r = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(r, 0, size, r, r, size);
    g.fillTriangle(r, 0, r, size, 0, r);
    g.generateTexture(TextureKeys.shard, size, size);
    g.destroy();
  }

  /** 弹丸贴图：胶囊形（单发）与圆点（霰弹），均朝右为 0 度基准 */
  private makeFxProjectiles(): void {
    const bw = 22;
    const bh = 8;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, bw, bh, bh / 2);
    g.generateTexture(TextureKeys.bolt, bw, bh);
    g.destroy();

    const size = 10;
    const g2 = this.make.graphics({ x: 0, y: 0 }, false);
    g2.fillStyle(0xffffff, 1);
    g2.fillCircle(size / 2, size / 2, size / 2 - 0.5);
    g2.generateTexture(TextureKeys.pellet, size, size);
    g2.destroy();
  }

  /**
   * 近战挥砍弧光：以贴图中心为顶点、朝 +X 方向张开的扇形，
   * 场景直接 setRotation(facing) 就能对准出手方向。
   */
  private makeSwingArc(): void {
    const size = SWING_TEXTURE_RADIUS * 2;
    const c = SWING_TEXTURE_RADIUS;
    const half = (65 * Math.PI) / 180;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(0xffffff, 0.3);
    g.beginPath();
    g.moveTo(c, c);
    for (let a = -half; a <= half; a += 0.08) {
      g.lineTo(c + Math.cos(a) * (c - 6), c + Math.sin(a) * (c - 6));
    }
    g.closePath();
    g.fillPath();

    // 外缘描一道亮边，让挥砍的「锋线」看得见
    g.lineStyle(5, 0xffffff, 0.95);
    g.beginPath();
    for (let a = -half; a <= half; a += 0.08) {
      const x = c + Math.cos(a) * (c - 8);
      const y = c + Math.sin(a) * (c - 8);
      if (a === -half) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();

    g.generateTexture(TextureKeys.swing, size, size);
    g.destroy();
  }

  /**
   * 三把武器的显示贴图：全部为纯 Graphics 生成的白色剪影，运行期靠 tint 上色。
   * 统一以「朝右」为 0 度基准，方便直接 setRotation(facing)。
   * 贴图 key 固定为「weapon-」+ 配置里的武器 id，新增武器无需改动业务代码。
   */
  private makeWeapons(): void {
    // 大刀 blade：长条刀身 + 短握柄
    const bl = this.make.graphics({ x: 0, y: 0 }, false);
    bl.fillStyle(0xffffff, 1);
    bl.fillRect(0, 6, 8, 8); // 握柄
    bl.fillTriangle(8, 2, 54, 8, 8, 16); // 刀身
    bl.fillStyle(0xffffff, 0.55);
    bl.fillTriangle(8, 6, 44, 9, 8, 13); // 刃口高光
    bl.generateTexture(`${WEAPON_TEXTURE_PREFIX}blade`, 58, 22);
    bl.destroy();

    // 机关枪 smg：紧凑机匣 + 细长枪管 + 弹匣
    const sm = this.make.graphics({ x: 0, y: 0 }, false);
    sm.fillStyle(0xffffff, 1);
    sm.fillRect(2, 5, 16, 10); // 机匣
    sm.fillRect(18, 7, 20, 5); // 枪管
    sm.fillRect(6, 15, 6, 8); // 弹匣
    sm.generateTexture(`${WEAPON_TEXTURE_PREFIX}smg`, 40, 24);
    sm.destroy();

    // 霰弹枪 scatter：粗短双管 + 枪托
    const sc = this.make.graphics({ x: 0, y: 0 }, false);
    sc.fillStyle(0xffffff, 1);
    sc.fillRect(0, 6, 10, 9); // 枪托
    sc.fillRect(10, 5, 24, 5); // 上管
    sc.fillRect(10, 11, 24, 5); // 下管
    sc.generateTexture(`${WEAPON_TEXTURE_PREFIX}scatter`, 36, 21);
    sc.destroy();
  }
}
