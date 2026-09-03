# T-026 打磨期遗留项收尾 · 变更说明

> 任务书：P2 · T-025 遗留收尾（Boss 死亡收场 + 错题弹幕 + 躺平 BUFF）
> 路线红线：全程保持「纯程序化 Graphics 绘制，零外部素材」（胶囊贴图 / 死亡表情 / 圆环均由 Graphics→generateTexture 或 Text 系统字体实现），所有新数值进配置 JSON + validator，未触碰 CanvasMode / main.ts 画布逻辑 / index.html / GDD.md，未新增任何 npm 依赖，未回退 3107445 布局修复，未动 RewardSystem / ComboSystem 数值语义。

## 改进点清单（改进点 → 主要文件 → 玩家视角的提升）

### 1. Boss 死亡收场演出（T-025 遗留 #1）

- **Boss 死亡不再「秒切结算」** → `src/scenes/GrassCuttingScene.ts`（startBossDeathSequence / playBossVanish / update 序列分支）、`src/systems/BossVisual.ts`（playDeath / playVanish / death 表情）→ Boss HP 归零后先播放 1.5s 收场序列再进结算：
  - 死亡瞬间 **120ms 全屏 hitstop**（卡肉重音）；
  - Boss 切 **「翻白眼 + 张嘴流口水」死亡表情**定格在死亡点（boss-visual-spec §0.3 death）；
  - 金色双层爆散 + 相机震动 + 「BOSS 击破」飘字 + **死亡台词横幅**（「我...周报还没写...先下了...」）全程可见；
  - 末段 750ms **缩放 + 720° 旋转 + 淡出消失动画**（Back.easeIn），并补一发金色副爆。
- **序列期间时间冻结** → `GrassCuttingScene.update()` 序列分支提前返回 → 小怪停止刷新与移动、玩家不可再受伤、倒计时停住；击杀爆散照常飞散（顿帧那一下仍冻住保持卡肉感）。序列结束才 `scene.start('ResultScene')`。
- 死亡台词横幅复用 T-025 的 `showBossLine` 与 `spawner.onBossDeath` 监听，确认在序列中正常展示（走查截图 boss-death-face.png）。

### 2. 错题弹幕

- **本轮答错的题目以弹幕形式飘过屏幕底部** → `src/systems/WrongDanmakuSystem.ts`（新增）、`src/scenes/QuestionScene.ts`（GrassCuttingData 新增 `wrongAnswers`，答错/超时各记一条「题干 → 正确答案」快照）、`src/scenes/GrassCuttingScene.ts` → 例如「错词卡：abandon → 放弃」「3 + 5 × 2 = ? → 13」以半透明主题色小字从屏幕右侧向左飘过，只出现在屏幕底部活动带（66%~86% 屏高），不遮挡玩法中心区，depth 115 低于玩家与 HUD。
- **数据零传递成本**：QuestionScene 在答错/超时瞬间用题目快照记录（避免 record→题库反查），经 GrassCuttingData 传入割草场景；**无错题时零弹幕**，完全不打扰。
- 弹幕循环轮转错题列表，同屏受 maxOnScreen 硬上限，飘出左边界即销毁。

### 3. 躺平 BUFF（趣味事件 #2，拾取物版）

- **随机掉落「躺平胶囊」** → `src/systems/LazyBuffSystem.ts`（新增，结构与 ScholarBuffSystem 同型）、`src/scenes/BootScene.ts`（makeLazyCapsule：白色灰度胶囊贴图，运行期 tint 躺平蓝）、`src/scenes/GrassCuttingScene.ts` → 击杀小怪概率掉落胶囊（默认 3.5%，单关上限 2 颗），拾取后 **6s 无敌**（接触伤害与 DoomZone 全免疫，走 applyDamageToPlayer 单点拦截）但 **移速 ×0.85**（躺平的代价感，取文档「手残党安慰奖」立意的低成本核心）。
- **清晰视觉标识**：拾取瞬间飘字「躺平 BUFF！短暂无敌」+ 激活期间玩家身上蓝色呼吸圆环 + 头顶 💤（Text 系统字体，零素材），跟随玩家移动。
- 与学霸 BUFF 相互独立、可并存（学霸提升攻速移速、躺平保命降速，连乘不冲突）。

## 配置与校验（数据解耦红线）

- `grassCuttingConfig.polishSettings` 新增三段（全部数值外置，代码零硬编码）：
  - `bossDeath`：hitstopMs=120 / vanishMs=750 / sequenceTotalMs=1500（校验器约束 total ≥ hitstop+vanish）；
  - `wrongDanmaku`：speed=90 / fontSize=16 / alpha=0.6 / maxOnScreen=4 / spawnIntervalSec=1.6 / bandTopRatio=0.66 / bandBottomRatio=0.86（校验下沿 > 上沿）；
  - `lazyBuff`：dropChance=0.035 / maxDropsPerLevel=2 / duration=6 / moveSpeedMultiplier=0.85。
- `src/config/types.ts` 新增 `BossDeathSettings` / `WrongDanmakuSettings` / `LazyBuffSettings` 并挂入 `PolishSettings`。
- `src/config/validator.ts` 同步补齐三段区间校验（含两条交叉断言），`scripts/validate-config.mjs` 直接复用 validator 无需改动。

## 质量门结果

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run validate-config` | 通过（10 个模块全部合法） |
| `npm run build` | 成功（tsc + vite build，48 modules） |
| `npm run verify:canvas-lock` | 6/6 通过（画布锁定完好） |

## CDP 走查证据（.tmp/t026-walkthrough.mjs，小米 2340×1080，dev HMR 5174）

| 走查项 | 结果 | 截图（.tmp/t026-shots/） |
|---|---|---|
| 错题弹幕渲染（3 条错题 → 底部活动带右→左） | ✅ activeCount 0→2→3 轮转 | danmaku-1.png / danmaku-2.png |
| 躺平 BUFF（胶囊掉落 → 拾取 → 蓝环 + 💤 + 无敌 + 移速 ×0.85） | ✅ active=true | lazy-buff.png |
| Boss 死亡序列启动（hitstop + 翻白眼 + 死亡台词横幅） | ✅ remain=7.9（走查时临时拉长） | boss-death-face.png |
| 序列期间世界冻结（timeLeft/aliveMonsters 双采样一致） | ✅ 53.30s / 11 只不变 | boss-death-face.png |
| 缩放旋转消失中间帧 | ✅ Boss 旋转缩小可见 | boss-death-vanish.png |
| 序列结束 → ResultScene 移交 | ✅ scene=ResultScene | result.png |
| JS 异常 | 0 | — |

> 走查技巧：无头 swiftshader 下 1.5s 序列的消失中间帧抓不到，脚本在击杀前运行时覆盖 `packed.polish.bossDeath` 为 8s/6s 再走真实击杀路径（CombatSystem.applyHit → kill → onKill），配置 JSON 未动。

## 遗留风险

1. **学霸 / 躺平视觉并存**：fun-event-visual.md §8 的「学霸完全覆盖躺平」优先级规则未实现（拾取物版两者可同时激活，圆环叠显）；影响仅视觉，数值互不干扰。
2. **死亡序列期间的 Boss 血条**：冻结窗口内 updateHud 暂停，血条停留在最后绘制比例（不为 0），1.5s 后随场景切换消失；如需归零可在 startBossDeathSequence 里补一次 updateBossBar。
3. **Boss 本体槽位复用假设**：死亡演出重新点亮了已被对象池回收的 Boss 精灵，依赖「序列期间刷怪冻结 + 结束即切场景」这一前提（当前实现成立）；若未来做「死亡后再来一波小怪」类玩法需重新审视。
4. **💤 字符跨平台**：躺平 BUFF 头顶符号依赖系统 emoji 渲染（规格文档明确允许的氛围元素），个别老旧 Android 可能显示为方块，不影响功能。
