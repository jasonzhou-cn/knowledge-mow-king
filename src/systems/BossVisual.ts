/**
 * Boss 视觉控制器（src/systems/BossVisual.ts）
 * 职责：按 design/art/boss-visual-spec.md 用纯 Graphics/Text 程序化绘制 5 个 Boss 的
 *      专属外观（底型贴图 + 沙雕表情 + 阶段配件），并在阶段切换时给出可感知的外观变化。
 *
 * 零素材红线：所有配件均由 Graphics 绘制；唯一文字（KPI / A+ / Z）用 Phaser.Text 系统字体。
 * 性能红线：每个 Boss 只有一个 Container（脸 + 配件），阶段切换 ≤ 3 个并发 tween；
 *          脸部重绘只发生在阶段切换瞬间，不在每帧路径上。
 *
 * 与 MonsterSpawner 的协作契约：
 *  - Boss 本体精灵仍由对象池驱动（追人移动 / 受击闪白 / 血量 tint 全部不动）；
 *  - 本控制器只在 attach() 时替换本体贴图为 Boss 专属底型（白色灰度图，tint 系统照常工作），
 *    并把「脸 + 配件」Container 跟随本体坐标（scene 每帧调 update(x, y)）。
 */

import Phaser from 'phaser';
import { Palette } from '../ui/Palette';

/** Boss 模板 id → 底型贴图 key（贴图由 BootScene 程序化生成） */
export const BOSS_TEXTURE_KEYS: Record<string, string> = {
  boss_overwork_math: 'tex-boss-square',
  boss_slacker_math: 'tex-boss-oval',
  boss_grammar_king_english: 'tex-boss-circle',
  boss_element_science: 'tex-boss-hexagon',
  boss_exam_god_ultimate: 'tex-boss-god',
};

/** 由 Boss 模板 id 推导底型贴图 key；未知 id 返回 null（保持默认草怪贴图） */
export function bossTextureKey(bossId: string): string | null {
  return BOSS_TEXTURE_KEYS[bossId] ?? null;
}

/** 表情模式：普通 / 凶光（阶段 2+） */
type FaceMode = 'idle' | 'angry';

export interface BossVisualOptions {
  bossId: string;
  /** Boss 碰撞半径（配件与五官的坐标都按半径比例换算） */
  radius: number;
  depth?: number;
}

export class BossVisual {
  private readonly scene: Phaser.Scene;
  private readonly bossId: string;
  private readonly radius: number;

  private container: Phaser.GameObjects.Container | null = null;
  private face: Phaser.GameObjects.Graphics | null = null;
  /** 阶段 3+ 才显示的配件组 */
  private extras: Phaser.GameObjects.Container | null = null;
  private mode: FaceMode = 'idle';
  private followTarget: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene, opts: BossVisualOptions) {
    this.scene = scene;
    this.bossId = opts.bossId;
    this.radius = opts.radius;
  }

  /** 挂到 Boss 精灵上：替换底型贴图 + 生成脸与配件 */
  attach(sprite: Phaser.GameObjects.Image): void {
    this.followTarget = sprite;

    const key = bossTextureKey(this.bossId);
    if (key && this.scene.textures.exists(key)) {
      sprite.setTexture(key);
      // 底型贴图与碰撞半径同尺寸，直接按半径 ×2 拉伸即可
      sprite.setDisplaySize(this.radius * 2, this.radius * 2);
    }

    this.container = this.scene.add.container(sprite.x, sprite.y);
    this.container.setDepth(102);

    this.buildAccessories();
    this.face = this.scene.add.graphics();
    this.container.add(this.face);
    this.drawFace();

    // 入场弹入：给 Boss 登场一个「压场感」
    this.container.setScale(0.4);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      scale: 1,
      alpha: 1,
      duration: 320,
      ease: 'Back.easeOut',
    });
  }

  /**
   * 阶段切换外观变化：表情切凶光 + 缩放脉冲；阶段 3（phaseIndex ≥ 2）亮出专属配件。
   * 不动本体 x/y（MonsterSpawner 每帧都在改），只对 Container 做缩放脉冲。
   */
  setPhase(phaseIndex: number): void {
    if (!this.container) return;
    if (phaseIndex >= 1 && this.mode !== 'angry') {
      this.mode = 'angry';
      this.drawFace();
    }
    // 缩放脉冲（比位移抖动更安全：不与追人移动的坐标更新打架）
    this.scene.tweens.add({
      targets: this.container,
      scale: { from: 1.08, to: 1 },
      duration: 180,
      ease: 'Quad.easeOut',
    });
    if (phaseIndex >= 2 && this.extras) {
      this.extras.setAlpha(0);
      this.extras.setVisible(true);
      this.scene.tweens.add({
        targets: this.extras,
        alpha: 1,
        duration: 240,
        ease: 'Quad.easeOut',
      });
    }
  }

  /** 每帧跟随 Boss 本体坐标（由场景 update 调用） */
  update(x: number, y: number): void {
    if (!this.container || !this.followTarget) return;
    if (!this.followTarget.active || !this.followTarget.visible) {
      this.container.setVisible(false);
      return;
    }
    this.container.setVisible(true);
    this.container.setPosition(x, y);
  }

  destroy(): void {
    this.container?.destroy();
    this.container = null;
    this.face = null;
    this.extras = null;
    this.followTarget = null;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 五官（相对 Boss 中心，坐标按半径比例），全程零文字零素材 */
  private drawFace(): void {
    const g = this.face;
    if (!g) return;
    const r = this.radius;
    g.clear();

    const dark = Palette.text.onAccent;
    const white = Palette.quiz.cardFill;
    const eyeY = -r * 0.22;
    const eyeX = r * 0.26;

    if (this.mode === 'idle') {
      // 正常黑眼 + 微笑嘴
      g.fillStyle(dark, 1);
      g.fillCircle(-eyeX, eyeY, r * 0.09);
      g.fillCircle(eyeX, eyeY, r * 0.09);
      g.lineStyle(Math.max(2, r * 0.06), dark, 1);
      g.beginPath();
      g.arc(0, r * 0.1, r * 0.22, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155), false);
      g.strokePath();
      return;
    }

    // 凶光眼（> <）+ 露牙吼嘴
    g.lineStyle(Math.max(3, r * 0.08), Palette.status.wrong, 0.9);
    g.lineBetween(-eyeX - r * 0.12, eyeY - r * 0.1, -eyeX + r * 0.08, eyeY);
    g.lineBetween(-eyeX + r * 0.08, eyeY, -eyeX - r * 0.12, eyeY + r * 0.1);
    g.lineBetween(eyeX + r * 0.12, eyeY - r * 0.1, eyeX - r * 0.08, eyeY);
    g.lineBetween(eyeX - r * 0.08, eyeY, eyeX + r * 0.12, eyeY + r * 0.1);

    const mouthW = r * 0.4;
    const mouthH = r * 0.26;
    g.fillStyle(dark, 1);
    g.fillRoundedRect(-mouthW / 2, r * 0.14, mouthW, mouthH, mouthH * 0.3);
    // 上下各一颗白牙，区分「吼」与「笑」
    g.fillStyle(white, 1);
    const tooth = r * 0.09;
    g.fillRect(-mouthW * 0.28, r * 0.14 + 1, tooth, tooth);
    g.fillRect(mouthW * 0.28 - tooth, r * 0.14 + 1, tooth, tooth);
    g.fillRect(-mouthW * 0.28, r * 0.14 + mouthH - tooth - 1, tooth, tooth);
    g.fillRect(mouthW * 0.28 - tooth, r * 0.14 + mouthH - tooth - 1, tooth, tooth);
  }

  /** 按 bossId 构建「阶段 1 就有」的招牌配件与「阶段 3 才亮出」的 extras */
  private buildAccessories(): void {
    if (!this.container) return;
    const r = this.radius;
    const dark = Palette.text.onAccent;
    const white = Palette.quiz.cardFill;
    const eyeX = r * 0.26;
    const eyeY = -r * 0.22;
    const g = this.scene.add.graphics();
    const texts: Phaser.GameObjects.Text[] = [];

    switch (this.bossId) {
      case 'boss_overwork_math': {
        // 工牌（胸前）+ 西装领带 + 稀疏头发
        g.fillStyle(white, 1);
        g.fillRoundedRect(-r * 0.13, r * 0.2, r * 0.26, r * 0.2, 3);
        g.lineStyle(2, dark, 1);
        g.strokeRoundedRect(-r * 0.13, r * 0.2, r * 0.26, r * 0.2, 3);
        g.fillStyle(Palette.status.wrong, 1);
        g.fillTriangle(-r * 0.1, r * 0.4, r * 0.1, r * 0.4, 0, r * 0.52);
        g.fillRect(-r * 0.04, r * 0.5, r * 0.08, r * 0.2);
        g.lineStyle(2, Palette.background.panelSoft, 1);
        for (let i = 0; i < 3; i++) {
          const hx = -r * 0.3 + i * r * 0.12;
          g.lineBetween(hx, -r * 0.92, hx + r * 0.08, -r * 0.8);
        }
        texts.push(this.makeText('KPI', Math.round(r * 0.24), Palette.text.onAccent, 0, r * 0.3));
        // extras：阶段 3 加班火焰（左右肩各一团橙红三角）
        this.buildExtras((eg) => {
          eg.fillStyle(Palette.accent.orange, 0.85);
          eg.fillTriangle(-r * 0.75, r * 0.35, -r * 0.55, r * 0.35, -r * 0.65, r * 0.1);
          eg.fillTriangle(r * 0.75, r * 0.35, r * 0.55, r * 0.35, r * 0.65, r * 0.1);
          eg.fillStyle(Palette.status.wrong, 0.8);
          eg.fillTriangle(-r * 0.72, r * 0.35, -r * 0.58, r * 0.35, -r * 0.65, r * 0.2);
          eg.fillTriangle(r * 0.72, r * 0.35, r * 0.58, r * 0.35, r * 0.65, r * 0.2);
        });
        break;
      }
      case 'boss_slacker_math': {
        // 头顶 Z 字气泡（打瞌睡的呼吸感）+ 鼻涕泡
        const z1 = this.makeText('Z', Math.round(r * 0.42), Palette.text.secondary, r * 0.28, -r * 0.85);
        const z2 = this.makeText('z', Math.round(r * 0.3), Palette.text.secondary, -r * 0.35, -r * 0.7);
        texts.push(z1, z2);
        this.scene.tweens.add({
          targets: z1,
          y: z1.y - r * 0.12,
          alpha: { from: 0.9, to: 0.35 },
          duration: 1400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        this.scene.tweens.add({
          targets: z2,
          y: z2.y - r * 0.1,
          alpha: { from: 0.7, to: 0.3 },
          duration: 1700,
          delay: 350,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        // extras：阶段 3 头下垫枕头（白色圆角矩形）
        this.buildExtras((eg) => {
          eg.fillStyle(white, 0.9);
          eg.fillRoundedRect(-r * 0.62, r * 0.52, r * 1.24, r * 0.3, r * 0.15);
          eg.lineStyle(2, dark, 1);
          eg.strokeRoundedRect(-r * 0.62, r * 0.52, r * 1.24, r * 0.3, r * 0.15);
        });
        break;
      }
      case 'boss_grammar_king_english': {
        // 博士帽（黑方帽 + 红流苏）+ 试管眼镜
        g.fillStyle(dark, 1);
        g.fillRoundedRect(-r * 0.48, -r * 0.92, r * 0.96, r * 0.18, 3);
        g.fillRect(-r * 0.26, -r * 0.78, r * 0.52, r * 0.14);
        g.lineStyle(2, Palette.status.wrong, 1);
        g.lineBetween(r * 0.42, -r * 0.86, r * 0.5, -r * 0.62);
        g.fillStyle(Palette.accent.secondary, 0.35);
        g.fillCircle(-eyeX, eyeY, r * 0.17);
        g.fillCircle(eyeX, eyeY, r * 0.17);
        g.lineStyle(2, dark, 1);
        g.strokeCircle(-eyeX, eyeY, r * 0.17);
        g.strokeCircle(eyeX, eyeY, r * 0.17);
        g.lineBetween(0, eyeY, -eyeX + r * 0.17, eyeY);
        g.lineBetween(0, eyeY, eyeX - r * 0.17, eyeY);
        // extras：阶段 3 帽顶 A+ 分数牌
        this.buildExtras((eg) => {
          eg.fillStyle(white, 1);
          eg.fillRoundedRect(-r * 0.16, -r * 0.78, r * 0.32, r * 0.2, 3);
          eg.lineStyle(2, dark, 1);
          eg.strokeRoundedRect(-r * 0.16, -r * 0.78, r * 0.32, r * 0.2, 3);
        });
        const badge = this.makeText('A+', Math.round(r * 0.18), Palette.text.onAccent, 0, -r * 0.68);
        texts.push(badge);
        break;
      }
      case 'boss_element_science': {
        // 护目镜（跨双眼）+ 左手试管（绿色液体）
        g.fillStyle(Palette.accent.secondary, 0.35);
        g.fillCircle(-eyeX, eyeY, r * 0.16);
        g.fillCircle(eyeX, eyeY, r * 0.16);
        g.lineStyle(2, dark, 1);
        g.strokeCircle(-eyeX, eyeY, r * 0.16);
        g.strokeCircle(eyeX, eyeY, r * 0.16);
        g.lineBetween(0, eyeY, -eyeX + r * 0.16, eyeY);
        g.lineBetween(0, eyeY, eyeX - r * 0.16, eyeY);
        g.lineBetween(-eyeX - r * 0.16, eyeY, -r * 0.7, eyeY);
        g.lineBetween(eyeX + r * 0.16, eyeY, r * 0.7, eyeY);
        g.fillStyle(white, 0.9);
        g.fillRect(-r * 0.76, r * 0.24, r * 0.16, r * 0.36);
        g.lineStyle(2, dark, 1);
        g.strokeRect(-r * 0.76, r * 0.24, r * 0.16, r * 0.36);
        g.fillStyle(Palette.status.correct, 0.7);
        g.fillRect(-r * 0.75, r * 0.44, r * 0.14, r * 0.15);
        // extras：阶段 3 试管冒泡（两个小圆上下浮动）
        this.buildExtras((eg) => {
          eg.fillStyle(Palette.status.correct, 0.75);
          eg.fillCircle(-r * 0.68, r * 0.1, 2.5);
          eg.fillCircle(-r * 0.62, -r * 0.02, 2);
          eg.lineStyle(2, Palette.status.wrong, 0.9);
          eg.strokeCircle(-eyeX, eyeY, r * 0.18);
          eg.strokeCircle(eyeX, eyeY, r * 0.18);
        });
        break;
      }
      case 'boss_exam_god_ultimate': {
        // 加强版博士帽 + 旋转光环 + 手持考试卷
        g.fillStyle(dark, 1);
        g.fillRoundedRect(-r * 0.56, -r * 0.98, r * 1.12, r * 0.2, 3);
        g.fillRect(-r * 0.3, -r * 0.82, r * 0.6, r * 0.16);
        g.lineStyle(3, Palette.accent.gold, 0.75);
        g.beginPath();
        g.arc(0, -r * 1.12, r * 0.34, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
        g.strokePath();
        g.fillStyle(white, 1);
        g.fillRect(r * 0.6, r * 0.16, r * 0.3, r * 0.4);
        g.lineStyle(1.5, dark, 0.8);
        g.strokeRect(r * 0.6, r * 0.16, r * 0.3, r * 0.4);
        for (let i = 0; i < 3; i++) {
          g.lineBetween(r * 0.64, r * 0.24 + i * r * 0.1, r * 0.86, r * 0.24 + i * r * 0.1);
        }
        // extras：阶段 3 红眼光环 + 左手第二张考卷
        this.buildExtras((eg) => {
          eg.lineStyle(3, Palette.status.wrong, 0.8);
          eg.beginPath();
          eg.arc(0, -r * 1.12, r * 0.4, Phaser.Math.DegToRad(160), Phaser.Math.DegToRad(20), false);
          eg.strokePath();
          eg.fillStyle(white, 0.95);
          eg.fillRect(-r * 0.9, r * 0.16, r * 0.3, r * 0.4);
          eg.lineStyle(1.5, dark, 0.8);
          eg.strokeRect(-r * 0.9, r * 0.16, r * 0.3, r * 0.4);
          for (let i = 0; i < 3; i++) {
            eg.lineBetween(-r * 0.86, r * 0.24 + i * r * 0.1, -r * 0.64, r * 0.24 + i * r * 0.1);
          }
        });
        break;
      }
      default:
        // 未知 Boss：不画配件，只保留通用表情，行为安全兜底
        break;
    }

    this.container.add(g);
    for (const t of texts) this.container.add(t);
    // extras 初始隐藏，等阶段 3（phaseIndex ≥ 2）亮出
    if (this.extras) {
      this.extras.setVisible(false);
      this.extras.setAlpha(0);
      this.container.add(this.extras);
    }
  }

  /** extras 是一个子容器，绘制回调拿到的是独立的 Graphics */
  private buildExtras(draw: (g: Phaser.GameObjects.Graphics) => void): void {
    const eg = this.scene.add.graphics();
    draw(eg);
    this.extras = this.scene.add.container(0, 0, [eg]);
  }

  /** 配件里的小文字（KPI / A+ / Z），系统字体栈，零素材 */
  private makeText(content: string, size: number, color: number, x: number, y: number): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, content, {
        fontFamily: 'sans-serif',
        fontSize: `${Math.max(9, size)}px`,
        color: `#${color.toString(16).padStart(6, '0')}`,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
  }
}
