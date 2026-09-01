/**
 * 关卡选择面板（src/ui/LevelSelectPanel.ts）
 * 职责：把主菜单的「◀ 选择关卡 ▶」升级为可视化关卡地图（T-019）。
 *
 * 设计：
 *  - 按学科分 3 页：数学 L1-8 / 英语 L9-14 / 科学 L15-20（页签 + 左右翻页箭头）
 *  - 每页一横排关卡卡片（序号 + 学科色），点击即选中（金色描边高亮）
 *  - 状态三态：锁定（灰，unlockedLevel 之后）/ 可选（学科色）/ 已通关（右上角 ✓）
 *  - 保留键盘 LEFT/RIGHT 页内选关、SPACE/ENTER 开始（由 MenuScene 转发）
 *  - 零外部素材：全部 Graphics + Text 程序化绘制
 */

import Phaser from 'phaser';
import { Palette, css, textStyle } from './Palette';
import type { LevelEntry } from '../config/types';

interface LevelNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelSelectPanelOptions {
  /** 全部关卡（按 level 升序） */
  levels: LevelEntry[];
  /** 已解锁到的关卡号（>= 该值可选，> 该值锁定） */
  unlockedLevel: number;
  /** 当前选中关卡号 */
  selectedLevel: number;
  /** 选中变化回调（用于刷新菜单信息） */
  onChange: (level: number) => void;
}

const NODE_W = 76;
const NODE_H = 46;
const NODE_GAP = 14;

/** 学科 → 节点圆点色（零外部素材，直接复用 Palette 现有色值） */
function subjectColor(subject: string): number {
  if (subject === 'english') return Palette.accent.secondary;
  if (subject === 'science') return Palette.accent.gold;
  return Palette.accent.primary; // math 默认
}

export class LevelSelectPanel {
  private readonly scene: Phaser.Scene;
  private readonly opts: LevelSelectPanelOptions;
  /** 按 level 排序的关卡 */
  private readonly levels: LevelEntry[];
  /** 学科页顺序 */
  private readonly subjects: string[];
  /** 当前页索引（0..subjects.length-1，每页 = 一个学科） */
  private page = 0;
  private selected: number;
  private nodes: LevelNode[] = [];
  /** 每个学科对应的关卡数组（按学科顺序） */
  private readonly bySubject: LevelEntry[][];
  private readonly pageGfx: Phaser.GameObjects.Graphics;
  private readonly pageTag: Phaser.GameObjects.Text;
  private readonly arrowPrev: Phaser.GameObjects.Zone;
  private readonly arrowNext: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene, opts: LevelSelectPanelOptions) {
    this.scene = scene;
    this.opts = opts;
    this.levels = [...opts.levels].sort((a, b) => a.level - b.level);
    this.selected = opts.selectedLevel;
    // 按学科分组：每页 = 一个学科的所有关卡，节点数 = 该学科关数
    const subjSet: string[] = [];
    const map = new Map<string, LevelEntry[]>();
    for (const lv of this.levels) {
      if (!map.has(lv.subject)) {
        map.set(lv.subject, []);
        subjSet.push(lv.subject);
      }
      map.get(lv.subject)!.push(lv);
    }
    this.subjects = subjSet;
    this.bySubject = subjSet.map((s) => map.get(s)!);
    // 默认页：selectedLevel 所在学科页
    const selSubjIdx = this.bySubject.findIndex((arr) => arr.some((l) => l.level === opts.selectedLevel));
    this.page = Math.max(0, selSubjIdx);

    this.pageGfx = scene.add.graphics().setDepth(2000);
    this.pageTag = scene.add
      .text(0, 0, '', textStyle(15, css(Palette.text.hint)))
      .setOrigin(0.5, 0.5)
      .setDepth(2001);

    // 左右翻页箭头热区（渲染由重绘方法完成）
    this.arrowPrev = scene.add
      .zone(0, 0, 40, 40)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(2002);
    this.arrowNext = scene.add
      .zone(0, 0, 40, 40)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(2002);
    this.arrowPrev.on('pointerdown', () => this.flipPage(-1));
    this.arrowNext.on('pointerdown', () => this.flipPage(1));

    this.render();
  }

  /** 当前选中关卡号 */
  get selectedLevel(): number {
    return this.selected;
  }

  /** 数据变化后重绘（如解锁新关卡） */
  refresh(unlockedLevel: number, selectedLevel: number): void {
    this.opts.unlockedLevel = unlockedLevel;
    this.selected = selectedLevel;
    this.render();
  }

  /** 键盘左右：页内选关（跳已解锁的相邻关） */
  shiftSelected(delta: number): void {
    const unlocked = this.opts.unlockedLevel;
    let next = this.selected + delta;
    if (next < 1) next = unlocked;
    if (next > unlocked) next = 1;
    if (next !== this.selected) {
      this.selected = next;
      // 若选中关不在当前页，翻页过去
      const newPage = this.bySubject.findIndex((arr) => arr.some((l) => l.level === next));
      if (newPage >= 0 && newPage !== this.page) this.page = newPage;
      this.opts.onChange(next);
      this.render();
    }
  }

  /** 销毁 */
  destroy(): void {
    this.pageGfx.destroy();
    this.pageTag.destroy();
    this.arrowPrev.destroy();
    this.arrowNext.destroy();
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private flipPage(delta: number): void {
    const maxPage = Math.max(0, this.subjects.length - 1);
    this.page = Phaser.Math.Clamp(this.page + delta, 0, maxPage);
    this.render();
  }

  private render(): void {
    const w = this.scene.scale.width;
    const s = Math.min(w / 960, this.scene.scale.height / 640);
    const cx = w / 2;
    const cy = this.scene.scale.height / 2 + 48 * s; // 面板基准：菜单中央偏下
    // 先清旧对象，再创建新对象（否则刚创建的 Text 会被下面的 cleanup 销毁）
    this.cleanupZones();
    const g = this.pageGfx;
    g.clear();
    this.nodes = [];

    const pageLevels = this.bySubject[this.page] ?? [];
    const count = pageLevels.length;
    const totalW = count * (NODE_W * s) + (count - 1) * (NODE_GAP * s);
    const startX = cx - totalW / 2;
    const nodeY = cy;
    const nodeH = NODE_H * s;

    for (let i = 0; i < count; i++) {
      const lv = pageLevels[i];
      const x = startX + i * ((NODE_W + NODE_GAP) * s);
      const unlocked = lv.level <= this.opts.unlockedLevel;
      const isSel = lv.level === this.selected;
      const passed = lv.level < this.opts.unlockedLevel; // 已通关（小于解锁线）

      const nodeW = NODE_W * s;
      // 卡片底
      g.fillStyle(unlocked ? Palette.background.panel : Palette.background.deep, 1);
      g.fillRoundedRect(x, nodeY, nodeW, nodeH, 10);
      // 选中金色描边 / 锁定暗边
      g.lineStyle(isSel ? 3 : 1, isSel ? Palette.accent.gold : unlocked ? Palette.accent.primaryDark : Palette.text.hint, isSel ? 1 : 0.5);
      g.strokeRoundedRect(x, nodeY, nodeW, nodeH, 10);

      // 学科色小圆点
      g.fillStyle(unlocked ? subjectColor(lv.subject) : Palette.text.hint);
      g.fillCircle(x + 10 * s, nodeY + 11 * s, 4 * s);

      // 序号
      g.lineStyle(0, 0, 0);
      // 已通关 ✓（右上角）
      if (passed && unlocked) {
        g.lineStyle(3, Palette.status.correctDark, 1);
        g.lineBetween(x + nodeW - 12 * s, nodeY + 12 * s, x + nodeW - 8 * s, nodeY + 16 * s);
        g.lineBetween(x + nodeW - 8 * s, nodeY + 16 * s, x + nodeW - 3 * s, nodeY + 8 * s);
      }
      if (!unlocked) {
        // 锁定：画一把小锁（圆 + 弧）
        g.lineStyle(2, Palette.text.hint, 0.8);
        g.strokeCircle(x + nodeW - 12 * s, nodeY + 13 * s, 4 * s);
        g.lineBetween(x + nodeW - 12 * s, nodeY + 17 * s, x + nodeW - 12 * s, nodeY + 20 * s);
      }

      this.nodes.push({ x, y: nodeY, w: nodeW, h: nodeH });

      // 序号文字（浅色：节点背景是深色 panel，onAccent 近黑不可见）
      const num = this.scene.add
        .text(x + nodeW / 2, nodeY + nodeH / 2, `${lv.level}`, textStyle(Math.round(28 * s), css(Palette.text.primary), { fontStyle: 'bold' }))
        .setOrigin(0.5)
        .setDepth(9999);
      this.nodeTexts.push(num);
    }

    // 学科页签 + 页码
    const subj = this.subjects[this.page] ?? '';
    const subjName = { math: '数学', english: '英语', science: '科学' }[subj] ?? subj;
    this.pageTag.setText(`${subjName} · 第 ${this.page + 1} / ${this.subjects.length} 页`).setPosition(cx, cy - 34 * s);

    
    // 翻页箭头位置
    this.arrowPrev.setPosition(cx - totalW / 2 - 28 * s, nodeY + nodeH / 2);
    this.arrowNext.setPosition(cx + totalW / 2 + 28 * s, nodeY + nodeH / 2);

    // 点击热区：页内关卡（开头已 cleanupZones，这里只新增）
    this.bySubject[this.page].forEach((lv, i) => {
      const node = this.nodes[i];
      const zone = this.scene.add
        .zone(node.x + node.w / 2, node.y + node.h / 2, node.w + 4, node.h + 4)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(2002);
      zone.on('pointerdown', () => {
        if (lv.level <= this.opts.unlockedLevel) {
          this.selected = lv.level;
          this.opts.onChange(lv.level);
          this.render();
        }
      });
      this.zones.push(zone);
    });
  }

  private nodeTexts: Phaser.GameObjects.Text[] = [];
  private zones: Phaser.GameObjects.Zone[] = [];

  private cleanupZones(): void {
    for (const t of this.nodeTexts) t.destroy();
    for (const z of this.zones) z.destroy();
    this.nodeTexts = [];
    this.zones = [];
  }
}