# ADR-0004：性能零妥协 —— 不使用物理引擎，命中判定用「跳帧 + 距离平方」，一切资源有硬上限

- **状态**：Accepted
- **日期**：MVP 立项
- **相关**：ADR-0001（960×640 逻辑分辨率）、ADR-0003（性能上限同样由配置驱动）

---

## Context

割草玩法的性能特征非常极端：**同屏数十个移动单位、每秒数十次命中判定、每帧成百上千个特效对象在动，且这一切必须稳定在 60 FPS**。掉帧对割草游戏是致命的——玩家对「割草快感」的感知直接来自操作的即时响应，任何卡顿都会被理解为「手感差」。

目标设备里包含低配 Windows 台式机与中低端手机，没有性能余量可以浪费。

Phaser 3 内置 Arcade Physics 与 Matter.js 两个物理引擎，开箱即用，能自动处理碰撞检测、分离、反弹。对绝大多数游戏这是正确答案，但对本项目不是：

1. **我们需要的不是物理模拟，是命中判定。** 割草不需要刚体、不需要弹性碰撞、不需要小怪之间互相推挤。Arcade 会为每个 body 维护速度、加速度、阻力、包围盒并做空间划分，这些计算全部是浪费。
2. **碰撞事件会引入不可控的时序。** 物理引擎在 update 的固定阶段处理碰撞，与「跳帧检测」这类自定义节流策略天然冲突，也很难精确控制「同一帧内先击退还是先扣血」这样的结算顺序（而顺序在本项目里是有语义的，见 `CombatSystem.ts:153` 的注释）。
3. **GDD 的碰撞精简原则（GDD 1.2）** 明确要求：碰撞检测要能被节流，且开销可预测。

另外有两条来自 GDD 的硬性能配额，它们是本 ADR 的边界条件：

- **`ParticleEmitter` 数量 = 0**：不允许使用 Phaser 的粒子发射器，特效只能靠 Sprite 对象池手动推进。
- **相机震动 ≤ 0.006 强度 / 160 ms 时长**。

---

## Decision

**1. 完全不引入物理引擎。**

`src/main.ts:19-36` 的 `Phaser.GameConfig` **没有 `physics` 字段**——既没有 `arcade` 也没有 `matter`。全项目（28 个 `.ts` 文件）中不存在任何 `physics` / `arcade` / `matter` / `collider` / `overlap` 的碰撞用法（唯一含 `overlap` 字样的是 `AnswerTrack` 的答题卡重叠率判定 `AnswerTrack.ts:296-317`，与物理无关）。

**2. 命中判定 = 跳帧 + 距离平方 + 点积。**

- **跳帧**：`CombatSystem.shouldCheckThisFrame()`（`CombatSystem.ts:102-104`）用 `frameCounter % damageCheckFrameInterval === 0` 决定是否本帧检测。当前 `damageCheckFrameInterval = 2`（`grassCuttingConfig.json:62`），即**每 2 帧检测一次**。接触伤害等高频判定共用同一个节拍，保证全场景检测密度一致。
- **距离平方**：`sweepSector`（`CombatSystem.ts:110-148`）先用 `distSq = dx*dx + dy*dy` 与 `radiusSq` 比较做预筛（`:125-126`，**完全不开方**），只对通过预筛的候选者做一次 `Math.sqrt` 归一化（`:129`）用于点积判角。
- **点积判角代替 atan2**：用 `dot = (dx/len)*axisX + (dy/len)*axisY` 与 `cos(halfAngle)` 比较（`:131-132`），避免三角函数。

**3. 一切资源有硬上限，全部由 `performanceSettings` 配置驱动**（`grassCuttingConfig.json:60-70`）：

| 上限项 | 当前值 | 含义 |
| --- | --- | --- |
| `maxAliveMonsters` | 45 | 同屏存活小怪上限（与 `monsterSettings.monsterMaxAlive` 取 `Math.min`） |
| `damageCheckFrameInterval` | 2 | 每 N 帧做一次命中检测 |
| `maxHitTextAlive` | 12 | 同屏伤害飘字上限 |
| `monsterPoolSize` | 96 | 小怪对象池容量 |
| `projectilePoolSize` | 120 | 弹丸对象池容量 |
| `shardPoolSize` | 60 | 击杀碎片池容量 |
| `ringPoolSize` | 18 | 扩散环池 / 白闪池容量（两者共用该值） |
| `corpsePoolSize` | 12 | 尸体飞散上限（T-010 由 16 下调至 12） |

**4. 池化的两条实现纪律：**

- **`acquire()` 必须自己把对象标记为 active。** 否则连续 acquire 会拿到同一个槽位。`KillFxSystem.acquire()`（`KillFxSystem.ts:321-329`）与 `MonsterSpawner` 的取池逻辑都遵守这条。
- **池满时的策略要显式定义，不能静默退化成动态创建。** `validator.ts:639-643` 直接校验「池容量不得小于同屏上限」，从配置层杜绝退化。尸体飞散则采用 **FIFO 复用**：满了就先回收最老的一具（`MonsterSpawner.ts:387-392`），保证「刚刚这一刀」一定有反馈，而不是被旧尸体占着名额。

**5. 特效只用 Sprite 对象池，相机震动受开关与配额双重约束。**

- `KillFxSystem` 构造时预分配三个池：碎片（`fx-shard`）、扩散环（`zone-ring`）、白闪（`glow`），见 `KillFxSystem.ts:83-85`。**没有任何 `ParticleEmitter`。**
- 相机震动统一走 `KillFxSystem.shake()`（`KillFxSystem.ts:243-246`），受 `cameraShakeEnabled` 开关保护；玩家受伤时的震动为 `cameraShake(this, 0.006, 160)`（`GrassCuttingScene.ts:657`），正好等于 GDD 上限。

**6. 顿帧用真实时间推进。** `GrassCuttingScene.update()` 的第一个动作是用**未被 timeScale 缩放的 dt** 推进顿帧倒计时（`GrassCuttingScene.ts:292-294`），之后其余系统才使用缩放后的 dt（`:297`）。若用缩放后的 dt 倒计时，`timeScale = 0.05` 会把 70 ms 的顿帧拉成 1.4 秒。

---

## Rationale

**为什么跳帧检测是可接受的：** 割草场景的判定对象是**移动缓慢的小怪**，玩家一帧移动约 5–8 px，2 帧内位移不超过 16 px，而小怪碰撞半径 18 px、攻击射程 132 px 起。跳 1 帧带来的判定误差在玩家感知之外，却把最高频的那部分计算砍掉一半。这是典型的「用可接受的精度换确定的帧时间」。

**为什么距离平方 + 点积而不是 `Phaser.Math.Distance`：** 距离平方比较省掉的是**每个候选者一次 `Math.sqrt`**。45 个小怪 × 每帧一次扇形扫描 = 每秒 2700 次开方，省下来的量在低端设备上是可观测的。点积判角同理，避开了 `atan2` 和角度环绕处理。

**为什么所有上限都要配置化：** 性能参数是最需要按设备档位调的东西。写在代码里意味着每换一档设备就要重新构建；写在 `performanceSettings` 里意味着可以为低配设备下发一套更小的数值，代码一行不改。

**为什么 `ParticleEmitter` 配额是 0：** 粒子发射器会一次性创建大量对象并按自己的节奏销毁，其峰值内存与创建开销不受对象池硬上限约束，与本 ADR 的「一切资源有硬上限」直接冲突。手写 Sprite 池则可以把峰值数量**在构造时就固定下来**（`KillFxSystem.ts:83-85` 的 `preallocate`），内存占用完全可预测。

---

## Tradeoffs & Costs

1. **没有现成的碰撞回调，所有判定都要手写。** 扇形扫描、弹丸推进、接触伤害三套判定逻辑分别在 `CombatSystem`、`ProjectileSystem`、`GrassCuttingScene.updateContact` 里自己实现，代码量与维护成本高于接一个物理引擎。
2. **高速弹丸需要自己处理穿透。** 780 px/s 的 SMG 弹丸在 16.7 ms 内前进 13 px，而弹丸半径只有 5 px，直接按位移推进会穿过小怪。解决办法是**子步进**：把每次推进的距离限制在弹丸半径以内（`ProjectileSystem`）。这是物理引擎免费提供、本项目必须自己写的东西。
3. **没有小怪之间的分离。** 多个小怪会重叠站在同一位置。这是刻意的割草设计（割草就是要能把怪聚成一堆一次清掉），但代价是视觉上偶尔会出现完全重叠的怪。
4. **跳帧检测在极端情况下会漏判。** 若某帧 dt 很大（切后台回来、长卡顿），跳帧窗口内的位移可能超过小怪半径。当前 `rawDt = Math.min(delta, 100) / 1000`（`GrassCuttingScene.ts:293`）把单帧 dt 钳制在 100 ms 以内，缓解了这一点，但没有彻底解决。
5. **池容量配小了会牺牲表现。** `corpsePoolSize` 从 16 下调到 12 就是拿「尸体飞散的丰富度」换「明确的数量上限」。这类取舍需要实测数据支撑，不能拍脑袋——见下节的实测结论。

---

## 实测结论（T-010，特效池是否击穿）

**结论：当前配置不击穿，无需调整池容量。**

测试方法：无头 Edge（CDP）加载生产构建，脚本化操控角色持续移动并攻击，每 100 ms 采样一次三个池的占用，持续约 50 秒。脚本 `scripts/cdp-t010.mjs`，原始数据 `reports/t010/measure.txt`。

| 指标 | 实测峰值 | 池容量 | 是否击穿 |
| --- | --- | --- | --- |
| 击杀碎片（shards） | **32** | 60 | 否（占用 53%） |
| 扩散环（rings） | **5** | 18 | 否（占用 28%） |
| 白闪（flashes） | **3** | 18 | 否（占用 17%） |
| 碎片池撞顶次数 | **0** | — | — |
| 扩散环池撞顶次数 | **0** | — | — |
| 白闪池撞顶次数 | **0** | — | — |

测试期间的其他观测值：**同屏小怪峰值 45**（已到 `maxAliveMonsters` 上限）、**击杀数 189**、**运行时长约 50 秒**（约 3.8 杀/秒）。

**外推校验**：按 team-lead 在另一轮测试中观测到的更高强度（305 杀 / 60 秒 ≈ 5 杀/秒）线性外推，碎片峰值约 42，仍低于 60 的容量，余量约 30%。因此即便在比本次实测更激进的节奏下，当前配置仍不击穿。

**注意一处与需求描述不符的事实**：需求中提到 `KillFxSystem.ts` 里存在 `MAX_FX_SPRITES = 24` 这个常量，**实际代码中不存在该常量**。真实的三个池容量来自配置（`shardPoolSize` 60 / `ringPoolSize` 18，白闪复用 `ringPoolSize`），在 `KillFxSystem.ts:83-85` 处 `preallocate`。修改特效池容量请改 `public/config/grassCuttingConfig.json:67-68`，代码里没有写死的数字。

---

## Consequences

| 内容 | 文件:行 |
| --- | --- |
| **无物理引擎**（GameConfig 无 `physics` 字段） | `src/main.ts:19-36` |
| 跳帧检测 | `src/systems/CombatSystem.ts:102-104` |
| 扇形扫描（距离平方预筛 + 点积判角） | `src/systems/CombatSystem.ts:110-148`（预筛 `:125-126`，判角 `:131-132`） |
| 单次命中结算（击退先于扣血） | `src/systems/CombatSystem.ts:156-180`（顺序说明见 `:153`） |
| 弹丸子步进防穿透 | `src/systems/ProjectileSystem.ts` |
| 三个特效池的预分配（无 ParticleEmitter） | `src/systems/KillFxSystem.ts:83-85` |
| 池 `acquire()` 必须自标记 active | `src/systems/KillFxSystem.ts:321-329` |
| 尸体 FIFO 复用（池满先回收最老的） | `src/systems/MonsterSpawner.ts:387-392` |
| 顿帧用真实 dt 推进 | `src/scenes/GrassCuttingScene.ts:292-297` |
| 相机震动（≤ 0.006 / 160ms） | `src/scenes/GrassCuttingScene.ts:657`；开关 `src/systems/KillFxSystem.ts:243-246` |
| 全部性能上限配置 | `public/config/grassCuttingConfig.json:60-70` |
| 池容量 ≥ 同屏上限的业务校验 | `src/config/validator.ts:639-643` |
| 无 ParticleEmitter 的架构声明 | `src/systems/KillFxSystem.ts:10`、`src/scenes/GrassCuttingScene.ts:20` |

**改动特效/战斗时的自检清单**：

1. 新增了持续存在的游戏对象吗？→ 必须进对象池，且池容量必须进 `performanceSettings`；
2. 新增了每帧执行的判定吗？→ 能否复用 `shouldCheckThisFrame()` 的节拍？能否用距离平方预筛？
3. 使用了 `ParticleEmitter` 吗？→ 禁止，改用 Sprite 池；
4. 使用/加大了相机震动吗？→ 强度 ≤ 0.006、时长 ≤ 160 ms；
5. 改完特效后，**必须重跑一次 `scripts/cdp-t010.mjs` 的峰值采样**，用数据确认池没有击穿，不要靠估算。
