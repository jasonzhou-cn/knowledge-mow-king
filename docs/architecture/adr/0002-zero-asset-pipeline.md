# ADR-0002：零外部素材 —— 全部图形程序化生成，全部音效用 WebAudio 合成

- **状态**：Accepted
- **日期**：MVP 立项
- **相关**：ADR-0001（技术栈）、ADR-0003（数据与代码解耦）

---

## Context

MVP 的资源现实是：**没有人专职出美术，没有音频素材，没有素材采购预算，交付时间紧**。同时产品还要在 Windows、macOS、Android、iOS 的浏览器上表现一致。

如果走常规路线（找美术出图、找音效库买音），会立刻撞上三个问题：

1. **时间**：素材制作/采购/切图/导入的周期比核心玩法开发还长。
2. **交付体积与加载态**：图片与音频会显著推大包体，且需要一个真实的 `preload` 阶段与加载进度界面。
3. **协作摩擦**：任何一个「改一下这个按钮颜色」的需求都要回到美术、重新导出、重新合入，拖慢迭代。

另一个更隐蔽但更致命的问题是**跨平台一致性**。项目里一度出现过「用 emoji 当图标」的做法（详见下面第 5 节的违规案例），它暴露了零素材约束真正的边界：**任何依赖系统字体的字符渲染，都不是「零素材」，而是把素材依赖悄悄转移给了操作系统**。

---

## Decision

**项目内不得出现任何外部素材文件（`.png/.jpg/.svg/.mp3/.wav/.ogg/.ttf` 等）。所有视觉与听觉资产在运行时生成：**

1. **图形**：`BootScene.generateTextures()`（`BootScene.ts:98-111`）在启动时调用 11 个 `makeXxx()` 方法，每个方法用 `Phaser.GameObjects.Graphics` 画出形状，再调用 `generateTexture(key, w, h)` 落成一张可复用的贴图。
2. **统一白色 + 运行期 tint**：所有贴图一律画成白色（`BootScene.ts:97` 的注释明确了这条），运行期靠 `setTint()` 上色。一份贴图可以复现出任意颜色的同类元素，池化时不需要按颜色分池。
3. **贴图 key 集中管理**：`TextureKeys` 常量对象（`BootScene.ts:20-33`）收录通用贴图；武器贴图走「前缀 + 配置 id」的约定——`WEAPON_TEXTURE_PREFIX = 'weapon-'`（`BootScene.ts:40`），贴图 key 即 `weapon-<id>`，业务代码不需要维护「id → 贴图」映射表。
4. **音效**：`SfxController`（`src/systems/SfxController.ts`）用 WebAudio 的 `OscillatorNode` + `GainNode` 实时合成，参数集中在 `TONES` 表（`SfxController.ts:28-35`）。全站只暴露 `sfx.play(name)` 一个接口（`SfxController.ts:102` 导出单例）。
5. **没有 `preload` 阶段**：因为无资源可加载，Phaser 的 `preload` 钩子完全不需要。`BootScene.create()`（`BootScene.ts:50-56`）先同步生成贴图，再异步 `bootstrap()`（`:59-84`）加载配置与题库，全部成功后 `scene.start('MenuScene')`（`:83`）。**启动路径上唯一的等待是 8 个配置 JSON 的 fetch，没有任何素材下载。**

---

## Rationale

**为什么程序化生成而不是「先占位、后替换」：**

- 生成代码本身就是一份**可 diff、可 review、可版本管理的「美术源文件」**。改刀身长度是改 `fillTriangle` 的一个坐标（`BootScene.ts:300`），比改一张 PNG 更精确，也不会有切图误差。
- **零素材下载**让启动路径极短：启动的唯一等待是 8 个配置 JSON 的 fetch（`BootScene.ts:59-84`），`public/` 目录下除了 `config/` 之外没有任何文件，因此没有素材加载进度条，也不需要设计加载界面。
- **白色 + tint** 的约定让对象池极度简化：碎片、弹丸、扩散环都只需要一个池，颜色在运行期给。这对 ADR-0004 的池化上限策略是前提条件。

**为什么音效也自己合成：**

- MVP 需要的音效只有 6 个（答对/答错/停住/击杀/受伤/升级），都是极短的提示音，用振荡器合成完全够用，而且**改听感就是改 `TONES` 表里的一行数字**，不需要重新导出音频文件。
- `SfxController.play()` 把整个实现包在 `try/catch` 里静默吞掉异常（`SfxController.ts:80-82`），并延迟到首次调用时才创建 `AudioContext`（`:86-98`），规避浏览器自动播放策略。**音效故障永远不会阻断游戏主流程。**

**为什么不引入字体文件：** 文本一律使用系统字体栈 + Phaser 内置 Text。这是本 ADR 唯一允许的「外部依赖」，因为引入 `.ttf` 的收益（品牌字体）远小于成本（体积 + 加载 + 授权）。**但这也划出了红线：可以依赖系统字体渲染文字，不可以依赖系统字体渲染图形。**

---

## Tradeoffs & Costs

1. **视觉表现力有天花板。** 程序化 Graphics 只能画出几何剪影，`BootScene.ts:295-323` 的三把武器就是「矩形 + 三角」级别的剪影。做出精致的角色立绘、场景背景是不可能的。MVP 阶段接受，因为割草玩法的可读性主要靠**颜色区分 + 运动轨迹 + 特效**，不靠细节精度。
2. **每次新增图形都要写生成代码，启动时有一次性 CPU 开销。** 11 个 `makeXxx()` 在 `BootScene` 里同步执行，随着图形增多，`BootScene` 会持续膨胀（当前 325 行）。若将来贴图数量上到几十张，需要拆出独立的 `textures/` 模块。
3. **调图形不如调图片直观。** 美术同学无法用可视化的方式参与，只能在代码里调坐标。这是本项目对美术协作方式的实质改变，需要在协作流程上适配。
4. **WebAudio 合成音的音质是「提示音」级别**，无法替代有质感的打击音效。这是刻意取舍：割草手感的重头在**视觉反馈（顿帧 + 爆散 + 击退）**，音效只是辅助。
5. **⚠️ 违规案例：武器栏曾用 emoji 当图标（已修复）。** 这是本 ADR 最值得记住的一条，单列在下面。

---

## 已发生的违规与修复（必读）

**违规行为**：`public/config/weaponConfig.json` 里曾给三把武器各配了一个 `icon` 字段，值是 emoji 字符（`\uD83D\uDDE1` 大刀 / `\uD83D\uDD2B` 机关枪 / `\uD83D\uDCA5` 霰弹枪），`WeaponBar` 直接把该字段当图标文本渲染。

**为什么违规**：emoji 由**操作系统字体**渲染，而字体是外部资源。这等于绕开了「零外部素材」约束，把素材依赖转移给了不可控的第三方。具体风险：

- **Windows 上部分 emoji 会显示成豆腐块（□）或回退成黑白轮廓**，与 macOS / Android 的彩色 emoji 表现不一致；
- 同一份 JSON 在不同平台上渲染出的宽度、基线、视觉重量都不同，而武器栏是**固定 104×56 的格子**，宽度漂移会直接导致错位；
- 配置里混入「展示用字符」违反了 ADR-0003（配置只放数值，不放展示内容）。

**修复方式**（T-010）：

1. 删除 `weaponConfig.json` 中的三个 `icon` 字段；同步删除 `types.ts` 的 `WeaponEntry.icon`、`resolve.ts` 的 `ResolvedWeapon.icon` 及 `resolveWeapons` 的产出、以及 `validator.ts` 里的 `v.string(item, 'icon', ...)` 校验——**四层流水线一起删干净，不留死字段**。
2. `WeaponBar` 改用 `scene.add.image(x, y, \`${WEAPON_TEXTURE_PREFIX}${weapon.id}\`)`（`WeaponBar.ts:74-76`）直接复用 `BootScene` 已生成的 `weapon-blade` / `weapon-smg` / `weapon-scatter` 程序化贴图。
3. 三张贴图长宽比不同（58×22 / 40×24 / 36×21），因此按**等比缩放**塞进 32×32 的外框：`iconBaseScale = min(ICON_BOX / w, ICON_BOX / h)`（`WeaponBar.ts:78-82`，`ICON_BOX = 32` 定义于 `:48`），绝不拉伸变形。实测缩放系数为 0.552 / 0.8 / 0.889，宽度均为 32、高度为 12.1 / 19.2 / 18.7。
4. 切换武器的放大动效改为基于 `iconBaseScale` 做相对缩放（存于 `Slot.iconBaseScale`，`WeaponBar.ts:24`），不再假设所有图标尺寸一致。

**留给后人的判断规则**：**「这不是图片文件，只是一个字符而已」是陷阱。** 只要某个字符的显示效果由系统字体决定（emoji、特殊符号、装饰性 Unicode），它就属于外部素材，就在本 ADR 禁止之列。需要图标时，去 `BootScene` 写一个新的 `makeXxx()`。

---

## Consequences

| 内容 | 文件:行 |
| --- | --- |
| 贴图生成总入口（11 个 `makeXxx()`） | `src/scenes/BootScene.ts:98-111` |
| 各生成方法 | `makePixel :114`、`makeCardFill :123`、`makeCardBorder :134`、`makePlayer :145`、`makeMonster :161`、`makeZoneFill :187`、`makeZoneRing :202`、`makeGlow :213`、`makeFxShard :227`、`makeFxProjectiles :239`、`makeSwingArc :260`、`makeWeapons :295` |
| 通用贴图 key 常量 | `src/scenes/BootScene.ts:20-33` |
| 武器贴图前缀约定 | `src/scenes/BootScene.ts:40`（`WEAPON_TEXTURE_PREFIX = 'weapon-'`） |
| 挥砍弧光基准半径 | `src/scenes/BootScene.ts:43`（`SWING_TEXTURE_RADIUS = 60`） |
| 三把武器贴图的具体画法 | `src/scenes/BootScene.ts:295-323` |
| 无 `preload`：create 只做「生成贴图 + 异步加载配置」 | `src/scenes/BootScene.ts:50-56`（create）、`:59-84`（bootstrap）、`:83`（切场景） |
| 音效参数表（改听感改这里） | `src/systems/SfxController.ts:28-35` |
| 音效播放实现（异常静默 + 懒加载 AudioContext） | `src/systems/SfxController.ts:56-83` / `:86-98` |
| 音效单例 | `src/systems/SfxController.ts:102` |
| 武器栏复用程序化贴图（T-010 修复） | `src/ui/WeaponBar.ts:74-82`（含 `iconBaseScale` 等比缩放） |
| 武器贴图 key 拼接（割草场景中的武器显示） | `src/scenes/GrassCuttingScene.ts:453-456`（`weaponTextureKey`） |

**新增图形的标准动作**：在 `BootScene` 写一个 `makeXxx()` → 在 `generateTextures()` 里调用 → 若需被业务引用则在 `TextureKeys` 里加 key。**不要**往 `public/` 放图片文件，**不要**用 emoji 或装饰性 Unicode 字符当图形。
