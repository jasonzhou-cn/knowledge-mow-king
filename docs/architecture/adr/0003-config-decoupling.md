# ADR-0003：数据与代码解耦 —— 四段式配置流水线（JSON → 类型 → 校验 → 解析 → 使用）

- **状态**：Accepted
- **日期**：MVP 立项
- **相关**：ADR-0002（零外部素材，配置里也不放展示内容）、ADR-0004（性能上限同样由配置驱动）

---

## Context

《知识割草王》的数值会**被反复调整**：割草手感要靠调参试出来，难度曲线要靠实测迭代（T-011），武器平衡要靠试玩反馈。如果数值散落在代码里，每一次调参都要：改代码 → 重新类型检查 → 重新构建 → 重新部署 → 重新验证，而且**调参的人必须会 TypeScript**。

真实的协作场景是：`tuning-lead` 需要改刷怪间隔与血量成长，`art-director` 需要改特效参数，他们都不应该被构建流程卡住。

同时，配置一旦外置，就引入了新的风险类别：

- JSON 是弱类型的，字段写错（`"hpMultiplierStart"` 打成 `"hpMultiplierStartt"`）、类型写错（`"45"` 写成字符串）、数值越界（把 `0.42` 打成 `42`），这些错误在编译期完全不可见；
- 错误会在运行到那一行时才炸，届时可能已经进入游戏、状态半初始化，表现是「莫名其妙的数值」而不是清晰的错误；
- 更糟的是**数值越界但不报错**（比如把池容量配成 0），会静默退化成「每帧动态创建对象」，直接违反 ADR-0004 的性能红线。

所以外置配置必须配一套**启动即校验、失败即中断**的机制。

关于校验的实现方式，GDD 里有一条明确约束：**不得引入 zod 之类的运行时校验库**。

---

## Decision

采用**四段式流水线**，每一段职责单一、边界清晰：

```
① public/config/*.json        数据：唯一数字来源
        │
② src/config/types.ts         类型：TS 接口，承接外部结构的形状
        │
③ src/config/validator.ts     校验：手写校验器，启动即 Fail Fast
        │
④ src/config/resolve.ts       解析：成长公式的唯一实现处
        │
⑤ ConfigLoader.getInstance().getConfig<T>()   使用：类型安全读取
```

**四条铁律：**

1. **数字只准出现在 `public/config/*.json`。** 业务代码里出现玩法调参数字（冷却 0.42、血量成长 4.6、同屏上限 45）即为缺陷，必须提到配置里。
2. **校验手写，禁止 zod / joi / ajv 等运行时校验库**（GDD 明确要求）。项目因此**没有运行时校验依赖**，`package.json` 的 `dependencies` 里只有 `phaser` 一项。
3. **启动校验失败即中断（Fail Fast）**，不降级、不填默认值、不静默修正。配置非法的状态下游戏不得启动。
4. **成长公式只在 `resolve.ts` 实现一次**，场景与 system 不得重复实现；`resolve.ts` 里不出现任何 Phaser 对象。

**配置清单**（8 个模块，`ConfigLoader.ts:18-27`）：`gameSettings`、`questionConfig`、`grassCuttingConfig`、`levelConfig`、`rewardConfig`、`subjectConfig`、`questionBank`、`weaponConfig`。

---

## Rationale

**为什么是「JSON + 手写校验 + 手写解析」三段，而不是直接 `JSON.parse` 后断言类型：**

`as GrassCuttingConfig` 这种类型断言是**零成本谎言**——它只是让 TypeScript 闭嘴，运行时该错还是错。真正需要的是启动时把外部数据「洗」成可信数据。手写校验器同时提供三样 TS 断言给不了的东西：**中文错误定位**（`grassCuttingConfig.performanceSettings.maxAliveMonsters` 这样的完整路径）、**区间与业务规则校验**（如 `validator.ts:639-643` 校验「对象池容量不得小于同屏上限」）、**一次跑完收集全部问题**而非遇到第一个就崩。

**为什么自己写而不用 zod：**

- **GDD 明文禁止**，这是硬约束，没有讨论空间。
- 客观上也确实不需要：zod 的价值在于「schema 即类型」的自动推导，而本项目的配置结构稳定、字段量大但形态简单（对象 / 数组 / 数字 / 字符串 / 布尔 / 枚举 / 十六进制色值），手写校验器（`validator.ts:47` 的 `Validator` 类）用 `object / array / number / integer / string / boolean / hexColor / custom / isRecord` 九个原语就全部覆盖了。
- 手写带来一个 zod 做不到的好处：**错误信息可以写成人话并带上调参指引**。例如 `validator.ts:643` 的报错不只是说「数值非法」，而是「对象池容量（N）小于同屏小怪上限（M），运行时会退化成动态创建，违反性能零妥协原则」——**直接把违反的架构原则告诉改配置的人**。
- 代价是 913 行的 `validator.ts`，这是本决策最大的成本，下面 Tradeoffs 里单列。

**为什么「失败即中断」而不是「填默认值继续跑」：**

外置配置的目的是让调参立即生效。如果配置错了游戏还能跑，那么调参的人会看到「数值没变」而不是「配置写错了」，排查成本从「读一条报错」变成「怀疑人生」。Fail Fast 把错误锁定在**启动瞬间、状态干净、位置明确**的时刻。实现上 `BootScene.bootstrap()`（`BootScene.ts:62-71`）捕获异常后调用 `showFatalError()` 渲染中文错误页并 `return`，**不会进入 MenuScene**。

**为什么成长公式要集中在 `resolve.ts`：**

同一条成长曲线会被多处消费：HUD 要显示当前武器伤害、模拟器要预演难度曲线、结算面板要展示加成。公式散落意味着任何一处改动都要同步 N 处。`resolve.ts:330` 的注释把这条写死了：**「所有成长公式集中在此，场景代码不得重复实现」**。

---

## Tradeoffs & Costs

1. **`validator.ts` 有 913 行，是项目里最大的单文件**（比 801 行的 `GrassCuttingScene` 还大）。这是本决策最重的成本，且**新增配置字段时需要在三处同步**：JSON + `types.ts` 接口 + `validator.ts` 校验。漏改任何一处都会造成「配置改了没效果」或「校验与实际脱节」。
   - 缓解方式：新增字段后，用 `npm run validate-config`（`scripts/validate-config.mjs`）在 Node 侧独立跑一遍校验，不必启动游戏。
2. **类型与校验是两份事实来源。** `types.ts` 声明 `hpMultiplierStart: number`，`validator.ts` 里再校验一次 `{ min: 0, max: 100 }`。TypeScript 只能保证形状，区间约束只能靠运行时校验，两者天然不同步。
3. **错误只能在运行时发现。** 尽管有 `npm run validate-config` 可以提前跑，但它不是 `npm run build` 的一部分（`package.json:9` 只有 `tsc --noEmit && vite build`）。**改完配置不跑校验就直接构建，是可能把非法配置打进产物的。**
4. **配置热更新与缓存的语义需要小心。** `ConfigLoader` 缓存校验通过的 `cache`（`ConfigLoader.ts:39`），`hotReloadConfig()`（`:96`）用于热更新。**热更新同样会走完整校验**（因为校验在写入 cache 之前），但热更新期间若新配置非法，cache 的替换时机需要调用方自己保证一致性。
5. **死字段会长期滞留。** 见 `ARCHITECTURE.md` 第 6.5 节：`playerSkillSettings` 等字段在玩法改造后曾长期滞留，完整走完「JSON → 校验 → 解析」三步却没有任何消费者（已于 commit 82a4499 四层删除）。**删字段必须四层一起删**（JSON + types + validator + resolve），只删一半会留下最难排查的「幽灵配置」。

---

## Consequences

| 阶段 | 内容 | 文件:行 |
| --- | --- | --- |
| ① 数据 | 8 个配置文件 | `public/config/*.json` |
| ② 加载 | 模块清单 | `src/config/ConfigLoader.ts:18-27`（`CONFIG_MODULES`） |
| ② 加载 | 并行 fetch，不加工 | `src/config/ConfigLoader.ts:59-69` |
| ③ 校验 | 总入口 `validateAllConfigs` | `src/config/ConfigLoader.ts:75` 调用 → `src/config/validator.ts:202` |
| ③ 校验 | 文件缺失检查 + 8 个模块逐个校验 + 汇总抛错 | `src/config/validator.ts:215-240` |
| ③ 校验 | `Validator` 类（9 个原语） | `src/config/validator.ts:47` |
| ③ 校验 | 8 个模块的校验函数 | `validator.ts:400`（gameSettings）、`464`（questionConfig）、`565`（grassCuttingConfig）、`661`（weaponConfig）、`749`（levelConfig）、`794`（rewardConfig）、`837`（subjectConfig）、`859`（questionBank） |
| ③ 校验 | 业务规则校验示例：池容量 ≥ 同屏上限 | `src/config/validator.ts:639-643` |
| ③ 校验 | 错误类型与中文消息合成 | `src/config/validator.ts:18-23`（`ConfigValidationError`） |
| ④ 解析 | `resolveLevelPackage`（关卡完整数值包） | `src/config/resolve.ts:332` |
| ④ 解析 | `resolveWeapons`（武器三件套落点） | `src/config/resolve.ts:235`（伤害）、`:237`（冷却）、`:238`（射程） |
| ④ 解析 | `computeGrassCuttingBonus`（答题质量 → 三项乘数） | `src/config/resolve.ts:469` |
| ④ 解析 | `resolveLevel` | `src/config/resolve.ts:441` |
| ⑤ 使用 | `getConfig<T>()` 类型安全读取 | `src/config/ConfigLoader.ts:117` |
| ⑤ 使用 | 未加载时抛错提醒 | `src/config/ConfigLoader.ts:119` |
| Fail Fast | 校验失败 → 致命错误页，不进 MenuScene | `src/scenes/BootScene.ts:62-71` + `src/utils/FatalError.ts:14` |
| Fail Fast | 题库加载失败同样阻断 | `src/scenes/BootScene.ts:73-78` |

**改数值的标准动作**：改 `public/config/*.json` → 跑 `npm run validate-config` → 刷新页面（dev 下 Vite 会热更新 `public/`）→ 验证效果。**全程不需要改一行 TS，不需要重新构建。**

**新增配置字段的标准动作**（四处，缺一不可）：

1. `public/config/*.json` 加字段；
2. `src/config/types.ts` 对应接口加声明；
3. `src/config/validator.ts` 对应 `validateXxx()` 加校验（含区间）；
4. `src/config/resolve.ts` 加到 `ResolvedXxx` 产出里，并在消费方使用。

**禁止事项**：不得在 `src/` 里写死玩法数值；不得引入 zod / joi / ajv；不得在校验失败时填默认值继续运行；不得在 `resolve.ts` 里创建 Phaser 对象。
