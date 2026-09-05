# T-028 红线收口与合规/体验补齐 · 变更说明

> 任务：一次性完成 PROGRESS-REVIEW 全部未完成项（用户授权 push + 全量修复）
> 画布红线：**未触碰** CanvasMode / main.ts 画布逻辑 / index.html / 方案 C 锁定（`verify:canvas-lock` 6/6 全程绿）
> 数据红线：全部新数值进配置 JSON + validator（新增 3 个配置模块），未新增 npm 依赖

## 一、GDD 三条硬红线：违规清零

### 红线 2-A｜斩断「击杀连击 → 伤害」旁路（P0-0A）

- `grassCuttingConfig.comboSettings`：`comboDamageGrowth 0.1 → 0`、`comboMaxDamageMultiplier 3 → 1`（`comboSkillDurationGrowth` 同步归零，本身即无消费点）。
- 连击保留得分加成与全部视觉反馈（连击飘字 / 里程碑 / zoom pulse），**不再参与伤害结算**。
- 回归钉死：`tests/redline-regression.test.ts`（连击 50 也必须 1.0×；growth>0 的开关行为另行对照）。
- 审计公式复核：伤害倍率 = 答题三项乘数 × 连击(=1)，全错+满连击(1.8×) > 全对一半(1.0×) 的倒挂已消除。

### 红线 3｜动态难度下调（P0-0B，堵死亡螺旋）

- 新增 `src/systems/DifficultyAssist.ts`（纯函数、可单测）：
  - `computeAssistTarget`：assist = 0.4×正确率 + 0.35×HP占比 + 0.25×(1−掉血速率归一化)，权重来自配置；
  - `applyAssistToProgress`：effectiveT = t × (pullMin + (1−pullMin)×assist)，**只降不升**（单测覆盖全象限）；
  - `smoothAssist`：指数平滑（1.5s 时间常数），难度无跳变。
- 配置段 `grassCuttingConfig.assistSettings`（enabled / 三权重 / lossRefHpPerSec=4 / lossWindowSec=5 / **pullMin=0.55** / smoothingSec=1.5），validator 全字段 + 权重和>0 交叉断言。
- GrassCuttingScene 每帧计算 assist → 传入 `spawner.setProgress(effectiveT)`；`__KB_DEBUG__` 暴露 `assistFactor` / `effectiveProgress` / `hpRatio` 供走查。
- **实测证据**（`scripts/verify-t028-dda.mjs`，L9 菜鸟机器人，正确率 10%）：
  - DDA ON：assist 0.89 → 0.32 平滑下降，有效难度进度峰值 0.65（对照组 0.92，回拉 30%），**活过全关**（剩余 HP 63.7）；
  - DDA OFF：assist 恒 1（零回归），进度 0.92；
  - 双局 0 JS 异常。

### 红线 2-B｜摘除「击杀经验 → 等级 → 伤害」旁路（P0-0C）

- `rewardConfig.scoreSettings` 删除 `expPerKill`（types/validator/JSON 同步），`ResultScene.calculateExp` 只由答对数 + 通关奖励驱动。等级成长回归「答题表现」唯一来源。

### 红线 2 间接违规｜穿透弹跨子步重复命中（P0-0D，功能 bug）

- `Monster` 新增 `uid`（本局自增，三处生成点发放）；`ProjectileSystem` 槽位新增 `hitUids: Set<number>`，命中前查重、命中后登记，fire/release 时清空（复用槽位不污染）。
- **实机微测**（真实 ProjectileSystem + 受控怪，`scripts/verify-t028-features.mjs`）：单怪挡道一枚弹丸只结算 1 次（修复前 3~7 次）；pierce=1 贯穿两只怪各结算 1 次 → 机关枪穿透恢复真实语义，武器伤害平衡与 `pierce` 配置重新生效。
- 注：PROGRESS-REVIEW 曾建议删除的 `update()` 末尾 `if (!proj.active) continue;` 实为**必要守卫**（防止 while 内 release 后重复扣 activeCount），已保留。

## 二、功能补齐

### P1-1 答题速度权重强化（ROADMAP 2.3 另一半）

- `speedFactorWeight 0.5 → 0.8`：快答（≤20% 限时）吃到 1.5× 上限，慢答（吃满限时）回落 1.0×，快慢差 50%（单测钉死）；难度影响已由 DDA 与曲线实测兜住。

### P1-2 防沉迷（GDD 2.6，纯前端）

- `src/systems/PlaytimeSystem.ts`：localStorage 独立键记录连续游玩起点与休息截止——**刷新页面不可绕过**；`gameSettings.playtimeSettings`（默认连玩 30 分钟 → 强制休息 10 分钟），validator 交叉断言 rest < session。
- `src/ui/RestOverlay.ts`：全屏休息遮罩（倒计时 + 输入阻断），MenuScene 展示；Question/Grass 场景 create 守卫送回主菜单。
- 实测：预置 31 分钟记录 → 遮罩弹出、入口全阻断 → finishRest 后恢复。

### P2-1 BGM（零素材）

- `src/systems/BgmController.ts`：WebAudio 步进音序器（200ms 定时器 + 0.4s lookahead 精确调度，双轨低音+主旋律），`bgmConfig.json` 四轨道（menu/question/grass/boss）全参数配置；自动播放策略经一次性手势解锁；全异常静默（与 SfxController 同规）。
- 实测：menu → question → grass 轨道随场景切换，context running。

### 成就 / 图鉴 / 本地排行榜

- `achievementConfig.json` 14 条沙雕成就（11 种条件类型，validator 白名单）；`AchievementSystem` 统计 + 判定（高频击杀只动内存、结算统一落盘）。
- `ProgressionSystem` 存档 v1 → **v2**：`meta`（achievements / bossesDefeated / bestScores / totals），**v1 存档自动迁移**（老进度全保留，单测覆盖迁移与脏数据归一化）。
- MenuScene「成就 · 图鉴」面板：成就清单 + **Boss 图鉴**（击败点亮名字与主题色）+ 关卡记录（本地排行榜：累计统计 + 单关最佳 Top5）。
- 结算 toast 展示本次新解锁（实测：「🏆 成就解锁：初出茅庐」）。

## 三、红线 1 硬编码收口（低成本项全清）

| 项 | 落点 |
|---|---|
| SfxController 节流表 + 音色表（含自认违规 TODO T-013-B） | 新模块 `sfxConfig.json` + `sfx.bind()` |
| 震屏时长 130/80/160/140/160ms | `polishSettings.shake`（meleeHit/fire/kill/hurt/bossDeathMs） |
| 草丛 90 株 / 高 8~22 / alpha 0.22 / 装饰 6 个 / Boss 压暗 0.45 | `polishSettings.themeDeco` 扩展 5 字段 |
| 玩家精灵系数 2.6 / 倒计时告警 10s / 飘字字号 20·27·34 | `polishSettings.playerSpriteScale / timeWarningThresholdSec / floatingText` |
| Boss 前置存活比 `maxAlive*0.25` | `bossRoster.common.preBossAliveRatio` |
| 加成面板自动推进 2600ms | `questionConfig.answerSettings.bonusPanelAutoAdvanceMs` |
| resolve.ts 除零 epsilon | 常量化 `MIN_DURATION_DIVISOR`（判定为数值卫生，非手感参数） |

UI 布局 150+ 处常量按评审建议维持「分期收口」（高成本项，未动）。

## 四、20 关难度曲线批量实测（P0-3，`scripts/verify-t028-curve.mjs`）

统一机器人（走位+攻击+乱答题，15s 压缩时长，DDA 开启）跑 L1/L5/L10/L14/L17/L20：

| 关卡 | 名称 | Boss | 峰值同屏 | 击杀 | 最低HP | 结局 |
|---|---|---|---|---|---|---|
| L1 | 初入草原 | 否 | 27 | 32 | 97.9 | 时间到 |
| L5 | 几何峡谷 | 是 | 13 | 15 | 46 | 时间到 |
| L10 | 短语林地 | 是 | 7 | 17 | 87 | 时间到 |
| L14 | 完形峰林 | 是 | 13 | 24 | 73 | 时间到 |
| L17 | 清泉营地 | 是 | 13 | 25 | 100（喘息关生效） | 时间到 |
| L20 | 元素火山 | 是 | 16 | 13 | 4.1（最难，符合 scale 3.15） | 时间到 |

结论：① 压力梯度成立（L1≈无压力 → L20 极限残血）；② L17 喘息关确实起到节奏缓冲；③ DDA 开启下最难的 L20 也没有死局；④ 全部 0 JS 异常。局限：压缩时长限制了 Boss 战完整 DPS 验证，正确率随机波动（17%~45%）会改变加成，建议真机再跑一轮完整时长校准。

## 五、质量门（全部亲自复跑）

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run validate-config` | 13 个模块全部合法（新增 sfx/bgm/achievement 3 模块） |
| `npm test` | **95/95**（74 原有 + 21 新增：DifficultyAssist / 红线回归 / 存档 v2 迁移） |
| `npm run verify:canvas-lock` | 6/6（画布方案 C 完好，未触碰） |
| `npm run smoke` | PASS（顿帧/粒子池/高频击杀压力） |
| `npx vite build` | 成功（49 modules，1,690 kB / gzip 400 kB） |
| CDP 实测 3 部 | DDA 存活对比 ✓ / 20 关曲线 ✓ / 新功能走查 **22/22** ✓ |
| 发布 | dist-c 重建 `index-k29qGraT.js`，5173/5180 同步 ✓ |

## 六、已知边界与建议

1. **真机验证仍欠**：BGM 听感、防沉迷提示节奏、Boss 关帧率需真机确认（无头 swiftshader 数据不能作为性能结论）。
2. Boss 战 DPS 完整时长验证受无头渲染速度限制，建议真机或带 GPU 环境补测。
3. L10 机器人拿到 45% 正确率（×3 加成）使该关实测压力偏轻，属采样波动，非曲线问题。
4. 防沉迷数值（30/10 分钟）是 GDD 合规下限的保守取值，可按家长需求在 `gameSettings.playtimeSettings` 调整或关闭。
5. CI（GitHub Actions）首跑需在仓库 Actions 页确认权限；`npm test` / `validate-config` / `typecheck` / `build` 已接入 push 触发。
