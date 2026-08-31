# 知识割草王 · Knowledge Mowing King

一款面向 9–18 岁的「**答题 → 无双割草**」休闲游戏 MVP。玩家先答对题目拿到加成（加成会直接强化当前武器），然后进入 60 秒生存关，用大刀 / 机关枪 / 霰弹枪抵挡从四面八方持续涌来的小怪，活到倒计时结束。

- 核心设计：答题质量（正确率 / 速度 / 连对）是决定割草爽感的唯一因素 —— 答得越好，手上这把武器就越猛。
- 技术栈：Phaser 3 + Vite 5 + TypeScript
- 美术与音效：**零外部素材**。所有图形由 `Graphics` 程序化生成（`BootScene.generateTextures()`），所有音效用 WebAudio 合成。
- 逻辑分辨率：960 × 640（Scale.FIT 自适应窗口）

---

## 环境要求

- Node.js **18+**（推荐 20+）
- npm（随 Node 自带）

---

## 快速开始（三步）

```bash
npm install      # 安装依赖（只需一次）
npm run dev      # 启动开发服务器
```

浏览器打开 **http://localhost:5173** 即可游玩。

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器，热更新，端口 5173 |
| `npm run build` | 类型检查（`tsc --noEmit`）+ 构建到 `dist/` |
| `npm run preview` | 本地预览 `dist/` 构建产物 |
| `npm run typecheck` | 仅做 TypeScript 类型检查 |
| `npm run validate-config` | 校验 `public/config/*.json` 的字段合法性 |
| `npm run smoke` | 冒烟测试（构建后跑 esbuild 轻量试跑） |

> 首次运行若 `npm install` 慢，属正常现象（Phaser 体积较大）。

---

## 操作说明

### 答题阶段

- 4 个答案**固定显示在屏幕中央**（不再移动），一个高亮箭头（金色描边 + 顶部 ▼）在选项间循环跳转（默认每 1.2 秒跳一格）。
- 在目标选项高亮时按下确认键即视为选中，箭头指向正确答案即答对：
  1. **点击屏幕任意位置**；或
  2. 按 **空格**。
- 答题越快越准、连对越多，进入割草时武器越强。
- 想切回原「移动答案 + 停住判定」玩法：把 `public/config/questionConfig.json` 的 `answerSettings.mode` 改为 `"track"` 即可（保留可配置）。

### 割草阶段

| 操作 | 按键 |
|---|---|
| 走位 | `WASD` 或 方向键 |
| 攻击（自动瞄准最近目标，手动触发） | 鼠标点击 / `J` |
| 切换武器（直切） | `1` / `2` / `3` |
| 切换武器（循环） | `Q`（上一个）/ `E`（下一个） |
| 切换武器（触屏） | 点击底部武器栏 |

目标：活到 60 秒倒计时结束。三把武器特性不同 —— 大刀近战高伤强击退、机关枪远程连发、霰弹枪中距扇形弹幕，按场景切换。

> **移动端状态**：PC 端（键盘 + 鼠标）和移动端（触屏摇杆 + 点击武器栏）均已可完整游玩。手机首次交互会自动尝试全屏（Android Chrome 生效）以获得最佳体验。

---

## 如何调参（不改代码）

所有可调数值都在 **`public/config/*.json`**，改 JSON 即生效，无需改动任何 `.ts` 代码（这是项目的硬性架构约束）：

| 配置 | 主要作用 |
|---|---|
| `grassCuttingConfig.json` | 战斗核心数值：玩家属性、怪物、难度曲线、性能上限 |
| `weaponConfig.json` | 三把武器的伤害 / 冷却 / 射程 / 击退 |
| `gameSettings.json` | 全局设置（含关卡时长上下限） |
| `questionConfig.json` / `questionBank.json` | 答题规则与题库 |

改完用 `npm run validate-config` 校验字段合法性。

---

## 项目结构

```
src/
  scenes/     场景：Boot（程序化生成纹理）/ Menu / Question / GrassCutting / Result
  systems/    无状态游戏逻辑：战斗、武器、弹丸、怪物、连击、击杀特效、答题、配置加载
  ui/         纯展示与输入转发：HUD、武器栏、调色板
  config/     JSON → 类型 → 手写校验 → 解析 的四段式管线
public/config/  可调数值（见上）
docs/          架构文档与 ADR（见 docs/ARCHITECTURE.md）
scripts/       验证脚本（CDP 无头试玩 / 配置校验 / 冒烟）
```

---

## 架构与文档

- 完整架构说明：`docs/ARCHITECTURE.md`
- 关键设计决策（ADR）：`docs/architecture/adr/` 下 0001 技术栈 / 0002 零素材 / 0003 配置解耦 / 0004 无物理性能红线 / 0005 无双战斗模型
- 当前版本交付范围、未实现项与后续建议：`docs/DELIVERY.md`

---

## 已知限制（MVP 范围）

- 无 Boss 关、无动态难度（DDA）、无云存档、无家长监控
- 无背景音乐（仅有音效）
