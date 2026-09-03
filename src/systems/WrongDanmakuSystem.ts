/**
 * 错题弹幕系统（src/systems/WrongDanmakuSystem.ts）
 * 职责：按 fun-event-visual.md 的「错题弹幕」条目，把本轮答题答错的题目以弹幕形式
 *      从屏幕右侧向左飘过——半透明、主题色小字、屏幕底部活动带，不遮挡玩法中心区。
 *
 * 数据来源：QuestionScene 在每次答错/超时时把「题干 → 正确答案」快照进 GrassCuttingData.wrongAnswers，
 *      割草场景创建本系统时传入；错题列表为空时零弹幕，不打扰（无错题 = 零成本）。
 *
 * 数值纪律（GDD 1.4）：速度 / 字号 / 透明度 / 同屏上限 / 生成间隔 / 活动带范围
 *      全部来自 grassCuttingConfig.polishSettings.wrongDanmaku，本文件只做调度与表现。
 *
 * 性能红线：同屏受 maxOnScreen 硬上限；每条只是一枚 Phaser.Text，飘出左边界即销毁；
 *      错题循环复用（列表轮转），不随时间增长。
 */

import Phaser from 'phaser';
import type { WrongDanmakuSettings } from '../config/types';
import { css, textStyle } from '../ui/Palette';

/** 场上单条弹幕 */
interface DanmakuItem {
  text: Phaser.GameObjects.Text;
}

export interface WrongDanmakuOptions {
  settings: WrongDanmakuSettings;
  /** 本轮答错的题目文案列表（「题干 → 正确答案」），可为空数组 */
  items: string[];
  /** 弹幕文字颜色（用本关学科主题强调色） */
  color: number;
}

export class WrongDanmakuSystem {
  private readonly scene: Phaser.Scene;
  private readonly settings: WrongDanmakuSettings;
  private readonly items: string[];
  private readonly colorCss: string;
  /** 场上存活弹幕 */
  private readonly active: DanmakuItem[] = [];
  /** 生成计时器（秒） */
  private timer = 0;
  /** 下一条弹幕取用的错题下标（循环轮转） */
  private cursor = 0;

  constructor(scene: Phaser.Scene, opts: WrongDanmakuOptions) {
    this.scene = scene;
    this.settings = opts.settings;
    this.items = opts.items.filter((s) => s.length > 0).slice();
    this.colorCss = css(opts.color);
  }

  /** 场上当前弹幕条数（debug/验证用） */
  get activeCount(): number {
    return this.active.length;
  }

  /** 传入的错题条数（debug/验证用） */
  get itemCount(): number {
    return this.items.length;
  }

  /** 每帧推进：生成判定 + 整体左移 + 出界回收 */
  update(dt: number): void {
    if (this.items.length === 0 || this.settings.maxOnScreen <= 0) return;

    this.timer += dt;
    if (this.timer >= this.settings.spawnIntervalSec && this.active.length < this.settings.maxOnScreen) {
      this.timer = 0;
      this.spawnOne();
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      item.text.x -= this.settings.speed * dt;
      if (item.text.x < -item.text.width - 40) {
        item.text.destroy();
        this.active.splice(i, 1);
      }
    }
  }

  /** 场景销毁时清理 */
  destroy(): void {
    for (const item of this.active) item.text.destroy();
    this.active.length = 0;
  }

  /** 在右缘外、活动带内随机高度生成一条弹幕 */
  private spawnOne(): void {
    const s = this.settings;
    const h = this.scene.scale.height;
    const bandTop = h * s.bandTopRatio;
    const bandBottom = Math.max(bandTop + s.fontSize + 6, h * s.bandBottomRatio);
    const content = this.items[this.cursor % this.items.length];
    this.cursor = (this.cursor + 1) % Math.max(1, this.items.length);

    const text = this.scene.add
      .text(this.scene.scale.width + 40, Phaser.Math.Between(bandTop, bandBottom), content, textStyle(s.fontSize, this.colorCss))
      .setAlpha(s.alpha)
      .setDepth(115);
    this.active.push({ text });
  }
}
