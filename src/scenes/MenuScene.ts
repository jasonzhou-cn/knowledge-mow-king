/**
 * 主菜单场景（src/scenes/MenuScene.ts）
 * 职责：展示标题、玩家成长进度（等级 / 经验 / 累计得分 / 已解锁关卡），
 *      提供关卡选择与「开始游戏」入口，并给出操作说明。
 * 约束：本场景不持有任何游戏状态，所有进度数据均从 ProgressionSystem 读取。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { resolveLevelEntry } from '../config/resolve';
import type { LevelConfig } from '../config/types';
import { describeBank } from '../data/QuestionBank';
import { progression } from '../systems/ProgressionSystem';
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
  private levelText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private startHint!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.drawBackdrop(w, h);

    // 标题
    this.add
      .text(w / 2, 88, '知识割草王', textStyle(64, css(Palette.accent.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5);
    this.add
      .text(w / 2, 140, '答得越准越快，割得越狠越爽', textStyle(22, css(Palette.text.secondary)))
      .setOrigin(0.5);

    // 成长面板
    const panel = this.add.graphics();
    panel.fillStyle(Palette.background.panel, 0.85);
    panel.fillRoundedRect(w / 2 - 240, 178, 480, 132, 14);
    panel.lineStyle(2, Palette.accent.primaryDark, 0.7);
    panel.strokeRoundedRect(w / 2 - 240, 178, 480, 132, 14);

    this.statsText = this.add
      .text(w / 2, 214, '', textStyle(19, css(Palette.text.primary), { align: 'center', lineSpacing: 8 }))
      .setOrigin(0.5, 0);

    // 经验进度条
    const expBar = this.add.graphics();
    const barX = w / 2 - 200;
    const barY = 274;
    const barW = 400;
    const barH = 14;
    expBar.fillStyle(Palette.background.deep, 1);
    expBar.fillRoundedRect(barX, barY, barW, barH, 7);
    expBar.fillStyle(Palette.accent.gold, 1);
    expBar.fillRoundedRect(barX, barY, barW * progression.levelProgress, barH, 7);
    expBar.lineStyle(1, Palette.text.hint, 0.5);
    expBar.strokeRoundedRect(barX, barY, barW, barH, 7);

    // 关卡选择
    this.add
      .text(w / 2 - 150, 336, '◀ 选择关卡 ▶', textStyle(20, css(Palette.text.hint)))
      .setOrigin(0.5, 0);
    this.levelText = this.add
      .text(w / 2 + 130, 332, '', textStyle(24, css(Palette.accent.secondary)))
      .setOrigin(0.5, 0);

    // 开始按钮
    const button = this.add.graphics();
    const btnW = 300;
    const btnH = 66;
    const btnX = w / 2 - btnW / 2;
    const btnY = 392;
    button.fillStyle(Palette.accent.primary, 1);
    button.fillRoundedRect(btnX, btnY, btnW, btnH, 16);
    button.lineStyle(3, Palette.accent.primaryDark, 1);
    button.strokeRoundedRect(btnX, btnY, btnW, btnH, 16);

    const buttonText = this.add
      .text(w / 2, btnY + btnH / 2, '开 始 答 题', textStyle(30, css(Palette.text.onAccent), { fontStyle: 'bold' }))
      .setOrigin(0.5);

    // 按钮热区（比按钮本身更大，照顾 9 岁玩家的点击精度）
    const zone = this.add
      .zone(w / 2, btnY + btnH / 2, btnW + 40, btnH + 24)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => buttonText.setScale(1.06));
    zone.on('pointerout', () => buttonText.setScale(1));
    zone.on('pointerdown', () => {
      popScale(this, buttonText, 1.16, 180);
      ripple(this, w / 2, btnY + btnH / 2, Palette.accent.gold, 160, 420);
      this.startLevel();
    });

    // 操作说明
    this.add
      .text(
        w / 2,
        496,
        '答题：点击屏幕或按空格「停住」选项，让正确答案落在判定框里\n割草：WASD / 方向键移动，技能自动释放',
        textStyle(17, css(Palette.text.hint), { align: 'center', lineSpacing: 6 }),
      )
      .setOrigin(0.5, 0);

    this.startHint = this.add
      .text(w / 2, h - 26, `题库：${describeBank()}`, textStyle(14, css(Palette.text.hint)))
      .setOrigin(0.5);

    this.selectedLevel = progression.unlockedLevel;
    this.refreshStats();

    // 关卡左右切换（限已解锁范围）
    this.input.keyboard?.on('keydown-LEFT', () => this.shiftLevel(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.shiftLevel(1));
    this.input.keyboard?.on('keydown-A', () => this.shiftLevel(-1));
    this.input.keyboard?.on('keydown-D', () => this.shiftLevel(1));
    this.input.keyboard?.on('keydown-SPACE', () => this.startLevel());
    this.input.keyboard?.on('keydown-ENTER', () => this.startLevel());
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

  /** 切换选中的关卡 */
  private shiftLevel(delta: number): void {
    const next = Phaser.Math.Clamp(this.selectedLevel + delta, 1, progression.unlockedLevel);
    if (next === this.selectedLevel) return;
    this.selectedLevel = next;
    this.refreshStats();
  }

  /** 刷新成长信息与关卡名 */
  private refreshStats(): void {
    const levelConfig = ConfigLoader.getInstance().getConfig('levelConfig');
    const entry = resolveLevelEntry(levelConfig as LevelConfig, this.selectedLevel);

    const need = progression.expToNextLevel;
    const needText = Number.isFinite(need) ? `${Math.round(need)}` : '已满级';

    this.statsText.setText(
      `等级 ${progression.level}    经验 ${Math.round(progression.exp)} / ${needText}\n` +
        `累计得分 ${Math.round(progression.totalScore)}    已解锁至第 ${progression.unlockedLevel} 关`,
    );
    this.levelText.setText(`第 ${this.selectedLevel} 关 · ${entry.name}`);
    this.startHint.setY(this.scale.height - 26);
  }

  /** 进入答题场景 */
  private startLevel(): void {
    const data: LevelStartData = { level: this.selectedLevel, bonusTime: 0 };
    this.scene.start('QuestionScene', data);
  }
}
