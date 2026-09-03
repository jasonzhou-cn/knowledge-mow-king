# T-027 打磨边界收口 · 变更说明

> 任务书：P2 · 打磨期最后一批收口（3 个已知小边界 + 1 个规格尾部项）
> 路线红线：全程保持「纯程序化 Graphics 绘制，零外部素材」（迷你 Boss 底型 / 表情 / Zzz 字母均由 Graphics→generateTexture 或 Text 系统字体实现，无 emoji），所有新数值进配置 JSON + validator，未触碰 CanvasMode / main.ts 画布逻辑 / index.html / GDD.md，未新增任何 npm 依赖，未动 RewardSystem / ComboSystem 数值语义。

## 改进点清单（改进点 → 主要文件 → 玩家视角的提升）

### 1. BUFF 并存优先级（T-026 遗留 #1）

- **学霸 BUFF 完全覆盖躺平 BUFF** → `src/systems/LazyBuffSystem.ts`（新增 `setSuppressed` 压制语义）、`src/scenes/GrassCuttingScene.ts`（每帧 `lazy.setSuppressed(scholar.active)`）→ 学霸激活期间：蓝环与头顶标识隐藏、躺平的无敌/移速效果暂停、**剩余时间冻结保留**；学霸到期后蓝环自动回归、倒计时继续（实测冻结 5.87s → 恢复 5.85s）。任意时刻玩家身上最多显示一个 BUFF 环。
- **压制期间拾取躺平胶囊不再误导** → 拾取飘字改为「躺平已冻结（学霸生效中）」，胶囊照常消耗但时间冻结，避免「金环蓝环叠显 + 文案打架」。
- 语义依据：fun-event-visual.md §8 明确定义「学霸 BUFF（优先级 1）完全覆盖躺平 BUFF（优先级 2）」，因此采用文档的学霸优先语义而非任务书兜底的「后拾取覆盖先拾取」。

### 2. 死亡序列期间 Boss 血条淡出（T-026 遗留 #2）

- **血条不再悬在屏顶** → `src/scenes/GrassCuttingScene.ts`（startBossDeathSequence / updateBossBar）→ 死亡序列开始的瞬间，Boss 血条（底框 + 填充 + 标签）200ms alpha→0 淡出，玩家视线聚焦死亡演出；`bossBarFading` 标记阻断序列期间的重绘，序列结束直接切结算无需恢复。走查确认淡出后屏顶只剩倒计时。

### 3. 💤 emoji 替换为程序化 Z z z（T-026 遗留 #3）

- **跨平台零方块** → `src/systems/LazyBuffSystem.ts` → 头顶标识由单个「💤」emoji 改为 Container 内 3 个 Text 字母「Z / z / z」渐次缩小（20/15/11px），各自带**缓慢上浮 + 淡出的无限循环 tween**（1300/1500/1700ms，错峰 350ms），模拟打瞌睡的呼吸感；随玩家移动整体跟随。老旧 Android 不再依赖 emoji 字形。

### 4. 考神召唤（fun-event-visual.md 清单最后一项）

- **规格落地说明**：任务书给了一个「L20 第 4 阶段召唤战斗分身」的低成本兜底描述，但与文档 §4 的定义冲突（文档：Boss 生成时同时召唤 4 个迷你 Boss 环绕、纯氛围、可击杀、不攻击、持续到 Boss 死亡）。按任务书「以文档为准」的裁决规则，**实现的是文档 §4 版本**，所有 Boss 关（L5/10/14/17/20）通用。
- **迷你 Boss 环绕** → `src/systems/ExamSummonSystem.ts`（新增）、`src/systems/MonsterSpawner.ts`（`spawnMiniboss` + `isMiniboss`/`baseTint` 槽位标记，不占同屏名额 cap）、`src/scenes/BootScene.ts`（tex-buff-miniboss 白色灰度圆底，运行期 tint）→ Boss 入场时 4 只迷你 Boss（沿用 L5 金 / L10 蓝绿 / L14 绿 / L17 蓝绿四色，零新色值）在环绕点位上**错峰 150ms 弹入**（Back.easeOut），绕 Boss 匀速旋转（默认 8s/圈），表情按 BossVisual 同款比例 1/2 绘制（Graphics 运行期画，非贴图）。
- **可击杀但有分寸（§4.4）**：迷你 Boss 进入常规战斗管线（自动瞄准 / 近战扇形 / 弹丸都能命中），但 **damage=0 不攻击玩家**（零伤害接触不触发受伤表现、不消耗无敌帧、不破坏 noDamage 口径）、**score=0 击杀不计分/不进连击/不掉落**；击杀反馈 = kill 音效 + 主题色小爆散 + 表情淡出，尸体沿击退方向飞散。
- **沙雕台词（§4.5）**：首杀弹「学神：这道题...我也错了」，全灭弹「学神全灭！专心打 Boss」（复用 T-025 台词横幅）。
- **Boss 死亡收场联动（§4.2）**：全部存活迷你 Boss 切「哀悼」表情（小星眼 + 歪斜嘴）并同步缩放淡出消散。
- 与 T-022 的边界：未改动 BossSkillController 既有技能逻辑；L20 phase 1 的 `past_boss_summon`（战斗召唤技能）与本法互不干扰。

## 配置与校验（数据解耦红线）

- `grassCuttingConfig.polishSettings` 新增一段：`examSummon`：miniCount=4 / radius=14 / orbitRadius=60 / orbitPeriodMs=8000 / hpFactor=1.2（迷你 Boss hp = 普通小怪 hp × 系数，校验上限 1.5）/ popStaggerMs=150 / popInMs=300 / fadeOutMs=300；miniCount=0 可整体关闭该事件。
- `src/config/types.ts` 新增 `ExamSummonSettings` 并挂入 `PolishSettings`。
- `src/config/validator.ts` 补齐 8 项区间校验；`scripts/validate-config.mjs` 复用 validator 无需改动。

## 质量门结果

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run validate-config` | 通过（10 个模块全部合法） |
| `npm run build` | tsc 0 error + vite build 成功（49 modules）；注：`npm run build` 的 vite emptyOutDir(dist) 会被本机 safe-delete 钩子拦截（与 deploy.sh base 同源的环境故障），本次用 `npx vite build --outDir dist-t027` 完成等价构建 |
| `npm run verify:canvas-lock` | 6/6 通过（画布锁定完好） |

## CDP 走查证据（.tmp/t027-walkthrough.mjs，小米 2340×1080，dev HMR 5174，L20 考神关）

| 走查项 | 结果 | 截图（.tmp/t027-shots/） |
|---|---|---|
| 学霸覆盖躺平（双拾取后 scholar=true / suppressed=true / 蓝环隐藏） | ✅ lazyRemain 冻结 5.87s | buff-priority.png |
| 学霸到期 → 躺平恢复（蓝环 + Zzz 回归继续倒数） | ✅ lazyActive=true / suppressed=false | lazy-restored.png |
| Zzz 程序化字母渲染（Z/z/z 渐次漂浮） | ✅ | lazy-zzz.png |
| Boss 入场同时召唤 4 迷你 Boss | ✅ total=4 / alive=4 | exam-summon.png |
| 迷你 Boss 可击杀但不计分/不进连击 | ✅ kills=0 / score=0 / combo=0，alive 4→3 | exam-summon-kill.png |
| 死亡序列 Boss 血条淡出 | ✅ bossBarFading=true，截图顶部血条已消失 | boss-death-barfade.png |
| Boss 死亡 → 迷你 Boss 全体哀悼消散 | ✅ alive=0 | boss-death-barfade.png |
| 死亡序列结束 → ResultScene 移交 | ✅ scene=ResultScene | result.png |
| JS 异常 | 0 | — |

## 遗留风险

1. **迷你 Boss hp 相对同关小怪**（hpFactor=1.2 × 普通小怪 hp）：L20 满难度期小怪 hp 高，迷你 Boss 也随之变厚——氛围单位打起来偏肉；如需「两三刀一个」的爽感，把 polishSettings.examSummon.hpFactor 调低即可（校验区间 0.1~1.5）。
2. **迷你 Boss 不占同屏名额但占对象池槽位**：极端情况下（池满）召唤会少生成几只（spawnOnBoss 有兜底 break），不影响战斗正确性。
3. **环绕迷你 Boss 可能先于 Boss 挡在玩家与 Boss 之间**：接触判定每帧 break 在首个接触怪上，迷你 Boss 贴脸时会短暂「挡刀」（不造成伤害，仅推迟 Boss 本体的接触结算一帧）；实机走查未见异常。
4. **`npm run build` 的环境故障**与本任务代码无关（dist 目录清空被 safe-delete 钩子拦截），发布时请按任务书用 `VITE_CANVAS_MODE=c npx vite build --outDir dist-c`。
