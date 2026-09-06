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
import { playtime } from '../systems/PlaytimeSystem';
import { achievements } from '../systems/AchievementSystem';
import { sfx } from '../systems/SfxController';
import { bgm } from '../systems/BgmController';
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
  /** T-025 学霸 BUFF 掉落图标（书本，白色灰度图，运行期 tint 上色） */
  book: 'tex-book',
  /** T-026 躺平 BUFF 掉落图标（胶囊，白色灰度图，运行期 tint 上色） */
  lazyCapsule: 'tex-lazy-capsule',
  /** T-027 考神召唤迷你 Boss 底型（白色正圆灰度图，运行期按原 Boss 主题色 tint） */
  miniBoss: 'tex-buff-miniboss',
  /** T-032 宝箱（直接彩色烘焙，运行期不再 tint） */
  treasureChest: 'tex-treasure-chest',
  /** T-033 怪物变体贴图（白色灰度 + tint 管线，形状区分变体） */
  monsterVariants: {
    rusher: 'tex-monster-rusher',
    bookworm: 'tex-monster-bookworm',
    panhead: 'tex-monster-panhead',
    splitter: 'tex-monster-splitter',
  },
  /** T-032 陷阱图标（直接彩色烘焙）：poop / bolt / puddle / banana / megaphone / router */
  trap: {
    poop: 'tex-trap-poop',
    bolt: 'tex-trap-bolt',
    puddle: 'tex-trap-puddle',
    banana: 'tex-trap-banana',
    megaphone: 'tex-trap-megaphone',
    router: 'tex-trap-router',
  },
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

    // 音效 / BGM / 防沉迷 / 成就统一在配置校验通过后绑定（数值全部来自配置 JSON）
    sfx.bind(loader.getConfig('sfxConfig'));
    bgm.bind(loader.getConfig('bgmConfig'));
    playtime.bind(loader.getConfig('gameSettings').playtimeSettings);
    playtime.load();
    achievements.bind(loader.getConfig('achievementConfig'));

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
    this.makeBook();
    this.makeLazyCapsule();
    this.makeMiniBossBody();
    this.makeBossBodies();
    this.makeTreasureChest();
    this.makeTrapIcons();
    this.makeVariantMonsters();
  }

  /**
   * T-033 四种怪物变体贴图（48×48，白色灰度 + 呆萌脸，运行期 tint 照常）。
   * 形状区分：冲刺怪=流线尖锥体；扔书怪=小眼镜+腋下夹书；
   * 铁锅头=头顶倒扣铁锅（墨线大锅，看一眼就知道子弹没用）；分裂怪=身体中缝裂纹。
   */
  private makeVariantMonsters(): void {
    const { ink, inkSoft } = Palette.art;
    const c = 24;
    const face = (g: Phaser.GameObjects.Graphics): void => {
      // 共用呆萌脸：一大一小眼 + 龅牙
      g.fillStyle(0xffffff, 1);
      g.fillCircle(c - 5, c - 4, 6);
      g.fillCircle(c + 7, c - 2, 3.8);
      g.lineStyle(2, ink, 1);
      g.strokeCircle(c - 5, c - 4, 6);
      g.strokeCircle(c + 7, c - 2, 3.8);
      g.fillStyle(ink, 1);
      g.fillCircle(c - 6.5, c - 5.5, 2.6);
      g.fillCircle(c + 8, c - 0.5, 1.7);
      g.lineStyle(1.8, ink, 1);
      g.lineBetween(c - 6, c + 6, c + 6, c + 7);
    };

    // 冲刺怪：前倾流线楔形 + 三条速度线（往 +X 冲）
    const ru = this.make.graphics({ x: 0, y: 0 }, false);
    ru.fillStyle(ink, 1);
    ru.fillTriangle(2, 12, 2, 36, 46, 24);
    ru.fillStyle(0xe9f3e2, 1);
    ru.fillTriangle(5, 16, 5, 32, 41, 24);
    ru.lineStyle(1.5, ink, 0.5);
    ru.lineBetween(0, 8, 8, 14);
    ru.lineBetween(0, 24, 10, 24);
    ru.lineBetween(0, 40, 8, 34);
    face(ru);
    ru.generateTexture(TextureKeys.monsterVariants.rusher, 48, 48);
    ru.destroy();

    // 扔书怪：团子 + 圆眼镜 + 腋下夹一本厚书
    const bw = this.make.graphics({ x: 0, y: 0 }, false);
    bw.fillStyle(ink, 1);
    bw.fillCircle(c, c, 22.5);
    bw.fillStyle(0xe9f3e2, 1);
    bw.fillCircle(c, c, 19);
    face(bw);
    // 眼镜：两个圈 + 鼻梁架在大眼上
    bw.lineStyle(2, ink, 1);
    bw.strokeCircle(c - 5, c - 4, 8);
    bw.strokeCircle(c + 7, c - 2, 5.5);
    bw.lineBetween(c - 0.5, c - 3.5, c + 2.5, c - 2.8);
    // 腋下书（右下角一摞）
    bw.fillStyle(0xffffff, 1);
    bw.fillRect(c + 2, c + 8, 16, 9);
    bw.lineStyle(1.5, ink, 1);
    bw.strokeRect(c + 2, c + 8, 16, 9);
    bw.lineStyle(1, inkSoft, 0.8);
    bw.lineBetween(c + 2, c + 11, c + 18, c + 11);
    bw.lineBetween(c + 2, c + 14, c + 18, c + 14);
    bw.generateTexture(TextureKeys.monsterVariants.bookworm, 48, 48);
    bw.destroy();

    // 铁锅头：团子 + 头顶倒扣大铁锅（占半张脸宽，一眼看懂「子弹没用」）
    const ph = this.make.graphics({ x: 0, y: 0 }, false);
    ph.fillStyle(ink, 1);
    ph.fillCircle(c, c, 22.5);
    ph.fillStyle(0xe9f3e2, 1);
    ph.fillCircle(c, c, 19);
    face(ph);
    // 铁锅：灰色椭圆锅体 + 锅沿 + 锅柄
    ph.fillStyle(0xb9c4d2, 1);
    ph.fillEllipse(c, c - 16, 30, 12);
    ph.lineStyle(2.2, ink, 1);
    ph.strokeEllipse(c, c - 16, 30, 12);
    ph.lineStyle(2, ink, 1);
    ph.lineBetween(c + 14, c - 18, c + 22, c - 21); // 锅柄
    ph.fillStyle(0x8d99a8, 1);
    ph.fillEllipse(c, c - 13, 22, 5);
    ph.generateTexture(TextureKeys.monsterVariants.panhead, 48, 48);
    ph.destroy();

    // 分裂怪：团子 + 中缝裂纹 + 双瞳（一分为二的既视感）
    const sp = this.make.graphics({ x: 0, y: 0 }, false);
    sp.fillStyle(ink, 1);
    sp.fillCircle(c, c, 22.5);
    sp.fillStyle(0xe9f3e2, 1);
    sp.fillCircle(c, c, 19);
    face(sp);
    // 中缝裂纹（从头顶锯齿裂到肚子）
    sp.lineStyle(2.4, ink, 1);
    sp.lineBetween(c + 1, c - 19, c - 3, c - 12);
    sp.lineBetween(c - 3, c - 12, c + 2, c - 5);
    sp.lineBetween(c + 2, c - 5, c - 2, c + 2);
    sp.lineBetween(c - 2, c + 2, c + 1, c + 9);
    sp.lineBetween(c + 1, c + 9, c - 1, c + 17);
    sp.generateTexture(TextureKeys.monsterVariants.splitter, 48, 48);
    sp.destroy();
  }

  /**
   * T-032 宝箱（彩色直接烘焙 + 墨线描边，运行期不 tint）：
   * 棕木箱体 + 金色箍带 + 锁扣，卡通粗描边。
   */
  private makeTreasureChest(): void {
    const { ink, inkSoft } = Palette.art;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // 墨色外轮廓底
    g.fillStyle(ink, 1);
    g.fillRoundedRect(1, 6, 34, 23, 5);
    // 箱体（下半）
    g.fillStyle(0xa9713b, 1);
    g.fillRoundedRect(3, 15, 30, 12, 3);
    // 箱盖（上半，微鼓）
    g.fillStyle(0xc08a4d, 1);
    g.fillRoundedRect(3, 8, 30, 9, 4);
    // 金色箍带 + 锁扣
    g.fillStyle(Palette.accent.gold, 1);
    g.fillRect(16, 7, 6, 21);
    g.fillCircle(19, 19, 3.5);
    g.fillStyle(ink, 1);
    g.fillCircle(19, 20, 1.4);
    // 盖缝
    g.lineStyle(2, inkSoft, 0.8);
    g.lineBetween(3, 15, 33, 15);
    // 外描边
    g.lineStyle(2, ink, 1);
    g.strokeRoundedRect(1, 6, 34, 23, 5);
    g.generateTexture(TextureKeys.treasureChest, 36, 30);
    g.destroy();
  }

  /**
   * T-032 六种无厘头陷阱图标（彩色直接烘焙 + 墨线描边，36×36）。
   * 便便堆 / 电火花 / 水洼 / 香蕉皮 / 妈妈的怒吼(喇叭) / 断网路由器。
   */
  private makeTrapIcons(): void {
    const { ink, inkSoft } = Palette.art;

    // 💩 便便堆：三截叠起来的棕色陀螺
    const poop = this.make.graphics({ x: 0, y: 0 }, false);
    poop.fillStyle(0x8a5a2b, 1);
    poop.fillEllipse(18, 27, 26, 12);
    poop.fillEllipse(18, 19, 18, 10);
    poop.fillEllipse(18, 12, 10, 8);
    poop.lineStyle(2, ink, 1);
    poop.strokeEllipse(18, 27, 26, 12);
    poop.strokeEllipse(18, 19, 18, 10);
    poop.strokeEllipse(18, 12, 10, 8);
    poop.lineStyle(2, ink, 1);
    poop.lineBetween(21, 8, 25, 4); // 顶端小卷
    poop.generateTexture(TextureKeys.trap.poop, 36, 36);
    poop.destroy();

    // ⚡ 电火花：黄色闪电
    const bolt = this.make.graphics({ x: 0, y: 0 }, false);
    bolt.fillStyle(Palette.accent.gold, 1);
    bolt.fillPoints([
      new Phaser.Geom.Point(21, 2),
      new Phaser.Geom.Point(10, 19),
      new Phaser.Geom.Point(17, 19),
      new Phaser.Geom.Point(13, 34),
      new Phaser.Geom.Point(27, 15),
      new Phaser.Geom.Point(19, 15),
    ], true);
    bolt.lineStyle(2, ink, 1);
    bolt.strokePoints([
      new Phaser.Geom.Point(21, 2),
      new Phaser.Geom.Point(10, 19),
      new Phaser.Geom.Point(17, 19),
      new Phaser.Geom.Point(13, 34),
      new Phaser.Geom.Point(27, 15),
      new Phaser.Geom.Point(19, 15),
    ], true);
    bolt.generateTexture(TextureKeys.trap.bolt, 36, 36);
    bolt.destroy();

    // 🌊 水洼：蓝椭圆 + 浅色内圈
    const pud = this.make.graphics({ x: 0, y: 0 }, false);
    pud.fillStyle(0x4fa8e0, 0.9);
    pud.fillEllipse(18, 22, 32, 18);
    pud.lineStyle(2, ink, 1);
    pud.strokeEllipse(18, 22, 32, 18);
    pud.fillStyle(0x9fd8f5, 0.9);
    pud.fillEllipse(14, 20, 12, 6);
    pud.lineStyle(1.5, inkSoft, 0.8);
    pud.strokeEllipse(14, 20, 12, 6);
    pud.generateTexture(TextureKeys.trap.puddle, 36, 36);
    pud.destroy();

    // 🍌 香蕉皮：两瓣黄皮 + 棕色尖头
    const ban = this.make.graphics({ x: 0, y: 0 }, false);
    ban.fillStyle(Palette.accent.gold, 1);
    ban.fillEllipse(15, 20, 20, 10);
    ban.fillEllipse(23, 24, 14, 9);
    ban.lineStyle(2, ink, 1);
    ban.strokeEllipse(15, 20, 20, 10);
    ban.strokeEllipse(23, 24, 14, 9);
    ban.fillStyle(0x8a5a2b, 1);
    ban.fillCircle(6, 18, 3);
    ban.fillCircle(30, 27, 3);
    ban.lineStyle(1.5, ink, 1);
    ban.strokeCircle(6, 18, 3);
    ban.strokeCircle(30, 27, 3);
    ban.generateTexture(TextureKeys.trap.banana, 36, 36);
    ban.destroy();

    // 📢 妈妈的怒吼：橙色喇叭 + 三条声波
    const meg = this.make.graphics({ x: 0, y: 0 }, false);
    meg.fillStyle(Palette.accent.orange, 1);
    meg.fillPoints([
      new Phaser.Geom.Point(6, 14),
      new Phaser.Geom.Point(16, 8),
      new Phaser.Geom.Point(16, 28),
      new Phaser.Geom.Point(6, 22),
    ], true);
    meg.fillRect(16, 8, 5, 20);
    meg.lineStyle(2, ink, 1);
    meg.strokeTriangle(6, 14, 16, 8, 16, 28);
    meg.strokeRect(16, 8, 5, 20);
    meg.lineStyle(2.5, ink, 0.9);
    meg.lineBetween(25, 12, 31, 10);
    meg.lineBetween(26, 18, 33, 18);
    meg.lineBetween(25, 24, 31, 26);
    meg.generateTexture(TextureKeys.trap.megaphone, 36, 36);
    meg.destroy();

    // 📶 断网路由器：灰盒子 + 双天线 + 红灯
    const rt = this.make.graphics({ x: 0, y: 0 }, false);
    rt.fillStyle(0x9aa7b5, 1);
    rt.fillRoundedRect(4, 20, 28, 12, 4);
    rt.lineStyle(2, ink, 1);
    rt.strokeRoundedRect(4, 20, 28, 12, 4);
    rt.lineStyle(2.5, inkSoft, 1);
    rt.lineBetween(10, 20, 6, 8);
    rt.lineBetween(26, 20, 30, 8);
    rt.fillStyle(Palette.status.wrong, 1);
    rt.fillCircle(18, 26, 3);
    rt.lineStyle(1.2, ink, 0.9);
    rt.strokeCircle(18, 26, 3);
    rt.generateTexture(TextureKeys.trap.router, 36, 36);
    rt.destroy();
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

  /**
   * 玩家「热血小勇士」——粗墨线卡通造型（T-030 美术升级）。
   * 朝 +X 为面向（精灵按朝向旋转，脸跟着转向敌人）：头带 + 飘带在后、斗鸡眼大眼 + 呐喊嘴在前。
   * 白灰度贴图运行期 tint：墨线乘任意 tint 仍近似墨色，白色吃满 tint，灰色为暗部——赛璐璐双色调。
   */
  private makePlayer(): void {
    const size = 64;
    const c = size / 2;
    const { ink, inkSoft, shadeGray } = Palette.art;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // 墨色外轮廓（粗描边）+ 暗部基调
    g.fillStyle(ink, 1);
    g.fillCircle(c, c, 29);
    g.fillStyle(shadeGray, 1);
    g.fillCircle(c, c, 25);
    // 主体亮部向前上方偏移，留出底部/后侧的暗部月牙（赛璐璐硬阴影）
    g.fillStyle(0xdfe7ee, 1);
    g.fillCircle(c + 4, c - 4, 23);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(c + 9, c - 10, 9);

    // 头带（后脑白色亮带 + 墨线包边）与两条乱飞的飘带（无厘头担当）
    g.fillStyle(0xffffff, 1);
    g.fillRect(c - 17, c - 17, 8, 34);
    g.lineStyle(2, ink, 1);
    g.strokeRect(c - 17, c - 17, 8, 34);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(c - 16, c - 8, c - 27, c - 13, c - 15, c - 1);
    g.fillTriangle(c - 16, c + 2, c - 26, c + 12, c - 14, c + 9);
    g.lineStyle(1.5, ink, 1);
    g.strokeTriangle(c - 16, c - 8, c - 27, c - 13, c - 15, c - 1);
    g.strokeTriangle(c - 16, c + 2, c - 26, c + 12, c - 14, c + 9);

    // 斗鸡眼大眼（眼白吃满 tint 提亮，瞳孔齐刷刷望向鼻尖——呆）
    for (const eyeY of [c - 9, c + 9]) {
      g.fillStyle(0xffffff, 1);
      g.fillEllipse(c + 10, eyeY, 9, 11);
      g.lineStyle(2, ink, 1);
      g.strokeEllipse(c + 10, eyeY, 9, 11);
    }
    g.fillStyle(ink, 1);
    g.fillCircle(c + 12, c - 8, 2.4);
    g.fillCircle(c + 12, c + 8, 2.4);
    // 怒眉（一高一低，气势拉满）
    g.lineStyle(2.5, ink, 1);
    g.lineBetween(c + 4, c - 17, c + 15, c - 14);
    g.lineBetween(c + 4, c + 15, c + 15, c + 13);
    // 呐喊嘴（张口大招脸）
    g.fillStyle(ink, 1);
    g.fillEllipse(c + 18, c + 1, 10, 8);
    g.fillStyle(0xdfe7ee, 0.9);
    g.fillEllipse(c + 19, c + 2, 4, 2.5);
    // 脸颊腮红点（次级墨线弱化，避免太凶）
    g.lineStyle(1.2, inkSoft, 0.7);
    g.strokeEllipse(c + 22, c - 6, 4, 2);
    g.strokeEllipse(c + 21, c + 9, 4, 2);

    g.generateTexture(TextureKeys.player, size, size);
    g.destroy();
  }

  /** 小怪「呆萌草团怪」：粗墨线钝刺团子 + 一大一小不对称眼 + 龅牙 + 头顶发芽（无厘头三件套） */
  private makeMonster(): void {
    const size = 48;
    const c = size / 2;
    const { ink, inkSoft, shadeGray } = Palette.art;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // 墨色底团（含钝刺）→ 白灰本体（乘 tint 后 = 鲜绿/橙主体 + 墨色粗轮廓）
    this.drawBlooby(g, c, c, 22.5, 23.5, ink, 1);
    this.drawBlooby(g, c, c, 19, 20.5, 0xe9f3e2, 1);
    // 底部赛璐璐暗部（下半弦月）
    g.fillStyle(shadeGray, 0.35);
    g.slice(c, c + 1, 17.5, Math.PI * 0.15, Math.PI * 0.85, false);
    g.fillPath();

    // 不对称呆眼：左眼大（望向左上），右眼小（望向右下）——呆感的核心
    g.fillStyle(0xffffff, 1);
    g.fillCircle(c - 5, c - 4, 6);
    g.fillCircle(c + 7, c - 2, 3.8);
    g.lineStyle(2, ink, 1);
    g.strokeCircle(c - 5, c - 4, 6);
    g.strokeCircle(c + 7, c - 2, 3.8);
    g.fillStyle(ink, 1);
    g.fillCircle(c - 6.5, c - 5.5, 2.6);
    g.fillCircle(c + 8, c - 0.5, 1.7);
    // 眉毛：左眉挑高、右眉压平（「？」脸）
    g.lineStyle(2.2, ink, 1);
    g.lineBetween(c - 11, c - 13, c - 2, c - 11);
    g.lineBetween(c + 4, c - 8, c + 11, c - 9);

    // 龅牙：两颗大白牙挂在嘴线下方
    g.lineStyle(1.8, ink, 1);
    g.lineBetween(c - 6, c + 6, c + 6, c + 7);
    g.fillStyle(0xffffff, 1);
    g.fillRect(c - 4, c + 6, 3.2, 4.6);
    g.fillRect(c + 0.5, c + 6.5, 3.2, 4.6);
    g.lineStyle(1.2, ink, 1);
    g.strokeRect(c - 4, c + 6, 3.2, 4.6);
    g.strokeRect(c + 0.5, c + 6.5, 3.2, 4.6);

    // 头顶发芽：两片小叶（草团怪的尊严）
    g.lineStyle(1.8, ink, 1);
    g.lineBetween(c, c - 20, c, c - 25);
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(c - 4.5, c - 25, 8, 4.5);
    g.fillEllipse(c + 4.5, c - 26, 8, 4.5);
    g.lineStyle(1.2, inkSoft, 1);
    g.strokeEllipse(c - 4.5, c - 25, 8, 4.5);
    g.strokeEllipse(c + 4.5, c - 26, 8, 4.5);

    g.generateTexture(TextureKeys.monster, size, size);
    g.destroy();
  }

  /** 呆萌团子底型：圆身 + n 个钝刺（共享给墨色底与白色本体两层） */
  private drawBlooby(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    inner: number,
    outer: number,
    color: number,
    alpha: number,
  ): void {
    g.fillStyle(color, alpha);
    g.fillCircle(cx, cy, inner);
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const a1 = angle + Math.PI / spikes;
      g.fillTriangle(
        cx + Math.cos(angle) * inner * 0.92, cy + Math.sin(angle) * inner * 0.92,
        cx + Math.cos(a1) * inner * 0.82, cy + Math.sin(a1) * inner * 0.82,
        cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer,
      );
    }
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
   * 三把武器的显示贴图（T-030 卡通粗墨线）：墨色底形包住白色剪影，
   * 统一以「朝右」为 0 度基准，运行期靠 tint 上色；贴图 key 固定为「weapon-」+ 武器 id。
   */
  private makeWeapons(): void {
    const { ink } = Palette.art;

    // 大刀 blade：长条刀身 + 短握柄（墨线包边 + 刃口高光）
    const bl = this.make.graphics({ x: 0, y: 0 }, false);
    bl.fillStyle(ink, 1);
    bl.fillRect(0, 5, 10, 12);
    bl.fillTriangle(7, 1, 55, 7, 7, 17);
    bl.fillStyle(0xffffff, 1);
    bl.fillRect(2, 7, 7, 8);
    bl.fillTriangle(9, 3, 53, 8, 9, 15);
    bl.fillStyle(0xffffff, 0.55);
    bl.fillTriangle(9, 7, 44, 9, 9, 12);
    bl.generateTexture(`${WEAPON_TEXTURE_PREFIX}blade`, 58, 22);
    bl.destroy();

    // 机关枪 smg：紧凑机匣 + 细长枪管 + 弹匣
    const sm = this.make.graphics({ x: 0, y: 0 }, false);
    sm.fillStyle(ink, 1);
    sm.fillRect(1, 4, 18, 12);
    sm.fillRect(17, 6, 21, 7);
    sm.fillRect(5, 14, 8, 10);
    sm.fillStyle(0xffffff, 1);
    sm.fillRect(3, 6, 15, 8);
    sm.fillRect(18, 7, 19, 5);
    sm.fillRect(6, 15, 6, 8);
    sm.generateTexture(`${WEAPON_TEXTURE_PREFIX}smg`, 40, 24);
    sm.destroy();

    // 霰弹枪 scatter：粗短双管 + 枪托
    const sc = this.make.graphics({ x: 0, y: 0 }, false);
    sc.fillStyle(ink, 1);
    sc.fillRect(0, 5, 11, 11);
    sc.fillRect(9, 4, 26, 7);
    sc.fillRect(9, 10, 26, 7);
    sc.fillStyle(0xffffff, 1);
    sc.fillRect(1, 7, 8, 7);
    sc.fillRect(10, 5, 24, 5);
    sc.fillRect(10, 11, 24, 5);
    sc.generateTexture(`${WEAPON_TEXTURE_PREFIX}scatter`, 36, 21);
    sc.destroy();

    // 公式飞盘 boomerang：圆环飞盘（中心镂空 + 两道刻痕），墨线包边
    const bo = this.make.graphics({ x: 0, y: 0 }, false);
    bo.fillStyle(ink, 1);
    bo.fillCircle(18, 18, 16);
    bo.fillStyle(0xffffff, 1);
    bo.fillCircle(18, 18, 13);
    bo.fillStyle(0x000000, 1);
    bo.fillCircle(18, 18, 6);
    bo.lineStyle(2, ink, 1);
    bo.lineBetween(18, 4, 18, 10);
    bo.lineBetween(29, 24, 24, 21);
    bo.generateTexture(`${WEAPON_TEXTURE_PREFIX}boomerang`, 36, 36);
    bo.destroy();

    // 酸液试管 acid：斜试管（管口 + 液面），墨线包边
    const ac = this.make.graphics({ x: 0, y: 0 }, false);
    ac.fillStyle(ink, 1);
    ac.fillTriangle(4, 4, 16, 2, 26, 22);
    ac.fillTriangle(4, 4, 26, 22, 14, 26);
    ac.fillStyle(0xffffff, 1);
    ac.fillTriangle(7, 6, 15, 5, 23, 20);
    ac.fillTriangle(7, 6, 23, 20, 13, 22);
    ac.lineStyle(2, ink, 1);
    ac.lineBetween(3, 3, 15, 1);
    ac.generateTexture(`${WEAPON_TEXTURE_PREFIX}acid`, 30, 28);
    ac.destroy();

    // 单词追踪弹 homing：字母 A 剪影 + 双尾翼
    const hm = this.make.graphics({ x: 0, y: 0 }, false);
    hm.fillStyle(ink, 1);
    hm.fillTriangle(2, 24, 12, 2, 22, 24);
    hm.fillTriangle(8, 24, 12, 12, 16, 24);
    hm.fillStyle(0xffffff, 1);
    hm.fillTriangle(5, 22, 12, 4, 19, 22);
    hm.fillTriangle(9, 22, 12, 14, 15, 22);
    hm.fillStyle(ink, 1);
    hm.fillCircle(12, 19, 3);
    hm.fillTriangle(0, 22, 6, 20, 2, 27);
    hm.fillTriangle(24, 22, 18, 20, 22, 27);
    hm.generateTexture(`${WEAPON_TEXTURE_PREFIX}homing`, 26, 28);
    hm.destroy();
  }

  /**
   * T-025 学霸 BUFF 掉落图标：摊开的书本（墨线包边 + 双开书页 + 中缝与页线）。
   */
  private makeBook(): void {
    const { ink, inkSoft } = Palette.art;
    const w = 26;
    const h = 20;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(ink, 1);
    g.fillRoundedRect(1, 2, 12, 16, 3);
    g.fillRoundedRect(13, 2, 12, 16, 3);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(2, 3, 10, 14, 2);
    g.fillRoundedRect(14, 3, 10, 14, 2);
    // 中缝阴影 + 页面横线
    g.fillStyle(0x000000, 0.3);
    g.fillRect(12, 3, 2, 14);
    g.fillStyle(0x000000, 0.18);
    for (let i = 0; i < 3; i++) {
      g.fillRect(4, 6 + i * 4, 6, 1);
      g.fillRect(16, 6 + i * 4, 6, 1);
    }
    g.lineStyle(1, inkSoft, 0.6);
    g.strokeRoundedRect(2, 3, 10, 14, 2);
    g.strokeRoundedRect(14, 3, 10, 14, 2);
    g.generateTexture(TextureKeys.book, w, h);
    g.destroy();
  }

  /**
   * T-026 躺平 BUFF 掉落图标：横躺胶囊（墨线包边 + 两瓣胶囊 + 分割线 + 高光）。
   */
  private makeLazyCapsule(): void {
    const { ink } = Palette.art;
    const w = 28;
    const h = 16;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(ink, 1);
    g.fillRoundedRect(0, 1, 28, 14, 7);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(2, 3, 24, 10, 5);
    // 中间分割线：两瓣胶囊
    g.fillStyle(0x000000, 0.3);
    g.fillRect(13, 3, 2, 10);
    // 左上高光
    g.fillStyle(0x000000, 0.12);
    g.fillRoundedRect(4, 5, 7, 2, 1);
    g.generateTexture(TextureKeys.lazyCapsule, w, h);
    g.destroy();
  }

  /**
   * T-027 迷你 Boss 底型（fun-event-visual.md §9.1）：白色正圆 + 墨色粗描边 + 底部暗部，
   * 运行期由 ExamSummonSystem 按原 Boss 主题色 tint（表情亦由其运行期绘制）。
   */
  private makeMiniBossBody(): void {
    const { ink, shadeGray } = Palette.art;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(ink, 1);
    g.fillCircle(14, 14, 13);
    g.fillStyle(0xf2f6fa, 1);
    g.fillCircle(14, 14, 10.5);
    g.fillStyle(shadeGray, 0.25);
    g.slice(14, 14, 10, Math.PI * 0.15, Math.PI * 0.85, false);
    g.fillPath();
    g.generateTexture(TextureKeys.miniBoss, 28, 28);
    g.destroy();
  }

  /**
   * T-025 五个 Boss 的专属底型 + T-030 卡通粗墨线升级：
   * 内卷怪=圆角方（格子间工位） / 躺平怪=横躺椭圆 / 语法之王=正圆 /
   * 化合狂魔=六边形（分子感） / 考神=正圆+内环（神性加强）。
   * 全部为白灰度图：墨色粗描边乘 tint 保持墨色，refreshTint 的金→红血量染色照常生效；
   * 每个底型补一道底部赛璐璐暗部，体量感更强（BossVisual 的表情/配件照常叠在其上）。
   */
  private makeBossBodies(): void {
    const { ink, inkSoft, shadeGray } = Palette.art;

    // 内卷怪：圆角方形（格子间工位）
    const sq = this.make.graphics({ x: 0, y: 0 }, false);
    sq.fillStyle(ink, 1);
    sq.fillRoundedRect(2, 2, 88, 88, 14);
    sq.fillStyle(0xf2f6fa, 1);
    sq.fillRoundedRect(7, 7, 78, 78, 11);
    sq.fillStyle(shadeGray, 0.22);
    sq.fillRoundedRect(7, 48, 78, 37, { tl: 0, tr: 0, bl: 11, br: 11 });
    sq.lineStyle(2, inkSoft, 0.35);
    sq.strokeRoundedRect(12, 12, 68, 68, 9);
    sq.generateTexture('tex-boss-square', 92, 92);
    sq.destroy();

    // 躺平怪：横躺椭圆（摊成一团）
    const ov = this.make.graphics({ x: 0, y: 0 }, false);
    ov.fillStyle(ink, 1);
    ov.fillRoundedRect(2, 10, 106, 50, 25);
    ov.fillStyle(0xf2f6fa, 1);
    ov.fillRoundedRect(7, 15, 96, 40, 20);
    ov.fillStyle(shadeGray, 0.22);
    ov.fillRoundedRect(7, 36, 96, 19, { tl: 0, tr: 0, bl: 19, br: 19 });
    ov.generateTexture('tex-boss-oval', 110, 70);
    ov.destroy();

    // 语法之王：正圆（博士头玩家）
    const ci = this.make.graphics({ x: 0, y: 0 }, false);
    ci.fillStyle(ink, 1);
    ci.fillCircle(46, 46, 44);
    ci.fillStyle(0xf2f6fa, 1);
    ci.fillCircle(46, 46, 39);
    ci.fillStyle(shadeGray, 0.22);
    ci.slice(46, 46, 38, Math.PI * 0.12, Math.PI * 0.88, false);
    ci.fillPath();
    ci.generateTexture('tex-boss-circle', 92, 92);
    ci.destroy();

    // 化合狂魔：六边形（分子感）+ 内圈缝线
    const he = this.make.graphics({ x: 0, y: 0 }, false);
    const hexAt = (radius: number): Phaser.Geom.Point[] => {
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        pts.push(new Phaser.Geom.Point(46 + Math.cos(a) * radius, 46 + Math.sin(a) * radius));
      }
      return pts;
    };
    he.fillStyle(ink, 1);
    he.fillPoints(hexAt(45), true);
    he.fillStyle(0xf2f6fa, 1);
    he.fillPoints(hexAt(40), true);
    he.lineStyle(2, inkSoft, 0.35);
    he.strokePoints(hexAt(34), true);
    he.generateTexture('tex-boss-hexagon', 92, 92);
    he.destroy();

    // 考神：正圆 + 内环（神性的层次感）
    const go = this.make.graphics({ x: 0, y: 0 }, false);
    go.fillStyle(ink, 1);
    go.fillCircle(46, 46, 44);
    go.fillStyle(0xf2f6fa, 1);
    go.fillCircle(46, 46, 39);
    go.fillStyle(shadeGray, 0.22);
    go.slice(46, 46, 38, Math.PI * 0.12, Math.PI * 0.88, false);
    go.fillPath();
    go.lineStyle(2, ink, 0.3);
    go.strokeCircle(46, 46, 33);
    go.generateTexture('tex-boss-god', 92, 92);
    go.destroy();
  }
}
