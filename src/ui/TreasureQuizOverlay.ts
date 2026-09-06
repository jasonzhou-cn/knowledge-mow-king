/**
 * 宝物快问快答浮层（src/ui/TreasureQuizOverlay.ts，T-032 小朋友试玩反馈）
 * 职责：拾起宝箱后弹出「一道题 + 限时选择」的全屏浮层。
 *  - 答对 → 随机获得一种限时加成（攻击/攻速/移速/范围/回血，由场景应用）；
 *  - 答错/超时 → 宝物失效（无加成），不打断节奏。
 *
 * 世界冻结由场景负责（update 提前返回）；浮层自身用 scene.time 计时（不受影响）。
 * 屏幕空间层：每个对象独立 setScrollFactor(0)——**刻意不用 Container**：
 * 相机滚动下 Container 内交互热区的命中计算不随容器 scrollFactor 变换（Phaser 已知怪癖），
 * 会导致点击偏移；平铺对象 + 各自 scrollFactor(0) 则输入/渲染都在同一屏幕空间。
 */

import Phaser from 'phaser';
import type { DrawnQuestion } from '../data/QuestionBank';
import { css, textStyle, Palette } from './Palette';
import { createFittedText, refitText } from './FitText';

export interface TreasureQuizOptions {
  question: DrawnQuestion;
  /** 学科展示名 */
  subjectName: string;
  timeSec: number;
  /** 答题结束回调（correct = 是否答对；超时按答错） */
  onDone: (correct: boolean) => void;
}

export class TreasureQuizOverlay {
  private readonly scene: Phaser.Scene;
  private readonly opts: TreasureQuizOptions;
  /** 全部创建的对象（销毁用） */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly questionText: Phaser.GameObjects.Text;
  private readonly optionTexts: Phaser.GameObjects.Text[] = [];
  private readonly timerEvent: Phaser.Time.TimerEvent;
  private readonly baseFontSize: number;
  private remain: number;
  private settled = false;

  constructor(scene: Phaser.Scene, opts: TreasureQuizOptions) {
    this.scene = scene;
    this.opts = opts;
    this.remain = opts.timeSec;

    const w = scene.scale.width;
    const h = scene.scale.height;
    const s = Math.min(w / 960, h / 640);

    const dim = scene.add.graphics().setDepth(3500).setScrollFactor(0);
    dim.fillStyle(Palette.background.deep, 0.82);
    dim.fillRect(0, 0, w, h);
    this.objects.push(dim);

    const panelW = Math.min(w * 0.86, 1100);
    const panelH = Math.min(h * 0.78, 560);
    const left = (w - panelW) / 2;
    const top = (h - panelH) / 2;
    const panel = scene.add.graphics().setDepth(3501).setScrollFactor(0);
    panel.fillStyle(Palette.background.panel, 0.98);
    panel.fillRoundedRect(left, top, panelW, panelH, 18);
    panel.lineStyle(3, Palette.accent.gold, 0.85);
    panel.strokeRoundedRect(left, top, panelW, panelH, 18);
    this.objects.push(panel);

    const title = scene.add
      .text(
        w / 2,
        top + 18 * s,
        '🎁 宝物快问快答 · ' + opts.subjectName + '（答对获得神秘加成！）',
        textStyle(Math.round(22 * s), css(Palette.accent.gold), { fontStyle: 'bold' }),
      )
      .setOrigin(0.5, 0)
      .setDepth(3502)
      .setScrollFactor(0);
    this.objects.push(title);

    this.baseFontSize = Math.round(26 * s);
    this.questionText = scene.add
      .text(0, 0, '', textStyle(this.baseFontSize, css(Palette.text.primary), {
        align: 'center',
        wordWrap: { width: panelW - 60 * s, useAdvancedWrap: true },
      }))
      .setOrigin(0.5, 0.5)
      .setDepth(3502)
      .setScrollFactor(0);
    this.objects.push(this.questionText);
    refitText(this.questionText, opts.question.question, {
      maxHeight: 120 * s,
      baseSize: this.baseFontSize,
      minSize: 16,
    });
    this.questionText.setPosition(w / 2, top + 74 * s + this.questionText.height / 2);

    // 选项按钮：2×2 网格，大热区（触屏友好）；热区直接平铺在场景里（输入零偏移）
    const cols = 2;
    const cellW = (panelW - 60 * s) / cols;
    const cellH = 64 * s;
    const gridTop = top + 150 * s;
    opts.question.options.forEach((opt, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = left + 30 * s + col * cellW + cellW / 2;
      const cy = gridTop + row * (cellH + 18 * s) + cellH / 2;

      const bg = scene.add.graphics().setDepth(3502).setScrollFactor(0);
      bg.fillStyle(Palette.background.panelSoft, 1);
      bg.fillRoundedRect(cx - cellW / 2 + 8 * s, cy - cellH / 2, cellW - 16 * s, cellH, 12);
      bg.lineStyle(2.5, Palette.accent.primary, 0.9);
      bg.strokeRoundedRect(cx - cellW / 2 + 8 * s, cy - cellH / 2, cellW - 16 * s, cellH, 12);

      const label = createFittedText(scene, opt, {
        color: css(Palette.text.primary),
        wrapWidth: cellW - 40 * s,
        maxHeight: cellH - 12 * s,
        baseSize: Math.max(15, Math.round(cellH * 0.32)),
      });
      label.setPosition(cx, cy).setOrigin(0.5, 0.5).setDepth(3503).setScrollFactor(0);
      this.optionTexts.push(label);

      const zone = scene.add
        .zone(cx, cy, cellW, cellH + 16 * s)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(3504)
        .setScrollFactor(0);
      zone.on('pointerdown', () => this.settle(i === opts.question.answerIndex));

      this.objects.push(bg, label, zone);
    });

    this.timeText = scene.add
      .text(w / 2, top + panelH - 30 * s, '', textStyle(Math.round(24 * s), css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setDepth(3502)
      .setScrollFactor(0);
    this.objects.push(this.timeText);
    this.refreshTimeText();

    this.timerEvent = scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.tick(),
    });
  }

  /** 答题是否仍在进行（场景据此保持世界冻结；结算瞬间即恢复） */
  get isActive(): boolean {
    return !this.settled;
  }

  private tick(): void {
    if (this.settled) return;
    this.remain -= 0.5;
    this.refreshTimeText();
    if (this.remain <= 0) this.settle(false);
  }

  private refreshTimeText(): void {
    this.timeText.setText('⏳ ' + Math.max(0, Math.ceil(this.remain)) + 's');
    this.timeText.setColor(this.remain <= 3 ? css(Palette.status.wrong) : css(Palette.accent.secondary));
  }

  /** 结算：只允许结算一次；场景立即恢复（加成即时生效），提示文字自行消散 */
  private settle(correct: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.timerEvent.remove();

    const done = this.scene.add
      .text(
        this.scene.scale.width / 2,
        this.scene.scale.height / 2 + 40,
        correct ? '✓ 答对了！宝物加成到手！' : '✕ 没答对，宝物溜走了…',
        textStyle(30, correct ? css(Palette.status.correct) : css(Palette.status.wrong), { fontStyle: 'bold' }),
      )
      .setOrigin(0.5)
      .setDepth(3600)
      .setScrollFactor(0);

    this.scene.tweens.add({
      targets: this.objects,
      alpha: 0,
      delay: 750,
      duration: 300,
      onComplete: () => this.destroy(),
    });
    this.scene.tweens.add({
      targets: done,
      alpha: 0,
      delay: 900,
      duration: 300,
      onComplete: () => done.destroy(),
    });

    // 先恢复世界（onDone 内清掉场景的冻结标记），再让提示文字走完淡出
    this.scene.time.delayedCall(600, () => this.opts.onDone(correct));
  }

  /** 场景销毁 / 关卡重置时兜底销毁（未结算的定时器一并移除） */
  destroy(): void {
    if (this.settled) {
      // 结算过：objects 已由淡出 tween 销毁，这里只兜底清理残留
      return;
    }
    this.settled = true;
    this.timerEvent.remove();
    for (const obj of this.objects) {
      const go = obj as Phaser.GameObjects.GameObject & { destroy?: () => void };
      if (go.destroy) go.destroy();
    }
    this.objects.length = 0;
  }
}
