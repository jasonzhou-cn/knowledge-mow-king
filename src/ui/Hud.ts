/**
 * 场景内 HUD 组件（src/ui/Hud.ts）
 * 职责：统一构建割草场景的「血条 / 倒计时 / 得分 / 连击 / 等级 / 加成乘数」显示条，
 *      以及答题场景的「题号 / 连对 / 限时进度条」头部。
 * 约束：HUD 只做展示，不持有任何游戏状态（所有数值由场景每帧 push 进来）。
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from './Palette';
import { clamp01, formatClock } from '../utils/MathUtil';

/** 割草场景 HUD 的构建参数 */
export interface CombatHudOptions {
  width: number;
  height: number;
  maxHp: number;
  gameTime: number;
  level: number;
  levelName: string;
  /**
   * 底部加成文案的左起始 x：
   *  - 提供：放在指定 x（场景传避让后的位置）
   *  - 不提供：默认放在屏幕水平居中（武器栏正下方），不与摇杆冲突
   */
  bottomTextX?: number;
}

/**
 * 割草场景 HUD。
 * 全部使用纯图形 + 文本绘制，不依赖任何外部素材。
 */
export class CombatHud {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly hpBarFill: Phaser.GameObjects.Graphics;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly bonusText: Phaser.GameObjects.Text;
  private readonly timeBarFill: Phaser.GameObjects.Graphics;

  private hp = 0;
  private maxHp = 1;
  private timeLeft = 0;
  private totalTime = 1;

  constructor(private readonly scene: Phaser.Scene, opts: CombatHudOptions) {
    this.maxHp = Math.max(1, opts.maxHp);
    this.hp = this.maxHp;
    this.totalTime = Math.max(1, opts.gameTime);
    this.timeLeft = this.totalTime;

    const w = opts.width;

    // 顶部半透明底板，保证 HUD 在任何背景上都可读
    this.bg = scene.add.graphics().setDepth(1000);
    this.bg.fillStyle(Palette.background.deep, 0.72);
    this.bg.fillRect(0, 0, w, 64);
    this.bg.lineStyle(2, Palette.accent.primaryDark, 0.5);
    this.bg.lineBetween(0, 64, w, 64);

    this.hpBarFill = scene.add.graphics().setDepth(1001);
    this.timeBarFill = scene.add.graphics().setDepth(1001);

    this.levelText = scene.add
      .text(16, 10, `第 ${opts.level} 关 · ${opts.levelName}`, textStyle(18, css(Palette.accent.secondary)))
      .setDepth(1002);

    this.hpText = scene.add
      .text(16, 36, '', textStyle(15, css(Palette.text.secondary)))
      .setDepth(1002);

    this.timeText = scene.add
      .text(w / 2, 12, '', textStyle(30, css(Palette.text.primary)))
      .setOrigin(0.5, 0)
      .setDepth(1002);

    this.scoreText = scene.add
      .text(w - 16, 10, '得分 0', textStyle(20, css(Palette.accent.gold)))
      .setOrigin(1, 0)
      .setDepth(1002);

    this.comboText = scene.add
      .text(w - 16, 38, '', textStyle(16, css(Palette.accent.secondary)))
      .setOrigin(1, 0)
      .setDepth(1002);

    // 底部加成文案：默认屏幕水平居中（武器栏正下方居中，方案 C 19.5:9 下呼吸感更好）；
    // 场景可传 bottomTextX 显式覆盖（触屏有摇杆时由场景计算避让后位置）
    const bonusX = opts.bottomTextX !== undefined ? opts.bottomTextX : w / 2;
    const bonusOrigin = opts.bottomTextX !== undefined ? 0 : 0.5;
    this.bonusText = scene.add
      .text(bonusX, opts.height - 116, '', textStyle(15, css(Palette.text.hint)))
      .setOrigin(bonusOrigin, 1)
      .setDepth(1002);

    this.redrawHp();
    this.redrawTime();
    this.updateScore(0);
    this.updateCombo(0);
  }

  /** 更新血量显示 */
  setHp(current: number): void {
    this.hp = Math.max(0, current);
    this.redrawHp();
  }

  /** 更新剩余时间与倒计时进度条 */
  setTimeLeft(seconds: number): void {
    this.timeLeft = Math.max(0, seconds);
    this.redrawTime();
  }

  /** 更新得分 */
  updateScore(score: number): void {
    this.scoreText.setText(`得分 ${Math.round(score)}`);
  }

  /** 更新连击显示，1 连击（即无连击）时不显示 */
  updateCombo(combo: number): void {
    this.comboText.setText(combo >= 2 ? `连击 ×${combo}` : '');
    if (combo >= 2) {
      this.comboText.setColor(css(Palette.accent.gold));
    } else {
      this.comboText.setColor(css(Palette.accent.secondary));
    }
  }

  /**
   * 展示本轮答题带来的三项割草乘数，让玩家感知「答得好→割得爽」。
   * 第三项的落点是「攻速」：答题持续乘数作为武器冷却的除数，答得越好出手越快。
   */
  setBonus(damage: number, range: number, duration: number): void {
    this.bonusText.setText(
      `答题加成  伤害 ×${damage.toFixed(2)}   范围 ×${range.toFixed(2)}   攻速 ×${duration.toFixed(2)}`,
    );
  }

  /** 倒计时进入危险区时的视觉告警 */
  setTimeWarning(active: boolean): void {
    this.timeText.setColor(active ? css(Palette.status.wrong) : css(Palette.text.primary));
  }

  /** 重绘血条 */
  private redrawHp(): void {
    const x = 16;
    const y = 58;
    const w = 200;
    const h = 12;
    const ratio = clamp01(this.hp / this.maxHp);

    this.hpBarFill.clear();
    this.hpBarFill.fillStyle(Palette.combat.hpBarBg, 1);
    this.hpBarFill.fillRoundedRect(x, y, w, h, 6);
    if (ratio > 0) {
      // 血量低于 30% 时转为红色告警
      const color = ratio < 0.3 ? Palette.status.wrong : Palette.status.correct;
      this.hpBarFill.fillStyle(color, 1);
      this.hpBarFill.fillRoundedRect(x, y, w * ratio, h, 6);
    }
    this.hpBarFill.lineStyle(1, Palette.text.hint, 0.6);
    this.hpBarFill.strokeRoundedRect(x, y, w, h, 6);

    this.hpText.setText(`生命 ${Math.ceil(this.hp)} / ${Math.round(this.maxHp)}`);
  }

  /** 重绘倒计时与其进度条 */
  private redrawTime(): void {
    const w = this.scene.scale.width;
    this.timeText.setText(formatClock(this.timeLeft));

    const barW = 260;
    const barH = 8;
    const x = (w - barW) / 2;
    const y = 48;
    const ratio = clamp01(this.timeLeft / this.totalTime);

    this.timeBarFill.clear();
    this.timeBarFill.fillStyle(Palette.background.panel, 1);
    this.timeBarFill.fillRoundedRect(x, y, barW, barH, 4);
    this.timeBarFill.fillStyle(ratio < 0.2 ? Palette.status.wrong : Palette.accent.primary, 1);
    this.timeBarFill.fillRoundedRect(x, y, barW * ratio, barH, 4);
  }

  /** 场景销毁时清理全部显示对象 */
  destroy(): void {
    this.bg.destroy();
    this.hpBarFill.destroy();
    this.timeBarFill.destroy();
    this.timeText.destroy();
    this.hpText.destroy();
    this.scoreText.destroy();
    this.comboText.destroy();
    this.levelText.destroy();
    this.bonusText.destroy();
  }
}

/** 答题场景头部 HUD 的构建参数 */
export interface QuizHudOptions {
  width: number;
  total: number;
  timeLimit: number;
}

/**
 * 答题场景头部：题号进度、当前连对、剩余时间进度条。
 * 连对进度与奖励门槛实时可见，满足 GDD 2.4 奖励规则透明化要求。
 */
export class QuizHud {
  private readonly progressText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barWidth = 320;

  constructor(private readonly scene: Phaser.Scene, opts: QuizHudOptions) {
    const w = opts.width;

    this.progressText = scene.add
      .text(20, 14, `第 1 / ${opts.total} 题`, textStyle(20, css(Palette.text.primary)))
      .setDepth(1002);

    this.comboText = scene.add
      .text(w - 20, 14, '连对 0', textStyle(20, css(Palette.accent.gold)))
      .setOrigin(1, 0)
      .setDepth(1002);

    this.timeText = scene.add
      .text(w / 2, 46, '', textStyle(22, css(Palette.accent.secondary)))
      .setOrigin(0.5, 0)
      .setDepth(1002);

    this.bar = scene.add.graphics().setDepth(1002);
  }

  /** 更新题号进度 */
  setProgress(current: number, total: number): void {
    this.progressText.setText(`第 ${current} / ${total} 题`);
  }

  /** 更新连对数与下一次奖励门槛 */
  setCombo(combo: number, nextThreshold: number | null): void {
    if (nextThreshold === null) {
      this.comboText.setText(`连对 ${combo}（已满档）`);
    } else {
      this.comboText.setText(`连对 ${combo} · 再对 ${Math.max(1, nextThreshold - combo)} 题得奖励`);
    }
  }

  /** 更新剩余时间与进度条 */
  setTimeLeft(seconds: number, total: number): void {
    this.timeText.setText(`${seconds.toFixed(1)}s`);
    const ratio = clamp01(seconds / Math.max(0.1, total));
    const w = this.scene.scale.width;
    const x = (w - this.barWidth) / 2;
    const y = 76;

    this.bar.clear();
    this.bar.fillStyle(Palette.background.panel, 1);
    this.bar.fillRoundedRect(x, y, this.barWidth, 10, 5);
    this.bar.fillStyle(ratio < 0.25 ? Palette.status.wrong : Palette.accent.primary, 1);
    this.bar.fillRoundedRect(x, y, this.barWidth * ratio, 10, 5);

    this.timeText.setColor(ratio < 0.25 ? css(Palette.status.wrong) : css(Palette.accent.secondary));
  }

  destroy(): void {
    this.progressText.destroy();
    this.comboText.destroy();
    this.timeText.destroy();
    this.bar.destroy();
  }
}
