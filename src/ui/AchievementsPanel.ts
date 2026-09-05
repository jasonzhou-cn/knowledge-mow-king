/**
 * 成就 / 图鉴 / 记录面板（src/ui/AchievementsPanel.ts）
 * 职责：主菜单入口的全屏浮层，展示三块本地元数据：
 *  1. 成就清单（achievementConfig.json 驱动，解锁高亮 / 未解锁置灰）；
 *  2. Boss 图鉴（bossRoster × bossesDefeated：击败过显示名字与主题色，没打过显示 ???）；
 *  3. 关卡记录（本地排行榜：累计统计 + 每关最佳得分 Top5）。
 * 全部数据来自 ProgressionSystem.meta（localStorage），纯本地、无网络。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { achievements } from '../systems/AchievementSystem';
import { progression } from '../systems/ProgressionSystem';
import { Palette, css, textStyle } from './Palette';

/** Boss 图鉴的展示色（与 grassCuttingConfig 主题色一致；取自 roster 无运行时依赖） */
const BOSS_DISPLAY_COLORS: Record<string, number> = {
  boss_overwork_math: 0xff9f45,
  boss_slacker_math: 0xa8c2d6,
  boss_grammar_king_english: 0x35d0a5,
  boss_element_science: 0x3ddc84,
  boss_exam_god_ultimate: 0xffcc4d,
};

export class AchievementsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private closed = false;

  constructor(scene: Phaser.Scene, onClose: () => void) {
    const w = scene.scale.width;
    const h = scene.scale.height;
    const s = Math.min(w / 960, h / 640);

    this.container = scene.add.container(0, 0).setDepth(4000);

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.background.deep, 0.9);
    dim.fillRect(0, 0, w, h);
    this.container.add(dim);

    // 主面板
    const panelW = Math.min(w * 0.94, 1240);
    const panelH = h * 0.88;
    const left = (w - panelW) / 2;
    const top = (h - panelH) / 2;
    const panel = scene.add.graphics();
    panel.fillStyle(Palette.background.panel, 0.98);
    panel.fillRoundedRect(left, top, panelW, panelH, 18);
    panel.lineStyle(3, Palette.accent.gold, 0.7);
    panel.strokeRoundedRect(left, top, panelW, panelH, 18);
    this.container.add(panel);

    const meta = progression.meta;
    const unlocked = new Set(meta.achievements);
    const all = achievements.all;

    const title = scene.add
      .text(
        w / 2,
        top + 22 * s,
        `成就 · 图鉴 · 记录　（${unlocked.size}/${all.length}）`,
        textStyle(Math.round(30 * s), css(Palette.accent.gold), { fontStyle: 'bold' }),
      )
      .setOrigin(0.5, 0);
    this.container.add(title);

    // ── 成就区：3 列网格 ──
    const gridTop = top + 66 * s;
    const cols = 3;
    const cellW = (panelW - 48 * s) / cols;
    const cellH = 56 * s;
    all.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = left + 24 * s + col * cellW;
      const y = gridTop + row * cellH;
      const got = unlocked.has(entry.id);

      const dot = scene.add.graphics();
      dot.fillStyle(got ? Palette.accent.gold : Palette.background.panelSoft, 1);
      dot.fillCircle(x + 9 * s, y + 10 * s, 8 * s);
      if (got) {
        dot.lineStyle(2, Palette.text.primary, 0.5);
        dot.strokeCircle(x + 9 * s, y + 10 * s, 11 * s);
      }

      const nameText = scene.add
        .text(x + 26 * s, y, entry.name, textStyle(Math.round(17 * s), css(got ? Palette.accent.gold : Palette.text.hint), { fontStyle: 'bold' }))
        .setOrigin(0, 0);
      const descText = scene.add
        .text(x + 26 * s, y + 22 * s, entry.desc, textStyle(Math.round(13 * s), css(got ? Palette.text.secondary : Palette.text.hint)))
        .setOrigin(0, 0);
      this.container.add([dot, nameText, descText]);
    });

    // ── 底部：Boss 图鉴 + 关卡记录 ──
    const bottomY = gridTop + Math.ceil(all.length / cols) * cellH + 18 * s;

    const dexTitle = scene.add
      .text(left + 24 * s, bottomY, 'Boss 图鉴', textStyle(Math.round(19 * s), css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0, 0);
    this.container.add(dexTitle);

    try {
      const grass = ConfigLoader.getInstance().getConfig('grassCuttingConfig');
      const roster = grass.bossRoster?.roster ?? [];
      const cardW = Math.min(150 * s, (panelW * 0.56) / Math.max(1, roster.length));
      roster.forEach((boss, i) => {
        const x = left + 24 * s + i * cardW;
        const y = bottomY + 34 * s;
        const defeated = meta.bossesDefeated.includes(boss.id);
        const card = scene.add.graphics();
        card.fillStyle(defeated ? Palette.background.panelSoft : Palette.background.deep, 1);
        card.fillRoundedRect(x, y, cardW - 12 * s, 74 * s, 10);
        card.lineStyle(2, defeated ? (BOSS_DISPLAY_COLORS[boss.id] ?? Palette.accent.gold) : Palette.text.hint, defeated ? 0.9 : 0.3);
        card.strokeRoundedRect(x, y, cardW - 12 * s, 74 * s, 10);

        const face = scene.add.circle(x + (cardW - 12 * s) / 2, y + 24 * s, 12 * s, defeated ? (BOSS_DISPLAY_COLORS[boss.id] ?? Palette.accent.gold) : Palette.background.panelSoft);
        const nameText = scene.add
          .text(
            x + (cardW - 12 * s) / 2,
            y + 48 * s,
            defeated ? boss.name : '？？？',
            textStyle(Math.round(12 * s), css(defeated ? Palette.text.primary : Palette.text.hint), { align: 'center', wordWrap: { width: cardW - 20 * s } }),
          )
          .setOrigin(0.5, 0);
        this.container.add([card, face, nameText]);
      });
    } catch {
      // 配置未就绪时静默跳过图鉴区
    }

    const recX = left + panelW * 0.62;
    const recTitle = scene.add
      .text(recX, bottomY, '关卡记录', textStyle(Math.round(19 * s), css(Palette.accent.secondary), { fontStyle: 'bold' }))
      .setOrigin(0, 0);
    const t = meta.totals;
    const bestEntries = Object.entries(meta.bestScores)
      .map(([lv, sc]) => ({ lv: Number(lv), sc }))
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 5);
    const recLines = [
      `累计击杀 ${t.kills}　通关 ${t.clears} 次　Boss 击破 ${t.bossKills}`,
      `最高连击 ${t.bestCombo}　最高正确率 ${Math.round(t.bestAccuracy * 100)}%`,
      bestEntries.length > 0
        ? `单关最佳：${bestEntries.map((e) => `L${e.lv} ${e.sc}分`).join(' · ')}`
        : '暂无关卡记录，去打出第一个最佳分吧！',
    ];
    const recText = scene.add
      .text(recX, bottomY + 34 * s, recLines.join('\n'), textStyle(Math.round(15 * s), css(Palette.text.secondary), { lineSpacing: 6 }))
      .setOrigin(0, 0);
    this.container.add([recTitle, recText]);

    // 关闭按钮（面板右上角）
    const closeBg = scene.add.graphics();
    const cbW = 92 * s;
    const cbH = 40 * s;
    const cbX = left + panelW - cbW - 20 * s;
    const cbY = top + 16 * s;
    closeBg.fillStyle(Palette.accent.primary, 1);
    closeBg.fillRoundedRect(cbX, cbY, cbW, cbH, 10);
    const closeText = scene.add
      .text(cbX + cbW / 2, cbY + cbH / 2, '关 闭', textStyle(Math.round(18 * s), css(Palette.text.onAccent), { fontStyle: 'bold' }))
      .setOrigin(0.5);
    const closeZone = scene.add
      .zone(cbX + cbW / 2, cbY + cbH / 2, cbW + 16, cbH + 16)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeZone.on('pointerdown', () => this.close(onClose));
    this.container.add([closeBg, closeText, closeZone]);

    // 点击面板外围空白处关闭
    const outside = scene.add.zone(w / 2, h / 2, w, h).setOrigin(0.5);
    outside.setInteractive({ useHandCursor: false });
    outside.on('pointerdown', () => this.close(onClose));
    outside.setDepth(-1);
    this.container.addAt(outside, 1);

    // ESC 关闭
    scene.input.keyboard?.once('keydown-ESC', () => this.close(onClose));
  }

  /** 面板是否已关闭 */
  get isClosed(): boolean {
    return this.closed;
  }

  private close(onClose: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.container.destroy();
    onClose();
  }

  /** 场景 shutdown 时兜底销毁 */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.container.destroy();
  }
}
