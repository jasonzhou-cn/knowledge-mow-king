/**
 * 考神召唤系统（src/systems/ExamSummonSystem.ts）
 * 职责：按 design/art/fun-event-visual.md §4 实现 Boss 关专属氛围事件「考神召唤」——
 *      Boss 生成时同时召唤数个迷你 Boss（沿用 4 个原 Boss 的主色），等距环绕 Boss
 *      缓慢旋转（360° / orbitPeriodMs Linear），持续到 Boss 死亡。
 *
 * 与战斗的关系（§4.4 红线）：
 *  - 迷你 Boss 走 MonsterSpawner 的小怪池（isMiniboss 标记）：玩家可以打到、可以击杀；
 *  - 击杀后不计分、不掉经验、不进连击（GrassCuttingScene 的击杀结算分支负责）；
 *  - 迷你 Boss 不攻击玩家（damage = 0），纯粹视觉氛围；
 *  - 不占小怪同屏名额（MonsterSpawner 的 cap 计算剔除 isMiniboss）。
 *
 * 零素材红线：底型为 BootScene 程序化生成的白色灰度圆（tex-buff-miniboss，运行期 tint），
 *      表情（普通 / 哀悼）由 Graphics 运行期绘制，无任何外部素材、无 emoji。
 * 性能红线：每帧只做 4 次三角函数定位 + 直写坐标，无物理、无 per-frame 对象创建。
 */

import Phaser from 'phaser';
import type { Monster, MonsterSpawner } from './MonsterSpawner';
import type { ExamSummonSettings } from '../config/types';
import { Palette } from '../ui/Palette';
import { TextureKeys } from '../scenes/BootScene';

/** 迷你 Boss 主题色：沿用 4 个原 Boss 主色（L5 金 / L10 蓝绿 / L14 绿 / L17 蓝绿），不引入新色值 */
const MINI_COLORS: number[] = [
  Palette.accent.gold,
  Palette.accent.secondary,
  Palette.status.correct,
  Palette.accent.primary,
];

/** 单个迷你 Boss 的运行时数据 */
interface MiniEntry {
  monster: Monster;
  /** 表情叠层（跟随本体坐标；普通/哀悼两套绘制） */
  face: Phaser.GameObjects.Graphics;
  color: number;
  /** 等距环绕的初始角（弧度） */
  baseAngle: number;
  alive: boolean;
  /** Boss 死亡后的哀悼消散中（停止跟随，等待淡出完成） */
  mourning: boolean;
}

export interface ExamSummonOptions {
  scene: Phaser.Scene;
  spawner: MonsterSpawner;
  settings: ExamSummonSettings;
  /** 迷你 Boss 血量基准：普通小怪 hp（hpFactor 由配置给出） */
  baseMonsterHp: number;
}

export class ExamSummonSystem {
  private readonly scene: Phaser.Scene;
  private readonly spawner: MonsterSpawner;
  private readonly settings: ExamSummonSettings;
  private readonly baseMonsterHp: number;

  private readonly minis: MiniEntry[] = [];
  /** 当前环绕相位（弧度），全体迷你 Boss 共用（等距环绕） */
  private orbitAngle = 0;
  /** Boss 死亡后不再生成/更新 */
  private finished = false;

  constructor(opts: ExamSummonOptions) {
    this.scene = opts.scene;
    this.spawner = opts.spawner;
    this.settings = opts.settings;
    this.baseMonsterHp = opts.baseMonsterHp;
  }

  /** 存活迷你 Boss 数（调试/验证用） */
  get aliveCount(): number {
    return this.minis.filter((m) => m.alive).length;
  }

  /** 本关召唤总数（调试/验证用） */
  get totalSpawned(): number {
    return this.minis.length;
  }

  /**
   * Boss 生成时同时召唤（fun-event-visual.md §4.1：不延迟）。
   * 迷你 Boss 逐个错峰弹入（Back.easeOut），出生在 Boss 周围的目标环绕点位上。
   */
  spawnOnBoss(bossX: number, bossY: number): void {
    if (this.finished) return;
    const count = Math.max(0, Math.round(this.settings.miniCount));
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const color = MINI_COLORS[i % MINI_COLORS.length];
      const monster = this.spawner.spawnMiniboss({
        hp: Math.max(1, Math.round(this.baseMonsterHp * this.settings.hpFactor)),
        radius: this.settings.radius,
        tint: color,
        texture: TextureKeys.miniBoss,
      });
      if (!monster) break; // 池满兜底：少召唤一只也不影响战斗

      const baseAngle = (i / count) * Math.PI * 2;
      const face = this.scene.add.graphics().setDepth(101);
      this.drawFace(face, this.settings.radius, false);
      this.minis.push({ monster, face, color, baseAngle, alive: true, mourning: false });

      // 出生点：直接落在目标环绕点位上
      this.placeMini(this.minis[this.minis.length - 1], bossX, bossY);

      // 错峰弹入：本体缩放 0→基准 + 表情淡入
      const baseScale = monster.sprite.scaleX;
      monster.sprite.setScale(0);
      face.setAlpha(0);
      this.scene.tweens.add({
        targets: monster.sprite,
        scale: baseScale,
        duration: this.settings.popInMs,
        delay: i * this.settings.popStaggerMs,
        ease: 'Back.easeOut',
      });
      this.scene.tweens.add({
        targets: face,
        alpha: 1,
        duration: this.settings.popInMs,
        delay: i * this.settings.popStaggerMs,
        ease: 'Quad.easeOut',
      });
    }
  }

  /**
   * 每帧推进：环绕相位 + 迷你 Boss/表情跟随（由场景在 spawner.update 之后调用，
   * 直接直写坐标，speed=0 的迷你 Boss 不会被 MonsterSpawner 的追人逻辑移动）。
   */
  update(dt: number, bossX: number, bossY: number): void {
    if (this.finished || this.minis.length === 0) return;
    this.orbitAngle += (dt * Math.PI * 2) / Math.max(0.5, this.settings.orbitPeriodMs / 1000);
    for (const mini of this.minis) {
      if (mini.mourning) continue; // 哀悼消散中：位置冻结在最后点位
      if (!mini.alive || !mini.monster.alive) continue;
      this.placeMini(mini, bossX, bossY);
    }
  }

  /**
   * 迷你 Boss 被击杀（场景击杀结算分支调用）：表情快速淡出销毁，本体走对象池的尸体飞散。
   * @returns 击杀后仍存活的迷你 Boss 数（0 = 全灭）
   */
  notifyKilled(monster: Monster): number {
    const mini = this.minis.find((m) => m.monster === monster);
    if (mini && mini.alive) {
      mini.alive = false;
      const face = mini.face;
      this.scene.tweens.add({
        targets: face,
        alpha: 0,
        duration: 200,
        ease: 'Quad.easeIn',
        onComplete: () => face.destroy(),
      });
    }
    return this.aliveCount;
  }

  /**
   * Boss 死亡收场（§4.2）：全部迷你 Boss 切「哀悼」表情（小星眼 + 歪斜嘴），
   * 同步缩放淡出消散，时长来自 polishSettings.examSummon.fadeOutMs。
   */
  playMourning(): void {
    if (this.finished) return;
    this.finished = true;
    for (const mini of this.minis) {
      if (!mini.alive) continue;
      mini.alive = false;
      mini.mourning = true;
      this.drawFace(mini.face, this.settings.radius, true);
      // 中断可能仍在进行的弹入动画，避免缩放 tween 打架
      this.scene.tweens.killTweensOf([mini.monster.sprite, mini.face]);
      const baseScale = mini.monster.sprite.scaleX;
      this.scene.tweens.add({
        targets: [mini.monster.sprite, mini.face],
        alpha: 0,
        scale: baseScale * 0.6,
        duration: this.settings.fadeOutMs,
        ease: 'Quad.easeIn',
      });
    }
  }

  /** 场景销毁时清理表情叠层（本体精灵由 MonsterSpawner 对象池负责） */
  destroy(): void {
    for (const mini of this.minis) {
      this.scene.tweens.killTweensOf(mini.face);
      mini.face.destroy();
      this.scene.tweens.killTweensOf(mini.monster.sprite);
    }
    this.minis.length = 0;
    this.finished = true;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 把一只迷你 Boss 摆到环绕点位（本体 + 表情同步） */
  private placeMini(mini: MiniEntry, bossX: number, bossY: number): void {
    const angle = this.orbitAngle + mini.baseAngle;
    const x = bossX + Math.cos(angle) * this.settings.orbitRadius;
    const y = bossY + Math.sin(angle) * this.settings.orbitRadius;
    mini.monster.sprite.setPosition(x, y);
    mini.face.setPosition(x, y);
  }

  /**
   * 绘制表情（复用 BossVisual 的五官比例，1/2 迷你体型）：
   *  - 普通：黑圆眼 + 微笑弧嘴（§4.2 idle_normal）；
   *  - 哀悼：小星眼（十字线）+ 歪斜线嘴（§4.2 Boss 死亡收场）。
   */
  private drawFace(g: Phaser.GameObjects.Graphics, r: number, mourning: boolean): void {
    g.clear();
    const dark = Palette.text.onAccent;
    const eyeY = -r * 0.22;
    const eyeX = r * 0.26;

    if (!mourning) {
      g.fillStyle(dark, 1);
      g.fillCircle(-eyeX, eyeY, r * 0.09);
      g.fillCircle(eyeX, eyeY, r * 0.09);
      g.lineStyle(Math.max(1.5, r * 0.06), dark, 1);
      g.beginPath();
      g.arc(0, r * 0.1, r * 0.22, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155), false);
      g.strokePath();
      return;
    }

    // 哀悼：两只「小星」眼（十字交叉线）+ 歪斜嘴
    g.lineStyle(Math.max(1.5, r * 0.06), dark, 1);
    for (const ex of [-eyeX, eyeX]) {
      g.lineBetween(ex - r * 0.08, eyeY - r * 0.08, ex + r * 0.08, eyeY + r * 0.08);
      g.lineBetween(ex - r * 0.08, eyeY + r * 0.08, ex + r * 0.08, eyeY - r * 0.08);
    }
    g.lineBetween(-r * 0.16, r * 0.22, r * 0.16, r * 0.12);
  }
}
