# 《知识割草王》MVP 架构文档

> **文档状态**：T-001 编写，基线为 T-010 工程债清理完成后的代码。
> **技术栈**：Phaser 3 + Vite 5 + TypeScript，**无外部美术/音频素材**。
> **逻辑分辨率**：**960 × 640**（不是 1280×720，见 ADR-0001）。
> **配套决策记录**：`./adr/` 下 5 篇 ADR，本文第 5 节是它们的红线摘要。
>
> 阅读顺序建议：先看第 1、2 节建立全局心智模型，再看第 4 节理解数值是怎么流到屏幕上的，动手改代码前必须读第 5 节的红线清单。

---

## 1. 五场景流程

MVP 只有一条主循环，五个场景首尾相接，没有分支关卡树：

```
BootScene ──► MenuScene ──► QuestionScene ──► GrassCuttingScene ──► ResultScene
                  ▲                                                      │
                  └──────────────────────────────────────────────────────┘
                        （返回菜单）        （再来一次 → 直接回 QuestionScene）
```

| 场景 | 文件 | 职责 | 出口（文件:行） |
| --- | --- | --- | --- |
| BootScene | `src/scenes/BootScene.ts` | 同步生成**全部**程序化贴图，然后立刻切走。**没有 `preload`** —— 项目零外部资源，无需加载等待 | → MenuScene `BootScene.ts:83` |
| MenuScene | `src/scenes/MenuScene.ts` | 标题 + 关卡选择/开始，组装本局的 `level` 数据 | → QuestionScene `MenuScene.ts:185` |
| QuestionScene | `src/scenes/QuestionScene.ts` | 答题主界面，`QuizEngine` 驱动出题/判题/连击；结束后调用 `computeGrassCuttingBonus` 算出「答题质量 → 割草加成」并展示结算面板 | → GrassCuttingScene `QuestionScene.ts:375` |
| GrassCuttingScene | `src/scenes/GrassCuttingScene.ts` | 无双割草主玩法。纯编排层：持有并调度 7 个 system + 3 个 UI 组件 | → ResultScene `GrassCuttingScene.ts:785`；数据异常兜底 → MenuScene `GrassCuttingScene.ts:135` |
| ResultScene | `src/scenes/ResultScene.ts` | 结算（得分/连击/星级/奖励），提供「再来一次 / 返回菜单」 | 再来一次 → QuestionScene `ResultScene.ts:130`；返回 → MenuScene `ResultScene.ts:41` / `:134` |

**两条硬性约定：**

1. **场景之间只通过 `scene.start(key, data)` 的 `data` 传参**，不用全局变量、不用事件总线传业务数据。`GrassCuttingScene` 的入参对象在源码里就叫 `data0`，持有 `level`、`quiz`（答题结果）、`bonus`（三项乘数）等。
2. **入口只有一个**：`src/main.ts:38` 的 `new Phaser.Game(config)`。场景注册顺序即上述流程顺序，BootScene 排第一。

---

## 2. 分层约定

代码分四层，判定标准写在表格最后一列，**新增代码时先问自己符合哪一条**：

| 层 | 目录 | 允许做什么 | 禁止做什么 | 判定标准（出现即违规） |
| --- | --- | --- | --- | --- |
| **编排层** | `src/scenes/` | 生命周期（`create` / `update` / `shutdown`）、持有并 `new` 各 system、按固定顺序每帧调用、把 system 回调翻译成表现（HUD 数值、特效、音效）、读输入把意图转发给 system | 直接写命中判定、直接做血量减法、直接操作对象池 | 出现「距离平方比较」「`hp -=`」「`acquire()/release()`」 |
| **逻辑层** | `src/systems/` | 无状态（或只持有自己的池）的游戏逻辑：命中结算、刷怪、弹道、连击、进度、音效合成、击杀特效 | 反向持有 Scene、直接改 HUD 文本、自己读键盘 | 出现 `this.scene.add.text(` 或 `this.input.keyboard` |
| **表现层** | `src/ui/` | 纯展示 + 输入转发。构造时接收 `scene` 和一份数据快照，暴露 `setXxx()` 供编排层调用；交互控件（如武器栏）只发回调，不自己改游戏状态 | 读配置、做数值计算、判断游戏胜负 | 出现 `ConfigLoader` 或四则运算公式 |
| **数据层** | `src/config/` | 加载 JSON、校验结构、解析成长公式产出 `ResolvedLevelPackage` | 创建任何 Phaser 对象、写死玩法数值 | 出现 `import Phaser` 或魔法数字 |

辅助目录：`src/utils/`（纯函数 + 致命错误兜底）、`src/data/`（题库数据访问封装）。

### 为什么 Scene 不直接写战斗逻辑

这是本项目的**第一分层原则**，理由按重要性排序：

1. **场景会被反复销毁重建**。「答题 → 割草 → 结算 → 再来一次」是 MVP 的核心循环，`GrassCuttingScene` 一局就要 `shutdown` 一次。逻辑若写在 Scene 里，就得跟着场景一起反复构造/销毁，池化对象全部失效；抽成 system 后，Scene 只负责把参数传进去。
2. **战斗逻辑要能被单独验证**。T-010 的无头浏览器实测需要读取「当前同屏怪数 / 碎片池占用 / 武器索引」，这些都必须有稳定的宿主；散落在 Scene 里的局部变量读不到，挂在 system 上则可以用只读 getter 暴露（见 `GrassCuttingScene.ts:272` 的调试句柄设计思路）。
3. **`GrassCuttingScene` 已经 800 行了**。它现在 800 行里几乎全是「调度 + 表现 + 生命周期」；如果再把刀光扇形判定、弹道推进、尸体飞散全塞进去，会膨胀到 2000 行以上，且任何一个手感参数调整都要在长文件里翻找。
4. **同一份逻辑要被多处复用**。`CombatSystem.applyHit` 同时被刀光近战、SMG 弹丸、散弹颗粒三条攻击路径调用；写在 Scene 里就只能复制三份。

**编排层唯一允许的「游戏判断」是顺序**：`GrassCuttingScene.update()`（`GrassCuttingScene.ts:289-321`）决定了「先跑顿帧倒计时（真实 dt）→ 再用缩放后的 dt 跑其余系统 → 最后刷 HUD」的执行顺序，这个顺序本身就是玩法的一部分，所以它留在 Scene 里。

---

## 3. 目录结构

```
Knowledge_Battle/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── public/config/                  ← 全部可调数值（8 个 JSON，唯一数字来源）
│   ├── gameSettings.json           (48)   全局设置 + 答题加成公式参数（floor/ceiling/权重）
│   ├── grassCuttingConfig.json     (86)   割草玩法：玩家/技能/小怪/连击/难度曲线/性能上限
│   ├── levelConfig.json            (124)  关卡表：学科、题量、时限、难度缩放
│   ├── questionBank.json           (547)  题库正文
│   ├── questionConfig.json         (74)   答题节奏：题量成长、时限、连击窗口
│   ├── rewardConfig.json           (40)   连击奖励档位
│   ├── subjectConfig.json          (30)   学科展示名与技能名
│   └── weaponConfig.json           (87)   三把武器的数值 + 自动瞄准 + 击杀特效参数
│
└── src/                            ← 28 个 .ts 文件
    ├── main.ts                     (39)   Phaser.Game 唯一入口；定义 GAME_WIDTH/GAME_HEIGHT
    │
    ├── config/                            数据层：加载 → 校验 → 解析
    │   ├── ConfigLoader.ts         (158)  单例；并行 fetch 8 个 JSON，校验通过后缓存，提供 getConfig<T>()
    │   ├── validator.ts            (913)  手写校验器（Validator 类 + 8 个 validateXxx），启动即 Fail Fast
    │   ├── types.ts                (495)  全部配置结构的 TS 接口 + 解析后的 ResolvedXxx 类型
    │   └── resolve.ts              (519)  唯一允许写成长公式的地方：resolveLevelPackage / resolveWeapons / computeGrassCuttingBonus
    │
    ├── scenes/                            编排层
    │   ├── BootScene.ts            (325)  程序化贴图工厂（Graphics → generateTexture）；导出 WEAPON_TEXTURE_PREFIX
    │   ├── MenuScene.ts            (188)  标题与开始
    │   ├── QuestionScene.ts        (477)  答题 + 加成结算面板
    │   ├── GrassCuttingScene.ts    (801)  割草主场景（纯编排，无战斗算法）
    │   └── ResultScene.ts          (276)  结算
    │
    ├── systems/                           逻辑层（无状态 / 自持对象池）
    │   ├── QuizEngine.ts           (211)  答题状态机：出题、判题、连击、计时
    │   ├── AnswerTrack.ts          (390)  答题过程记录（正确率/平均耗时/最大连击）→ QuizResult
    │   ├── WeaponSystem.ts         (176)  武器持有与冷却；resolveFacing 自动瞄准；tryAttack 产出 AttackAction
    │   ├── CombatSystem.ts         (206)  命中结算中心：扇形扫描 sweepSector + applyHit（击退 → 伤害 → 死亡）
    │   ├── ProjectileSystem.ts     (263)  池化弹丸，按弹丸半径做子步进防穿透
    │   ├── MonsterSpawner.ts       (449)  四边刷怪 + 难度曲线插值 + 击杀/尸体飞散（FIFO 复用）
    │   ├── KillFxSystem.ts         (343)  打击感三件套：顿帧、碎片/扩散环/白闪、相机震动
    │   ├── ComboSystem.ts          (97)   连击窗口计时与档位
    │   ├── ProgressionSystem.ts    (241)  关卡进度与得分累计
    │   ├── RewardSystem.ts         (171)  连击奖励发放
    │   └── SfxController.ts        (103)  WebAudio 程序化音效（无音频文件）
    │
    ├── ui/                                表现层（纯展示 + 输入转发）
    │   ├── Palette.ts              (118)  配色常量与文本样式工厂
    │   ├── Hud.ts                  (270)  顶部血条/时间/得分/连击 + 左下「答题加成」文本
    │   ├── WeaponBar.ts            (214)  底部三格武器栏（程序化贴图图标 + 点击热区）
    │   └── Feedback.ts             (218)  飘字与击杀提示
    │
    ├── utils/
    │   ├── MathUtil.ts             (107)  clamp / lerp / smoothstep / 距离平方等纯函数
    │   └── FatalError.ts           (33)   配置致命错误的统一抛出口
    │
    └── data/
        └── QuestionBank.ts         (195)  题库读取与抽题封装
```

> 括号内为文件行数（`wc -l` 结果）。

---

## 4. 核心数据流

### 4.1 配置流：JSON → 加载 → 校验 → 解析 → 使用

```
① public/config/*.json           8 个文件，全部可调数值的唯一来源
        │
        │  ConfigLoader.loadAllConfigs()            ConfigLoader.ts:59
        │  并行 fetch（Promise.all），不做任何加工
        ▼
② 原始 JSON（unknown）
        │
        │  validateAllConfigs(raw)                  ConfigLoader.ts:75 → validator.ts:202
        │  ↓ 失败：抛错 + FatalError 页面，游戏不启动（Fail Fast）
        ▼
③ ConfigModuleMap（缓存到单例）
        │
        │  getConfig<T>(module)                     ConfigLoader.ts:117
        ▼
④ resolve.ts 的解析函数
        ├─ resolveLevelPackage(input, level, bonus) resolve.ts:332  → 关卡完整数值包
        ├─ resolveWeapons(...)                      resolve.ts:235-238（武器三件套落点）
        ├─ computeGrassCuttingBonus(...)            resolve.ts:469   → 答题质量三项乘数
        └─ resolveLevel(...)                        resolve.ts:441
        ▼
⑤ ResolvedLevelPackage（types.ts）→ GrassCuttingScene.create() 分发给各 system
```

**四个阶段各自的铁律：**

| 阶段 | 载体 | 铁律 |
| --- | --- | --- |
| ① 数据 | `public/config/*.json` | **数字只准出现在这里**。业务代码里出现 `0.42`、`4.6` 这类调参数字就是缺陷 |
| ② 加载 | `ConfigLoader.loadAllConfigs()` | 只负责取回原文，不做加工、不填默认值 |
| ③ 校验 | `validator.ts` | **手写校验，禁止引入 zod 等运行时校验库**（GDD 明确要求）；任一字段非法即在启动时中断 |
| ④ 解析 | `resolve.ts` | **成长公式的唯一实现处**，场景与 system 不得重复实现 |

### 4.2 一局游戏的数据流（答题 → 割草 → 结算）

```
MenuScene                    选关，得到 level
    │  scene.start('QuestionScene', { level })
    ▼
QuestionScene                QuizEngine 出题判题
    │  AnswerTrack 产出 QuizResult{ accuracy, averageAnswerTime, maxCombo }
    │  computeGrassCuttingBonus(quiz, level, subjectCoefficient, settings, timeLimit)
    │                                                        resolve.ts:469
    │  → BonusMultipliers{ damageMultiplier, rangeMultiplier, durationMultiplier }
    │  scene.start('GrassCuttingScene', { level, quiz, bonus })
    ▼
GrassCuttingScene.create()
    ├─ resolveLevelPackage({...}, level, bonus)              resolve.ts:332
    │     内部 resolveWeapons 把三项乘数落到武器上：
    │       damage   = 基础伤害 × 成长 × 学科系数 × bonus.damageMultiplier    resolve.ts:235
    │       cooldown = 基础冷却 ÷ max(0.01, bonus.durationMultiplier)        resolve.ts:237
    │       range    = 基础射程 × 学科系数 × bonus.rangeMultiplier           resolve.ts:238
    ├─ 分发：player/monster/difficulty → MonsterSpawner
    │        weapons/autoAim          → WeaponSystem
    │        killFx/performance       → KillFxSystem / CombatSystem
    └─ 每帧 update()：spawner → weaponSystem → combat → projectiles → killFx
    │
    │  onMonsterKilled 回调：combo++、score+=、killFx.burst()、killFx.requestHitstop()
    │  scene.start('ResultScene', payload)                   GrassCuttingScene.ts:785
    ▼
ResultScene                  ProgressionSystem / RewardSystem 结算
```

**关键设计：加成只在 `resolveLevelPackage` 这一处消费。** 场景中途不会动态改伤害倍率 —— 一次答题的结果在一局割草里是恒定的，这让数值可预测、可复现，也便于调参。

---

## 5. 关键约束清单（5 条 ADR 红线）

改动代码前逐条自检，任何一条被破坏都要先在 ADR 里说明理由并更新本表。

| # | 红线 | 具体表现 | 落地代码 | 违反后果 |
| --- | --- | --- | --- | --- |
| 1 | **零外部素材**（ADR-0002） | 所有贴图由 `BootScene.generateTextures()` 用 `Graphics → generateTexture()` 生成；所有音效由 `SfxController` 用 WebAudio 合成；仓库内不得出现 `.png/.jpg/.mp3/.wav` | `BootScene.ts:98-111` 及 11 个 `makeXxx()`；`SfxController.ts` 的 `TONES` 表 | 跨平台字形/素材不一致；包体与加载态膨胀 |
| 2 | **数据与代码解耦**（ADR-0003） | 数字只在 `public/config/*.json`；校验手写（禁止 zod）；启动校验失败即中断 | `ConfigLoader.ts:59/75`；`validator.ts:47`（Validator 类）、`:202`（总入口） | 调参要重新构建；线上静默降级 |
| 3 | **不使用物理引擎**（ADR-0004） | 无 Arcade / Matter，无 collider；命中用「跳帧 + 距离平方（不开根）」；所有池有硬上限 | `CombatSystem.ts:110`（sweepSector）、`:156`（applyHit）；`grassCuttingConfig.json` 的 `performanceSettings` | 帧率崩塌 |
| 4 | **无双战斗模型**（ADR-0005） | 自动瞄准 + 手动触发；打击感三件套（顿帧/爆散/增强击退）；**答题质量是当前武器强度的唯一决定项** | `WeaponSystem.ts:107`（resolveFacing）；`KillFxSystem.ts:98`（requestHitstop）、`:129`（burst）；`resolve.ts:237` | 玩法失去核心绑定 |
| 5 | **逻辑分辨率固定 960×640**（ADR-0001） | 所有布局常量以 960×640 为基准书写，用 `Scale.FIT` 自适应 | `main.ts:16/17`、`:26` | 布局错位（历史上按 1280×720 算过一次，全部白算） |

**两条来自 GDD 的硬性能约束**（与 ADR-0004 配套，改特效时必须同时满足）：

- **`ParticleEmitter` 数量 = 0**：所有特效只能用 Sprite 对象池，不得使用 Phaser 的粒子发射器。当前实现在 `KillFxSystem.ts:83-85` 预分配三个池（碎片 / 扩散环 / 白闪）。
- **相机震动 ≤ 0.006 强度 / 160 ms 时长**：见 `GrassCuttingScene.ts:657` 的 `cameraShake(this, 0.006, 160)`，以及 `KillFxSystem.ts:243` 受 `cameraShakeEnabled` 开关保护的 `shake()`。

---

## 6. 已知取舍与债务

以下每条都是**当前代码里的既成事实**，不是「未来计划」。括号内为可定位到行的证据。

### 6.1 移动端虚拟摇杆未实现

- 现状：移动输入只有物理键盘一条路径，`GrassCuttingScene.ts:380` 的 `updateMovement` 消费 `getMoveVector()`（`:401`），后者只读方向键（`:404-409`）与 WASD（`:410` 起）。手机上没有任何移动手段。
- 接入点已经留好：`getMoveVector()` 的注释（`GrassCuttingScene.ts:399`）写明「改为读取虚拟摇杆的归一化向量即可，其余逻辑无需改动」。真正的改造量在于新增一个摇杆 UI 组件 + 指针事件，不在 `GrassCuttingScene` 里。
- 连带影响：攻击同样依赖键盘（J / 空格，见 `GrassCuttingScene.ts:335`），移动端需要补攻击按钮或改为自动开火。
- 取舍理由：MVP 交付目标以桌面浏览器验证为主，摇杆属于输入层扩展，不阻塞核心闭环。

### 6.2 `__KB_DEBUG__` 调试句柄仍留在 `create()` 末尾

- 位置：`GrassCuttingScene.ts:272-286`（紧随 `this.showIntro()` 之后）。
- 结构：只读 getter 对象，挂在 `window.__KB_DEBUG__` 上，暴露 `scene / weaponId / weaponIndex / weaponCount / kills / score / combo / aliveMonsters / hp / timeLeft / elapsed / projectiles`。取值失败返回 `null`，**不伪造值**；`get scene()` 在 `this.ended` 为真时返回 `'Ended'`，供外部脚本识别场景已切走。
- 风险：它是为无头浏览器（CDP）自动化验证（T-008 回归 / T-010 实测）临时开的口子，**不驱动任何游戏逻辑，可安全删除**，但出厂前应移除或改为 `import.meta.env.DEV` 条件挂载。
- 注意：它持有 `const self = this` 闭包，若忘记在 `shutdown` 时清理会滞留旧场景引用（当前 `shutdown()` 在 `GrassCuttingScene.ts:789`，未清理该句柄——**这是一处真实泄漏，删除时应一并处理**）。

### 6.3 地图边界：有屏幕硬边界，但没有「地图」

- **修正一处常见误解**：玩家**不能**走出可视区。`GrassCuttingScene.ts:393-394` 把玩家 clamp 在 `[margin, width - margin] × [margin + 64, height - margin]`，其中上边界多留 64px 给顶部 HUD。
- 真正的取舍是：这张「地图」就是一屏，没有更大的世界、没有摄像机跟随、没有地形碰撞，走到边缘是贴着一堵看不见的硬墙。割草场景的空间策略因此被压缩成「一屏内的走位」。
- 若要扩展为更大的地图，需要同时改：移动 clamp、怪物四边生成的 `spawnMargin`（`MonsterSpawner.ts`）、以及相机跟随——三处耦合，改动前应先评估。

### 6.4 武器栏热区向下外扩的 32px，只有 10px 落在可视区内

- T-010 按需求把点击热区扩到 `SLOT_W × (SLOT_H + 32)`（`WeaponBar.ts:96`），`bounds` 同步外扩（`:117`）。
- 但格子本身的 `startY = 640 - 10 - 56 = 574`，格子底边在 **630**，而逻辑画布高 **640**。因此向下外扩出的 630→662 区间里，**只有 630→640 这 10px 是玩家真正能点到的**，其余 22px（含 `bounds` 底面 668）在画布之外。
- 结论：功能上达标（实测点 (366,602)、(480,630)、(594,602) 均正确切换，见 `reports/t010/measure.txt`），但扩展收益被画布高度吃掉了 2/3。若要真正提升移动端点击舒适度，正确解法是**整体上移武器栏**或**减小 `BOTTOM_MARGIN`**（`WeaponBar.ts:46`），而不是继续加大 `HIT_EXTEND_DOWN`。

### 6.5 死配置：无双改造后遗留的「技能 / 波次」字段（已于 82a4499 清理，本节保留为审计记录）

> **状态更新（commit 82a4499）**：本节列出的全部字段已从四层（JSON + `types.ts` + `validator.ts` + `resolve.ts`）删除。下表保留为**审计记录**，表中「无消费者」判断为删除前的核查证据。

这是本次写文档过程中核查出来的**最值得处理的一项债务**（现已清理）。以下字段当时仍在 JSON 里、仍被校验、仍被解析进 `ResolvedLevelPackage`，但**没有任何运行时代码消费它们**：

| 字段 | 配置位置 | 校验 | 解析 | 消费方 |
| --- | --- | --- | --- | --- |
| `playerSkillSettings`（11 个字段） | `grassCuttingConfig.json:10-23` | `validator.ts:578-589` | `resolve.ts:348` 读取、`:373-383` 产出 `packed.skill` | **无**（全项目无 `packed.skill` 读取点）——✅ 已于 82a4499 清理 |
| `performanceSettings.maxActiveSkillZones` | `grassCuttingConfig.json:64` | `validator.ts:631` | `resolve.ts:424` | **无**——✅ 已于 82a4499 清理 |
| `monster.perWave` | — | — | `resolve.ts:389` | **无**（新刷怪器是连续生成，不再按波次）——✅ 已于 82a4499 清理 |
| `monster.waveCount` | `levelConfig` 的 `monsterWaveCount` | — | `resolve.ts:390` | **无**——✅ 已于 82a4499 清理 |
| `monster.waveInterval` | — | — | `resolve.ts:392` | **无**——✅ 已于 82a4499 清理 |

- 成因：T-006 无双改造把战斗从「自动施放环形 AOE 技能 + 按波次刷怪」改成了「三武器主动攻击 + 连续刷怪」，但配置与解析链没有同步清理（该债已于 82a4499 清偿）。
- 实际危害（清理前）：
  1. **误导调参**：`tuning-lead` 可能在 `playerSkillSettings` 里调数值，却完全看不到效果（该字段已删除，此风险不复存在）。
  2. **校验成本**：11 个字段每帧启动都要校验，虽然开销可忽略，但维护者会误以为它们是活的。
  3. **误导交接**：新人读 `resolve.ts:373-383` 会以为存在「技能系统」，然后去找，找不到。
- 建议：确认无后续技能计划后，一次性删除 JSON 字段 + `validator` 校验 + `types` 接口 + `resolve` 产出。**已执行**：经确认 GDD 无「后续版本加回主动技能」规划后，上述四层已于 commit 82a4499 一并删除，并经回归验证通过。

### 6.6 命名债务：`skillXxxCoefficient` 实际驱动的是武器，不是技能

- `subjectCoefficientSettings.<学科>.skillDamageCoefficient` / `skillRangeCoefficient` 现在被当作「武器伤害系数 / 武器射程系数」使用：`resolve.ts:344-345` 取出后传给 `resolveWeapons`（`:406`），落点为 `resolve.ts:235`（伤害）与 `:238`（射程）。
- 同一份系数还被 `QuestionScene.ts:290` 取用，作为 `computeGrassCuttingBonus` 的 `subjectDamageCoefficient` 入参，直接影响玩家看到的「伤害 ×N」。
- 即：**字段名还叫 skill，语义已经变成 weapon**。与 6.5 的死字段不同，这两个是活字段，只是名字过期。
- **⚠️ 读代码时不要被名字误导**：看到 `skillDamageCoefficient` / `skillRangeCoefficient`，请直接理解为「武器伤害系数 / 武器射程系数」。项目里已经没有任何「技能」概念，这两个名字是自动环形 AOE 时代的遗物。
- **本轮（MVP）决定只记录不改名**：改名要动 `subjectConfig.json` / `grassCuttingConfig.json` / `types.ts:249-250` / `validator.ts:651-652` / `resolve.ts:344-345` / `QuestionScene.ts:290` 六处，风险大于收益。若将来改名，这六处必须一次改完。

### 6.6.1 音效系统已实现但全项目零调用点

- `src/systems/SfxController.ts` 提供了 `sfx.play(name)` 与 6 个程序化合成音效（`stop`/`correct`/`wrong`/`kill`/`hurt`/`levelUp`），但**全项目没有任何 `import` 或调用点**——grep `sfx` / `SfxController` 只在本文件内命中。
- 后果：**当前游戏是完全静音的**。`SfxController.ts:54` 那句「击杀音在割草场景可能高频触发」的注释描述的是一个并不存在的场景。
- 该模块的节流能力已在 T-013-A 中实现并实测通过（`scripts/t013-sfx-throttle.mjs`，6/6 PASS），接入点是 `sfx.bind(audioSettings)`（由编排层在配置校验通过后调用，参照 `BootScene.bootstrap` 里 `progression.bind` 的位置）+ 在击杀/受伤/答题回调里调 `sfx.play(...)`。
- **接入时务必同时做两件事**：① 在 `public/config` 里加音频配置并走完四段式管线，替换掉文件内的 `DEFAULT_MIN_INTERVAL_MS` 兜底常量；② 接入后重跑一次节流实测，确认没有把音效接成「高频叠加」。

### 6.7 同屏上限存在两个来源，靠 `Math.min` 兜底

- `monsterSettings.monsterMaxAlive` 与 `performanceSettings.maxAliveMonsters` 语义重复，`resolve.ts:354` 用 `Math.min` 取小者作为最终 `maxAlive`。
- 当前两者都是 45，结果一致；但 `validator.ts:639-643` 还额外校验「池容量不得小于同屏上限」。改动任一侧都要同时看另一侧，属于典型的双源配置风险。

### 6.8 打包为单文件 bundle，未做代码分割

- `vite build` 产出单个 `assets/index-*.js`，体积约 **1.59 MB（gzip 372 KB）**，其中绝大部分是 Phaser 3 本体。
- MVP 阶段的取舍：单文件部署简单、无运行时加载态，且本项目没有路由级懒加载需求。
- 若后续要压首屏，优先级是：开启 gzip/brotli 压缩 → Phaser 按需引入（custom build）→ 最后才考虑拆包。

### 6.9 构建环境：`dist/assets` 历史产物堆积会触发安全删除守卫

- 现象：执行 `npm run build` 时，vite 的 `emptyDir` 会尝试清空 `dist/assets`，若其中累积超过 50 个历史文件，会被沙箱的批量删除守卫拦截并报错 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，**看起来像构建失败，实际是环境问题，不是代码问题**（32 个模块均已成功 transform）。
- 规避：清理 `dist/` 后重新构建，或临时构建到其他目录。
- 当前工作区残留 `dist-cdp*` 等临时构建产物目录，需要手工清理（写本文档时无法在会话内删除）。

### 6.10 MVP 范围外、GDD 已规划但未实现

以下均**不在 MVP 交付范围**，不是缺陷：Boss 战、动态难度调节（DDA）、云存档、家长控制面板。需求与验收口径以 GDD 为准。

---

## 附录：验证记录索引

| 事项 | 产物 |
| --- | --- |
| 无头浏览器全流程回归（菜单→答题→割草→结算） | `scripts/cdp-playthrough.mjs`，截图在 `reports/cdp/` |
| T-010 五项工程债实测数据（布局间距、点击热区、特效池峰值） | `scripts/cdp-t010.mjs`，数据在 `reports/t010/measure.txt` |
| T-010 实测结论 | 碎片池峰值 32/60、扩散环 5/18、白闪 3/18，三类池撞顶次数均为 **0**，当前配置不击穿（详见 ADR-0004） |
