/**
 * 主菜单场景（src/scenes/MenuScene.ts）
 * 职责：展示标题、玩家成长进度（等级 / 经验 / 累计得分 / 已解锁关卡），
 *      提供关卡选择与「开始游戏」入口，并给出操作说明。
 * 约束：本场景不持有任何游戏状态，所有进度数据均从 ProgressionSystem 读取。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import type { LevelConfig } from '../config/types';
import { describeBank } from '../data/QuestionBank';
import { progression } from '../systems/ProgressionSystem';
import { playtime } from '../systems/PlaytimeSystem';
import { bgm } from '../systems/BgmController';
import { isTutorialDone, TutorialOverlay } from '../ui/TutorialOverlay';
import { LevelSelectPanel } from '../ui/LevelSelectPanel';
import { AchievementsPanel } from '../ui/AchievementsPanel';
import { RestOverlay } from '../ui/RestOverlay';
import { Palette, css, textStyle } from '../ui/Palette';
import { popScale, ripple } from '../ui/Feedback';

/** 进入关卡时跨场景传递的数据 */
export interface LevelStartData {
  /** 目标关卡号 */
  level: number;
  /** 上一关结算发放的游戏时间奖励（秒），会累加到本关割草时长 */
  bonusTime?: number;
}

export class MenuScene extends Phaser.Scene {
  /** 当前选中的关卡号 */
  private selectedLevel = 1;
  private levelPanel!: LevelSelectPanel;
  private statsText!: Phaser.GameObjects.Text;
  private startHint!: Phaser.GameObjects.Text;
  /** 防沉迷休息遮罩（存续期间阻断一切入口） */
  private restOverlay: RestOverlay | null = null;
  /** 成就面板（存续期间阻断开始/切关入口） */
  private achievementsPanel: AchievementsPanel | null = null;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.drawBackdrop(w, h);

    // viewport 缩放：方案 C 下把 UI 字号/位置按 viewport 与 960×640 的最小比缩放
    // 让菜单在 1024×540 窄屏或 2340×1080 全面屏上都能合理铺满
    const s = Math.min(w / 960, h / 640);
    // 整组 UI 整体居中：以 viewport 中心为锚点，所有 y 位置改为相对中心的偏移
    const cx = w / 2;
    const cy = h / 2;

    // 标题
    this.add
      .text(cx, cy - 200 * s, '知识割草王', textStyle(Math.round(64 * s), css(Palette.accent.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5);
    this.add
      .text(cx, cy - 148 * s, '答得越准越快，割得越狠越爽', textStyle(Math.round(22 * s), css(Palette.text.secondary)))
      .setOrigin(0.5);

    // 成长面板
    const panel = this.add.graphics();
    const panelW = 480 * s, panelH = 132 * s;
    panel.fillStyle(Palette.background.panel, 0.85);
    panel.fillRoundedRect(cx - panelW / 2, cy - 110 * s, panelW, panelH, 14);
    panel.lineStyle(2, Palette.accent.primaryDark, 0.7);
    panel.strokeRoundedRect(cx - panelW / 2, cy - 110 * s, panelW, panelH, 14);

    this.statsText = this.add
      .text(cx, cy - 74 * s, '', textStyle(Math.round(19 * s), css(Palette.text.primary), { align: 'center', lineSpacing: 8 }))
      .setOrigin(0.5, 0);

    // 经验进度条
    const expBar = this.add.graphics();
    const barX = cx - 200 * s;
    const barY = cy - 14 * s;
    const barW = 400 * s;
    const barH = 14 * s;
    expBar.fillStyle(Palette.background.deep, 1);
    expBar.fillRoundedRect(barX, barY, barW, barH, 7);
    expBar.fillStyle(Palette.accent.gold, 1);
    expBar.fillRoundedRect(barX, barY, barW * progression.levelProgress, barH, 7);
    expBar.lineStyle(1, Palette.text.hint, 0.5);
    expBar.strokeRoundedRect(barX, barY, barW, barH, 7);

    // 先设 selectedLevel（确保关卡地图拿到正确的 unlockedLevel 默认页）
    this.selectedLevel = progression.unlockedLevel;

    // 关卡选择：可视化关卡地图（T-019，替代原「◀ 选择关卡 ▶」文字行）
    this.levelPanel = new LevelSelectPanel(this, {
      levels: (ConfigLoader.getInstance().getConfig('levelConfig') as LevelConfig).levels,
      unlockedLevel: progression.unlockedLevel,
      selectedLevel: this.selectedLevel,
      onChange: (level) => {
        this.selectedLevel = level;
        this.refreshStats();
      },
    });

    // 开始按钮
    const button = this.add.graphics();
    const btnW = 300 * s;
    const btnH = 66 * s;
    const btnX = cx - btnW / 2;
    const btnY = cy + 104 * s;
    button.fillStyle(Palette.accent.primary, 1);
    button.fillRoundedRect(btnX, btnY, btnW, btnH, 16);
    button.lineStyle(3, Palette.accent.primaryDark, 1);
    button.strokeRoundedRect(btnX, btnY, btnW, btnH, 16);

    const buttonText = this.add
      .text(cx, btnY + btnH / 2, '开 始 答 题', textStyle(Math.round(30 * s), css(Palette.text.onAccent), { fontStyle: 'bold' }))
      .setOrigin(0.5);

    // 按钮热区（比按钮本身更大，照顾 9 岁玩家的点击精度）
    const zone = this.add
      .zone(cx, btnY + btnH / 2, btnW + 40 * s, btnH + 24 * s)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => buttonText.setScale(1.06));
    zone.on('pointerout', () => buttonText.setScale(1));
    zone.on('pointerdown', () => {
      popScale(this, buttonText, 1.16, 180);
      ripple(this, cx, btnY + btnH / 2, Palette.accent.gold, 160, 420);
      this.startLevel();
    });

    // 操作说明
    this.add
      .text(
        cx,
        cy + 208 * s,
        '答题：点击屏幕或按空格「停住」选项，让正确答案落在判定框里\n割草：WASD / 方向键移动，技能自动释放',
        textStyle(Math.round(17 * s), css(Palette.text.hint), { align: 'center', lineSpacing: 6 }),
      )
      .setOrigin(0.5, 0);

    this.startHint = this.add
      .text(cx, h - 26 * s, `题库：${describeBank()}`, textStyle(Math.round(14 * s), css(Palette.text.hint)))
      .setOrigin(0.5);

    // 成就 / 图鉴 / 记录入口（开始按钮左下，尺寸随 vpScale）
    const achX = cx - btnW / 2;
    const achY = btnY + btnH + 34 * s;
    const achW = 150 * s;
    const achH = 40 * s;
    const achBg = this.add.graphics();
    achBg.fillStyle(Palette.background.panelSoft, 1);
    achBg.fillRoundedRect(achX - achW / 2, achY - achH / 2, achW, achH, 10);
    achBg.lineStyle(2, Palette.accent.gold, 0.6);
    achBg.strokeRoundedRect(achX - achW / 2, achY - achH / 2, achW, achH, 10);
    const achText = this.add
      .text(achX, achY, '成就 · 图鉴', textStyle(Math.round(18 * s), css(Palette.accent.gold)))
      .setOrigin(0.5);
    const achZone = this.add
      .zone(achX, achY, achW + 16, achH + 12)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    achZone.on('pointerdown', () => {
      if (this.isBlocked()) return;
      popScale(this, achText, 1.12, 160);
      this.achievementsPanel = new AchievementsPanel(this, () => {
        this.achievementsPanel = null;
      });
    });

    this.selectedLevel = progression.unlockedLevel;
    this.refreshStats();

    // T-025：场景切换 fade 过渡（时长来自配置）
    this.cameras.main.fadeIn(
      ConfigLoader.getInstance().getConfig('grassCuttingConfig').polishSettings.sceneFadeInMs,
      0, 0, 0,
    );

    // 关卡左右切换（限已解锁范围）
    this.input.keyboard?.on('keydown-LEFT', () => this.shiftLevel(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.shiftLevel(1));
    this.input.keyboard?.on('keydown-A', () => this.shiftLevel(-1));
    this.input.keyboard?.on('keydown-D', () => this.shiftLevel(1));
    this.input.keyboard?.on('keydown-SPACE', () => this.startLevel());
    this.input.keyboard?.on('keydown-ENTER', () => this.startLevel());

    // BGM：主菜单轨道（AudioContext 受自动播放策略约束，首次交互后自动出声）
    bgm.play('menu');

    // 防沉迷：进入主菜单时若已达连续游玩上限（或刷新页面绕不过的持久化记录），
    // 直接弹全屏休息遮罩，倒计时结束前一切入口被阻断
    if (playtime.shouldRest) {
      this.showRestOverlay();
    }
  }

  /** 遮罩/面板存续期间阻断全部游戏入口 */
  private isBlocked(): boolean {
    return this.restOverlay !== null || this.achievementsPanel !== null;
  }

  /** 展示强制休息遮罩（关闭前 isBlocked 恒真） */
  private showRestOverlay(): void {
    if (this.restOverlay) return;
    this.restOverlay = new RestOverlay(this, () => {
      this.restOverlay = null;
    });
  }

  /** 场景销毁时清理浮层，避免下一局复用实例时残留 */
  shutdown(): void {
    this.restOverlay?.destroy();
    this.restOverlay = null;
    this.achievementsPanel?.destroy();
    this.achievementsPanel = null;
  }

  /** 绘制背景：草地 + 网格，纯图形生成 */
  private drawBackdrop(w: number, h: number): void {
    const g = this.add.graphics();
    g.fillStyle(Palette.background.deep, 1);
    g.fillRect(0, 0, w, h);

    // 远景草地条带，强化「割草」主题
    g.fillStyle(Palette.background.grassField, 1);
    g.fillRect(0, h - 150, w, 150);
    g.fillStyle(Palette.background.grassFieldAlt, 1);
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * w;
      g.fillTriangle(x, h - 150, x + 40, h - 150, x + 20, h - 190);
    }

    // 网格装饰
    g.lineStyle(1, Palette.background.panelSoft, 0.25);
    for (let x = 0; x <= w; x += 60) g.lineBetween(x, 0, x, h - 150);
    for (let y = 0; y <= h - 150; y += 60) g.lineBetween(0, y, w, y);
  }

  /** 切换选中的关卡（转发给关卡地图面板，处理页内跳转） */
  private shiftLevel(delta: number): void {
    if (this.isBlocked()) return;
    this.levelPanel?.shiftSelected(delta);
  }

  /** 刷新成长信息并同步关卡地图选中态 */
  private refreshStats(): void {
    const need = progression.expToNextLevel;
    const needText = Number.isFinite(need) ? `${Math.round(need)}` : '已满级';

    this.statsText.setText(
      `等级 ${progression.level}    经验 ${Math.round(progression.exp)} / ${needText}\n` +
        `累计得分 ${Math.round(progression.totalScore)}    已解锁至第 ${progression.unlockedLevel} 关`,
    );
    this.levelPanel?.refresh(progression.unlockedLevel, this.selectedLevel);
    this.startHint.setY(this.scale.height - 26 * Math.min(this.scale.width / 960, this.scale.height / 640));
  }

  /** 进入答题场景（首次游玩先展示新手引导 T-017；防沉迷倒计时期间阻断） */
  private startLevel(): void {
    if (this.isBlocked()) return;
    // 连玩时长在主菜单停留期间到期 → 现场弹休息遮罩
    if (playtime.shouldRest) {
      this.showRestOverlay();
      return;
    }
    const data: LevelStartData = { level: this.selectedLevel, bonusTime: 0 };
    if (isTutorialDone()) {
      this.scene.start('QuestionScene', data);
      return;
    }
    // 首次进入：3 步引导讲解玩法，完成后真正进入答题
    new TutorialOverlay(this, () => {
      this.scene.start('QuestionScene', data);
    });
  }
}
