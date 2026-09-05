/**
 * 强制休息全屏遮罩（src/ui/RestOverlay.ts）
 * 职责：PlaytimeSystem 判定 shouldRest 时展示——压暗全屏、阻断一切输入、
 *      倒计时结束自动关闭（finishRest）。防沉迷闭环的 UI 侧（GDD 2.6）。
 *
 * 阻断方式：
 *  - 全屏 interactive zone 截获点击；
 *  - 场景侧在遮罩存续期间自行跳过键盘回调（MenuScene.startLevel 等入口检查 isResting）。
 */

import Phaser from 'phaser';
import { playtime } from '../systems/PlaytimeSystem';
import { Palette, css, textStyle } from './Palette';

export class RestOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly timerEvent: Phaser.Time.TimerEvent;
  private closed = false;

  constructor(scene: Phaser.Scene, onClose: () => void) {
    playtime.startRest();

    const w = scene.scale.width;
    const h = scene.scale.height;
    const s = Math.min(w / 960, h / 640);
    const cx = w / 2;
    const cy = h / 2;

    this.container = scene.add.container(0, 0).setDepth(5000);

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.background.deep, 0.94);
    dim.fillRect(0, 0, w, h);
    this.container.add(dim);

    const icon = scene.add
      .text(cx, cy - 130 * s, '⏰', textStyle(Math.round(72 * s), css(Palette.accent.gold)))
      .setOrigin(0.5);
    const title = scene.add
      .text(cx, cy - 40 * s, '休息时间到！', textStyle(Math.round(52 * s), css(Palette.accent.gold), { fontStyle: 'bold' }))
      .setOrigin(0.5);
    const desc = scene.add
      .text(
        cx,
        cy + 24 * s,
        `你已经连续玩了 ${playtime.sessionLimitMin} 分钟啦。\n去看看窗外、喝口水，眼睛和大脑都需要休息～`,
        textStyle(Math.round(22 * s), css(Palette.text.secondary), { align: 'center', lineSpacing: 8 }),
      )
      .setOrigin(0.5);
    this.timeText = scene.add
      .text(cx, cy + 118 * s, '', textStyle(Math.round(40 * s), css(Palette.text.primary), { fontStyle: 'bold' }))
      .setOrigin(0.5);
    this.container.add([icon, title, desc, this.timeText]);

    // 全屏拦截点击：遮罩期间点哪里都不放行
    this.blocker = scene.add
      .zone(cx, cy, w, h)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: false });
    this.blocker.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.stopPropagation();
    });
    this.container.add(this.blocker);

    this.timerEvent = scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.tick(onClose),
    });
    this.tick(onClose);
  }

  /** 遮罩是否仍在阻断输入（场景键盘入口用它短路） */
  get isResting(): boolean {
    return !this.closed;
  }

  /** 倒计时刷新与自动关闭 */
  private tick(onClose: () => void): void {
    if (this.closed) return;
    const remain = playtime.restRemainingSec;
    if (remain <= 0) {
      this.close(onClose);
      return;
    }
    const mm = Math.floor(remain / 60);
    const ss = `${remain % 60}`.padStart(2, '0');
    this.timeText.setText(`${mm}:${ss} 后可以继续`);
  }

  /** 关闭遮罩并恢复输入 */
  private close(onClose: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.timerEvent.remove();
    playtime.finishRest();
    this.container.destroy();
    onClose();
  }

  /** 场景 shutdown 时销毁（不触发 onClose 的游戏逻辑） */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.timerEvent.remove();
    this.container.destroy();
  }
}
