/**
 * 新手引导遮罩（src/ui/TutorialOverlay.ts）
 * 职责：首次游玩时用 3 步全屏引导讲解核心玩法，零外部素材（Graphics + Text）。
 *
 * 步骤：
 *  1. 答题：金色游标在答案间来回移动，点击屏幕/空格停住选中
 *  2. 答错学习：答错会暂停并展示解题思路，看完点击继续
 *  3. 割草：摇杆走位 + 武器自动攻击，存活到倒计时结束
 *
 * 交互：点击任意位置 / 空格 进入下一步；最后一步完成后回调。
 * 完成状态独立存 localStorage（不污染 ProgressionSystem 存档结构）。
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from './Palette';
import { sfx } from '../systems/SfxController';

const TUTORIAL_KEY = 'knowledge-mow-king.tutorial.v1';

export interface TutorialStep {
  /** 左上角徽标（学科/章节意象） */
  tag: string;
  /** 大标题 */
  title: string;
  /** 正文（可含 \n） */
  body: string;
  /** 图标：'cursor' | 'learn' | 'grass' */
  icon: 'cursor' | 'learn' | 'grass';
}

const STEPS: TutorialStep[] = [
  {
    tag: '第一步 · 答题',
    title: '停住金色游标选答案',
    body: '游标会在四个答案间来回移动，\n答案停在你想要的那个上时，\n点击屏幕或按空格，就能选中它！',
    icon: 'cursor',
  },
  {
    tag: '第二步 · 学习',
    title: '答错也不怕，看解题思路',
    body: '答错后游戏会暂停，\n给你展示这道题的解题思路，\n看完点击屏幕，继续答题！',
    icon: 'learn',
  },
  {
    tag: '第三步 · 割草',
    title: '走位躲怪，武器自动打',
    body: '左下角摇杆控制移动，\n武器会自动攻击靠近的小怪，\n答得越好，割得越爽！',
    icon: 'grass',
  },
];

/** 查询是否已完成新手引导 */
export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === 'done';
  } catch {
    return true; // 隐私模式等异常情况直接跳过引导，不阻断游戏
  }
}

/** 标记引导完成 */
export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, 'done');
  } catch {
    /* 忽略 */
  }
}

export class TutorialOverlay {
  private readonly scene: Phaser.Scene;
  private step = 0;
  private readonly onComplete: () => void;
  private readonly root: Phaser.GameObjects.Container;
  private readonly cardW: number;
  private readonly cardH: number;
  private readonly stepTag: Phaser.GameObjects.Text;
  private readonly stepTitle: Phaser.GameObjects.Text;
  private readonly stepBody: Phaser.GameObjects.Text;
  private readonly stepHint: Phaser.GameObjects.Text;
  private readonly iconGfx: Phaser.GameObjects.Graphics;
  private readonly dots: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, onComplete: () => void) {
    this.scene = scene;
    this.onComplete = onComplete;

    const w = scene.scale.width;
    const h = scene.scale.height;

    this.root = scene.add.container(0, 0).setDepth(3000);

    // 半透明全屏遮罩
    const mask = scene.add.graphics();
    mask.fillStyle(0x050d18, 0.82);
    mask.fillRect(0, 0, w, h);
    this.root.add(mask);

    // 中央卡片
    this.cardW = Math.min(520, w * 0.86);
    this.cardH = Math.min(360, h * 0.72);
    const card = scene.add.graphics();
    card.fillStyle(Palette.background.panel, 0.98);
    card.fillRoundedRect(w / 2 - this.cardW / 2, h / 2 - this.cardH / 2, this.cardW, this.cardH, 18);
    card.lineStyle(3, Palette.accent.gold, 0.9);
    card.strokeRoundedRect(w / 2 - this.cardW / 2, h / 2 - this.cardH / 2, this.cardW, this.cardH, 18);
    this.root.add(card);

    this.iconGfx = scene.add.graphics();
    this.root.add(this.iconGfx);

    this.stepTag = scene.add
      .text(w / 2, h / 2 - this.cardH / 2 + 30, '', textStyle(16, css(Palette.accent.secondary)))
      .setOrigin(0.5, 0);
    this.root.add(this.stepTag);

    this.stepTitle = scene.add
      .text(w / 2, h / 2 - 70, '', textStyle(30, css(Palette.accent.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5, 0.5);
    this.root.add(this.stepTitle);

    this.stepBody = scene.add
      .text(w / 2, h / 2 + 30, '', textStyle(20, css(Palette.text.primary), {
        align: 'center',
        lineSpacing: 10,
        wordWrap: { width: this.cardW - 48 },
      }))
      .setOrigin(0.5, 0.5);
    this.root.add(this.stepBody);

    this.dots = scene.add.graphics();
    this.root.add(this.dots);

    this.stepHint = scene.add
      .text(w / 2, h / 2 + this.cardH / 2 - 30, '', textStyle(17, css(Palette.text.hint)))
      .setOrigin(0.5, 0.5);
    this.root.add(this.stepHint);

    this.renderStep();

    // 输入：点击 / 空格 进入下一步或完成。
    // 延迟一帧（next tick）注册输入监听，避免「点开始按钮」与「overlay 首次渲染」
    // 的同一 pointerdown 事件被 overlay 误接收，导致步骤直接跳过第一步。
    scene.time.delayedCall(60, () => {
      scene.input.on('pointerdown', this.handleNext, this);
      scene.input.keyboard?.on('keydown-SPACE', this.handleNext, this);
    });
  }

  private handleNext(): void {
    sfx.play('stop');
    this.step++;
    if (this.step >= STEPS.length) {
      this.finish();
    } else {
      this.renderStep();
    }
  }

  private renderStep(): void {
    const s = STEPS[this.step];
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    this.stepTag.setText(s.tag);
    this.stepTitle.setText(s.title);
    this.stepBody.setText(s.body);
    this.stepHint.setText(
      this.step === STEPS.length - 1 ? '点击任意位置 或 按空格 开始游玩' : '点击任意位置 或 按空格 继续',
    );

    // 图标（程序化绘制）
    const g = this.iconGfx;
    g.clear();
    const cx = w / 2;
    const cy = h / 2 - 115;
    if (s.icon === 'cursor') {
      // 金色游标框 + 左右箭头
      g.fillStyle(Palette.accent.gold, 0.12);
      g.fillRoundedRect(cx - 70, cy - 26, 140, 52, 10);
      g.lineStyle(3, Palette.accent.gold, 1);
      g.strokeRoundedRect(cx - 70, cy - 26, 140, 52, 10);
      g.fillStyle(Palette.accent.gold, 1);
      g.fillTriangle(cx - 34, cy - 6, cx - 18, cy - 6, cx - 26, cy - 20);
      g.fillTriangle(cx + 34, cy + 6, cx + 18, cy + 6, cx + 26, cy + 20);
    } else if (s.icon === 'learn') {
      // 书本 + ✓
      g.fillStyle(0x7ec8ff, 0.9);
      g.fillRoundedRect(cx - 36, cy - 28, 72, 56, 6);
      g.lineStyle(3, Palette.background.deep, 1);
      g.lineBetween(cx, cy - 28, cx, cy + 28);
      g.lineStyle(5, Palette.status.correctDark, 1);
      g.lineBetween(cx - 18, cy + 2, cx - 8, cy + 14);
      g.lineBetween(cx - 8, cy + 14, cx + 20, cy - 14);
    } else {
      // 摇杆 + 星星
      g.fillStyle(Palette.text.hint, 0.25);
      g.fillCircle(cx - 28, cy + 14, 34);
      g.fillStyle(Palette.text.primary, 0.8);
      g.fillCircle(cx - 28, cy + 14, 14);
      g.fillStyle(Palette.accent.gold, 1);
      g.fillTriangle(cx + 26, cy - 26, cx + 40, cy - 10, cx + 12, cy - 12);
      g.fillTriangle(cx + 44, cy - 34, cx + 56, cy - 22, cx + 34, cy - 22);
    }

    // 步骤圆点
    this.dots.clear();
    for (let i = 0; i < STEPS.length; i++) {
      const dx = cx - 24 + i * 24;
      const dy = h / 2 + this.cardH / 2 - 62;
      if (i === this.step) {
        this.dots.fillStyle(Palette.accent.gold, 1);
        this.dots.fillCircle(dx, dy, 6);
      } else {
        this.dots.fillStyle(Palette.text.hint, 0.45);
        this.dots.fillCircle(dx, dy, 4.5);
      }
    }
  }

  private finish(): void {
    markTutorialDone();
    this.scene.input.off('pointerdown', this.handleNext, this);
    this.scene.input.keyboard?.off('keydown-SPACE', this.handleNext, this);
    this.root.destroy();
    this.onComplete();
  }
}