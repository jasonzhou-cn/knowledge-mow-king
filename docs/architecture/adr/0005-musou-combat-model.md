# ADR-0005：无双战斗模型 —— 自动瞄准 + 手动触发，答题质量是当前武器强度的唯一决定项

- **状态**：Accepted
- **日期**：T-006 无双生存打兵改造时确定（替代此前的「自动施放环形 AOE 技能 + 按波次刷怪」模型）
- **相关**：ADR-0003（加成走配置与解析链）、ADR-0004（顿帧/特效受池化与配额约束）、GDD 1.3 核心绑定原则

> **这是本项目最重要的一个设计决策。** 它定义了「答题」和「割草」这两半游戏是如何咬合在一起的。如果对本项目只能读一篇 ADR，读这篇。

---

## Context

《知识割草王》的产品命题是「**答对题 → 割草更爽**」。这个命题实现得好不好，取决于一件事：**玩家能不能感知到「我刚才答得好」和「我现在割得爽」之间的因果链。**

T-006 之前的模型是：小怪按波次刷，玩家自动施放环形 AOE 技能。它有两个结构性问题：

1. **玩家没有操作。** 技能自动触发，玩家只需要移动躲避。割草段退化成「看着数字跳动」，没有手感可言，也就承接不住答题带来的正反馈。
2. **答题与割草的绑定是间接的。** 加成作用在「技能」上，而技能是自动施放的，玩家很难把「割得爽」归因到「我答得好」。

同时有一个现实约束：**目标用户最小 9 岁**。操作模型必须在一秒内学会，不能有复杂的连招、不能有需要精确瞄准的操作（尤其在触屏上）。

另外，GDD 1.3 有一条**核心绑定红线**，它是整个产品的立身之本：

> **答题质量（正确率 / 速度 / 连击）是割草手感的唯一核心决定项。** 答得越好，当前的武器就越强。

这条红线决定了加成的落点必须是**武器**，而不是某个抽象的全局倍率。

---

## Decision

### D1. 操作模型：自动瞄准 + 手动触发

**玩家只负责两件事：移动、按住攻击。瞄准交给系统。**

- **自动瞄准**：`WeaponSystem.resolveFacing()`（`WeaponSystem.ts:107-140`）在 `searchRadius = 460` 内找**最近的存活小怪**（距离平方比较，无开方），把武器朝向朝目标平滑转动，转向速率上限 `aimAssistAngle = 1080` 度/秒（`weaponConfig.json:6`）——即每秒最多转 3 圈，既能跟上快速横跳的目标，又不会出现朝向瞬移。`autoAim.enabled = false` 时回退到玩家移动朝向。
- **手动触发**：攻击键 `J` / 空格 **按住连发**（`GrassCuttingScene.ts:335`，`addKey(code, true, false)` 的第二个参数为 `true` 即启用自动重复）。指针按下同样视为攻击（`isAttackHeld()`，`:370-375`）。
- **朝向每帧刷新**：`GrassCuttingScene.updateFacing()`（`:420-428`）调用 `resolveFacing`，结果存入 `this.facing`，同时驱动角色旋转（`:432`）与武器贴图。

**为什么自动瞄准**：9 岁用户在触屏上无法用虚拟摇杆精确瞄准。把瞄准交给系统后，操作复杂度降到「走位 + 按住」，而走位本身仍然是策略（往怪堆里冲 vs 拉开距离），保留了技巧空间。**瞄准是负担，走位才是乐趣**——这是本决策的核心判断。

### D2. 三把武器与切换方式

三把武器覆盖三种手感（`weaponConfig.json:30-85`）：

| id | 名称 | 攻击类型 | 伤害 | 冷却 | 射程 | 特点 |
| --- | --- | --- | --- | --- | --- | --- |
| `blade` | 大刀 | `melee_sector` | 34 | 0.42s | 132 | 130° 扇形横扫，击退 300，顿帧 70ms——**单次爆发最强** |
| `smg` | 机关枪 | `ranged_bolt` | 9 | 0.09s | 620 | 780 px/s 弹丸、穿透 1、抖动 4°——**高频低伤，按住不放的爽感** |
| `scatter` | 霰弹枪 | `ranged_spread` | 13 | 0.62s | 300 | 5 颗弹丸、26° 扇形、击退 150——**近身清群** |

切换提供**三种并行路径**，覆盖键鼠与触屏：

1. **直切**：`1` / `2` / `3`（`GrassCuttingScene.ts:337-339`）
2. **循环**：`Q` 上一把 / `E` 下一把（`:341`）
3. **点击武器栏**：`WeaponBar` 的三个热区；点在武器栏上**只切武器、不触发攻击**——`onPointerDown`（`:84-86`）先用 `weaponBar.contains(x, y)` 判断，命中就直接 `return`

三条路径最终都汇到 `switchWeapon(index)`（`:362-367`），由 `WeaponSystem.switchTo()` 执行，再同步武器栏高亮与武器贴图。**切换是瞬时的，没有切枪硬直**——这是刻意的：割草的节奏不允许被切枪打断。

### D3. 打击感三件套

割草手感不是靠数值，是靠**反馈**。三件套全部在击杀瞬间触发（`GrassCuttingScene.onMonsterKilled`，`:596-612`）：

**① 顿帧（hitstop）**

- 击杀时把 `scene.time.timeScale` 压到 **0.05**，持续 `hitstopDuration` 毫秒（`KillFxSystem.requestHitstop`，`KillFxSystem.ts:98-106`）。
- 三把武器的顿帧时长不同：**大刀 70ms / 机关枪 18ms / 霰弹枪 40ms**。大刀砍死一只怪的停顿感最强，机关枪则几乎不停顿——**用顿帧时长区分武器性格**，这是最重要的手感差异化手段。
- **两条保护**：顿帧期间不叠加（`KillFxSystem.ts:101`）；两次顿帧之间必须间隔 `hitstopMinInterval = 90` ms（`:102`）。否则高连击时会把游戏卡成永久慢动作。
- **顿帧倒计时必须用真实（未缩放）时间**：`GrassCuttingScene.update()` 的第一个动作就是用 `rawDt` 推进（`GrassCuttingScene.ts:292-294`）。若用被缩放的 dt，70 ms 在 `timeScale = 0.05` 下会被拉成 1.4 秒。**这是本项目最容易踩的坑之一。**

**② 击杀爆散（burst）**

一次击杀同时给出三层视觉（`KillFxSystem.burst`，`KillFxSystem.ts:129-187`）：

- **碎片飞散** `shardCount = 5` 片，初速 240 px/s，寿命 0.42s，阻力 4；
- **扩散环** 从 0.35 倍放大到 2.6 倍，历时 280 ms；
- **白色闪光** 90 ms。

全部走 Sprite 对象池，全部有硬上限（见 ADR-0004）。

**③ 增强击退**

- 击杀时的击退量乘以 **`killKnockbackMultiplier = 2.6`**（`weaponConfig.json:17`）。
- 普通命中击退按武器配置（大刀 300 / 机关枪 40 / 霰弹枪 150）；**击杀瞬间击退翻 2.6 倍**，尸体被明显地「炸开」，形成可见的连锁位移。
- 配合 `corpseLife = 0.3s`、`corpseSpin = 12`、`corpseDrag = 3`，尸体在 0.3 秒内旋转飞出并减速，数量上限 12 具（FIFO 复用，见 `MonsterSpawner.ts:387-392`）。

**④ 相机震动（辅助）**

按武器区分强度：大刀 0.006（正好是 GDD 上限）/ 机关枪 0.0015 / 霰弹枪 0.004。近战命中时 0.006/130ms（`GrassCuttingScene.ts:488`），远程开火时减半 80ms（`:523`），击杀时完整强度 140ms（`:611`）。

**连击档位**：连击 ≥ `comboBigThreshold = 10` 进入大连击档，≥ `comboHugeThreshold = 25` 进入超大连击档（`GrassCuttingScene.comboTier`，`:615-620`），档位影响飘字颜色与大小。

### D4. 核心绑定：答题质量 → 当前武器（GDD 1.3 红线）

**加成只落在当前武器上，不作用于任何全局倍率。** 落点有三项，且三项的语义**不是对称的**（这是最容易搞错的地方）：

| 乘数 | 落点 | 代码 | 语义 |
| --- | --- | --- | --- |
| `damageMultiplier` | 武器伤害 | `resolve.ts:235` | 相乘，答得越好伤害越高 |
| `rangeMultiplier` | 武器射程 | `resolve.ts:238` | 相乘，答得越好范围越大 |
| **`durationMultiplier`** | **武器冷却的除数** | `resolve.ts:237` | **`cooldown = w.cooldown / max(0.01, bonus.durationMultiplier)`** |

**⚠️ 语义变更（重要）**：`durationMultiplier` 这个名字继承自「技能持续时间」时代，但**它现在的实际作用是冷却除数**——答得越好，数值越大，冷却越短，**攻速越快**。它的名字已经不能反映语义，HUD 文案也随之从「持续」改为「**攻速**」（`Hud.setBonus`，`Hud.ts:128-131`，展示为 `答题加成 伤害 ×N 范围 ×N 攻速 ×N`）。

**加成的计算**：`computeGrassCuttingBonus()`（`resolve.ts:469-518`），公式对三项完全一致：

```
raw = baseBonus × subjectCoefficient × accuracyTerm × speedFactor × comboFactor
  baseBonus    = 1 + (level - 1) × baseBonusGrowthPerLevel
  accuracyTerm = clamp(1 + (accuracy - accuracyBaseline) × accuracyWeight, min, max)
  speedFactor  = clamp(speedFactorBase + (1 - avgTime / timeLimit) × speedFactorWeight, min, max)
  comboFactor  = clamp(1 + maxCombo × comboFactorPerCombo, 1, comboFactorMax)
```

三个输入正好对应 GDD 红线里的三项答题质量：**正确率（accuracy）→ accuracyTerm、速度（avgTime/timeLimit）→ speedFactor、连击（maxCombo）→ comboFactor**。

**软失败保护（GDD 2.1）**：结果按 `multiplierFloor`（当前 0.6）保底。正确率 0% 的玩家不会陷入「伤害太低 → 割不动 → 体验更差」的死亡螺旋，最低也保住 60% 强度。

**绑定是一次性结算、整局恒定**：加成在 `QuestionScene` 答完题时算出（`QuestionScene.ts:292-298`），随 `scene.start` 传入割草场景，在 `GrassCuttingScene.create()` 里通过 `resolveLevelPackage(input, level, bonus)` 一次性落到武器数值上（`resolve.ts:332-336`），**场景运行期间不再变化**。这让数值可预测、可复现，也让「我这一局该打得爽」的预期是稳定的。

---

## Rationale

**为什么是「自动瞄准 + 手动触发」而不是全手动或全自动：**

- **全自动（旧模型）**没有操作感，割草段无法承接答题的正反馈；
- **全手动瞄准**对 9 岁用户 + 触屏是不可用的；
- 折中方案把「操作」从**精度要求**（瞄准）转移到**决策要求**（何时进攻、往哪走、用哪把武器），既降低了门槛，又保住了策略深度。

**为什么顿帧是最重要的手感手段：** 顿帧是唯一能在**不增加任何渲染开销**的前提下放大打击感的手段。它把 70 ms 的世界暂停压缩成一次「咔」的冲击感，而代价只是把一个变量改成 0.05 再改回来。相比之下，加粒子、加屏幕特效都会吃掉 ADR-0004 的预算。**但顿帧必须受节流保护**——它的成本是玩家的「时间」，用多了就变成卡顿。

**为什么用顿帧时长区分武器性格：** 三把武器的数值差异（伤害/冷却/射程）玩家在战斗中感知不到，但「砍死一只怪时那一下停顿」是**身体记忆级别**的差异。大刀 70 ms 让每次击杀都有分量，机关枪 18 ms 让连杀顺滑不卡手——同样的击杀，完全不同的情绪。

**为什么加成必须落在「当前武器」而不是全局：** GDD 1.3 的核心命题是「答得好 → 割得爽」，而玩家感知「割得爽」的载体就是**手上这把武器的表现**。如果加成落在全局倍率或小怪血量上，玩家只会觉得「怪变弱了」，而不是「我变强了」。落在武器上，玩家能直接对比：上次用大刀两刀砍死，这次一刀。

**为什么 `durationMultiplier` 要改成冷却除数：** 三项加成里，伤害和射程都是「越大越好、直接相乘」。第三项若仍是「持续时间」，对**非持续型武器（扇形横扫、弹丸）**根本没有语义——大刀的挥砍没有持续时间。改成冷却除数后，它同时对所有三种攻击类型生效，且是玩家感知最强的一项（出手频率）。**这是为了让红线在三种武器上都成立而做的语义适配。**

**为什么加成整局恒定：** 动态变化的倍率会让玩家无法建立「我这一局有多强」的稳定预期，也会让调参与实测变得不可复现。一次结算、整局恒定，是「可感知」与「可调试」的共同要求。

---

## Tradeoffs & Costs

1. **自动瞄准削弱了操作上限。** 高手无法通过精准瞄准获得额外收益，技巧空间被压缩到走位与武器选择。这是为低龄用户可上手性付出的代价。
   - 保留的调节旋钮：`searchRadius`（460）、`aimAssistAngle`（1080 度/秒）都在配置里，两者调低即可让瞄准更「笨」，回归更多手动成分。
2. **`durationMultiplier` 名不副实。** 字段名叫「持续倍数」，实际是「冷却除数」。这是从技能时代继承下来的命名债务，任何读 `resolve.ts:237` 的人都会愣一下。
   - 连带影响：`subjectCoefficientSettings` 里的 `skillDamageCoefficient` / `skillRangeCoefficient` 实际驱动的是**武器**而非技能（见 `ARCHITECTURE.md` 第 6.6 节）。重命名需要同步改 6 处。
3. **切换武器无硬直，理论上存在「切换取消后摇」的利用空间。** 当前武器没有后摇动作，所以不构成 exploit；但若将来加入后摇，必须同时加入切枪硬直。
4. **顿帧会真实消耗玩家的关卡时间。** `timeScale` 影响的是整个 `scene.time`，而关卡倒计时 `updateTimer(dt)` 用的是缩放后的 dt（`GrassCuttingScene.ts:319`），因此**顿帧期间倒计时是暂停的**——这对玩家有利，不会因打得爽而损失时间。
5. **无双改造曾留下死配置（已清理）。** `playerSkillSettings`、`maxActiveSkillZones`、`monster.perWave/waveCount/waveInterval` 在新模型下无人消费，曾完整走完「JSON → 校验 → 解析」三步。该遗留项已于 commit 82a4499 从四层（JSON + types + validator + resolve）清理完成，审计记录见 `ARCHITECTURE.md` 第 6.5 节。
6. **移动端攻击依赖按住屏幕，而按住屏幕也是移动输入的天然载体。** 触屏时代「左手移动、右手攻击」的分工尚未实现，攻击目前只能靠 `pointerDown`（`GrassCuttingScene.ts:84-86`）。真正的移动端适配需要一个独立的攻击按钮。

---

## Consequences

| 内容 | 文件:行 |
| --- | --- |
| **自动瞄准** `resolveFacing`（最近目标 + 转向速率上限） | `src/systems/WeaponSystem.ts:107-140` |
| 每帧刷新朝向 | `src/scenes/GrassCuttingScene.ts:420-428`；角色旋转 `:432` |
| 攻击键（J / 空格，按住连发） | `src/scenes/GrassCuttingScene.ts:335` |
| 直切 1/2/3、循环 Q/E | `src/scenes/GrassCuttingScene.ts:337-339` / `:341`；处理 `:349-359` |
| 切换统一入口 | `src/scenes/GrassCuttingScene.ts:362-367` |
| 指针攻击；点在武器栏上不攻击 | `src/scenes/GrassCuttingScene.ts:84-86` |
| 攻击触发 → 近战扇形 / 远程弹丸 | `src/scenes/GrassCuttingScene.ts:464-469`（updateAttack）、`:472-524`（performAttack） |
| **顿帧** requestHitstop（含不叠加 + 最小间隔节流） | `src/systems/KillFxSystem.ts:98-106` |
| **顿帧** 用真实 dt 倒计时 | `src/scenes/GrassCuttingScene.ts:292-294` |
| **爆散** burst（碎片 + 扩散环 + 白闪） | `src/systems/KillFxSystem.ts:129-187` |
| **增强击退** 击杀击退 × 2.6 | `public/config/weaponConfig.json:17` |
| 击杀结算总入口（飘字 + 爆散 + 顿帧 + 震动） | `src/scenes/GrassCuttingScene.ts:596-612` |
| 连击档位 | `src/scenes/GrassCuttingScene.ts:615-620`；阈值 `weaponConfig.json:27-28` |
| **核心绑定**：伤害落点 | `src/config/resolve.ts:235` |
| **核心绑定**：冷却除数落点 | `src/config/resolve.ts:237` |
| **核心绑定**：射程落点 | `src/config/resolve.ts:238` |
| **核心绑定**：三项乘数计算 + 软失败保底 | `src/config/resolve.ts:469-518`（floor 应用 `:500-504`） |
| 加成在答题结束时结算并传入割草场景 | `src/scenes/QuestionScene.ts:292-298` |
| 加成一次性落到武器上（整局恒定） | `src/config/resolve.ts:332-336` |
| HUD 展示（伤害 / 范围 / **攻速**） | `src/ui/Hud.ts:128-131` |
| 三把武器数值 | `public/config/weaponConfig.json:30-85` |
| 自动瞄准参数 | `public/config/weaponConfig.json:3-7` |
| 击杀特效参数 | `public/config/weaponConfig.json:8-29` |
| 移动输入（移动端接入点） | `src/scenes/GrassCuttingScene.ts:380-395`（含边界 clamp `:393-394`） |

**改动战斗时的自检清单**：

1. 新增武器？→ 在 `weaponConfig.json` 加一条 + 在 `BootScene.makeWeapons()`（`BootScene.ts:295-323`）生成同名 `weapon-<id>` 贴图，**业务代码不需要改**（贴图 key 由 id 拼接，见 `GrassCuttingScene.weaponTextureKey`，`:453-456`）。
2. 改手感？→ 优先调 `killFx` 段（`weaponConfig.json:8-29`）与每把武器的 `hitstopDuration` / `shakeIntensity` / `knockback`，这些是直接作用于身体感受的参数。
3. 动顿帧逻辑？→ **必须确认倒计时用的是未被 timeScale 缩放的 dt**，且节流保护（`hitstopMinInterval`）仍然生效。
4. 动加成公式？→ 必须确认 `multiplierFloor` 保底仍在，且三项乘数的落点（`resolve.ts:235/237/238`）没有变成全局倍率。**把加成改成作用于小怪血量或全局伤害，就是违反 GDD 1.3 红线。**
5. 改了第三项乘数的语义？→ HUD 文案（`Hud.ts:128-131`）必须同步改，玩家看到的词必须和实际生效的东西一致。
