# T-025 美术表现与趣味性打磨 · 变更说明

> 任务书：P1 打磨期 · 美术表现与趣味性
> 路线红线：全程保持「纯程序化 Graphics 绘制，零外部素材」，所有新数值进配置 JSON + validator，未触碰 CanvasMode / main.ts 画布逻辑 / index.html 画布样式 / GDD.md，未新增任何 npm 依赖，未回退 T-020/T-024 的布局遮挡修复。

## 改进点清单（改进点 → 主要文件 → 玩家视角的提升）

### A. 美术表现

1. **5 Boss 专属外观（形状 + 表情 + 配件）** → `src/systems/BossVisual.ts`（新增）、`src/scenes/BootScene.ts` → 五个 Boss 再也不是「大一号的圆怪」：内卷怪是挂 KPI 工牌的方脸、躺平怪头顶飘 Z 字、语法之王戴博士帽和眼镜、化合狂魔戴护目镜拎试管、考神头上有旋转光环，一眼就能认出对手是谁。
2. **Boss 阶段切换可感知** → `src/systems/BossVisual.ts`、`src/scenes/GrassCuttingScene.ts` → Boss 血量过半会切「凶光眼 + 露牙吼」表情并脉冲变身，血量再降还会亮出阶段专属配件（加班火焰 / 枕头 / A+ 牌 / 冒泡试管 / 双考卷），Boss 战有明显的「它急了」节奏感。
3. **场景学科主题化** → `src/systems/SceneTheme.ts`（新增）、`src/scenes/GrassCuttingScene.ts` → 数学关是冷蓝草原配 π/∑ 漂浮符号，英语关偏紫配字母与树叶，科学关偏绿配元素式子和锥形瓶，Boss 关整体压暗——每章有自己的氛围，而不是 20 关一张脸。
4. **Boss 阶段切换全屏轻微闪光** → `src/scenes/GrassCuttingScene.ts`（playPhaseFlash，金色全屏淡出）→ 阶段切换瞬间有「重音」反馈，玩家立刻意识到 Boss 变强了。
5. **玩家呼吸感 / 移动 bob** → `src/scenes/GrassCuttingScene.ts`（updateWeaponVisual 缩放波形）→ 角色待机时轻轻呼吸、跑动时微微起伏，画面不再是「一张贴图在滑行」。
6. **击杀粒子增强** → `src/systems/KillFxSystem.ts`（burst 支持碎片加量）、`src/scenes/GrassCuttingScene.ts` → 碎片按本关学科主题色飞散，连击越高碎片越多，超大连击还会追加一道垂直副爆，「割草」更炸裂。
7. **场景切换 fade 过渡** → `src/scenes/MenuScene.ts` / `QuestionScene.ts` / `GrassCuttingScene.ts` / `ResultScene.ts` → 菜单→答题→割草→结算全程淡入衔接，告别生硬的闪切。
8. **结算界面依次弹入** → `src/scenes/ResultScene.ts`（stagger 弹入，单元素 ≤400ms）→ 标题、三栏、奖励面板、按钮依次登场，结算更有仪式感且不拖节奏。
9. **按钮按压反馈** → 沿用既有 popScale + ripple 统一风格，未做大改（按任务书「不大改」执行）。

### B. 趣味性

10. **Boss 台词系统接入** → `public/config/bossDialogue.json`（rekey 到 bossRoster id 白名单）、`src/config/*`、`src/scenes/GrassCuttingScene.ts` → T-024 写好的台词终于上线：Boss 出场、变阶段、被打死都会弹出金色台词横幅（「欢迎来到 996 福报现场！」「我要写周报了！」），Boss 有了人设和喜剧感。
11. **结算趣味文案** → `public/config/resultFlavor.json`（新增 tierRules 档位阈值）、`src/scenes/ResultScene.ts` → 结算时按表现抽一句沙雕文案（「满分！你的卷子就是参考答案！」），考砸了也有温柔吐槽。
12. **连击里程碑 + 相机 zoom pulse** → `src/scenes/GrassCuttingScene.ts`（playComboMilestone）→ 5/10/20/35 连击时屏幕中央弹「N 连击！」并轻微推镜，连击有了明确的高光时刻。
13. **学霸 BUFF（随机趣味事件）** → `src/systems/ScholarBuffSystem.ts`（新增）、`src/scenes/BootScene.ts`（书本贴图）→ 击杀小怪概率掉落金色书本，捡到后 5 秒攻速/移速小幅提升并伴随金圈 + ✦ 标记，割草途中多了「捡到宝」的小惊喜。

## 配置与校验（数据解耦红线）

- 新增配置模块：`bossDialogue.json`、`resultFlavor.json` 正式进入三层管线（types → validator → ConfigLoader）。
- `grassCuttingConfig.json` 新增 `polishSettings`：fadeIn 时长 / stagger 节奏 / 呼吸幅度与周期 / 连击里程碑与 zoom pulse / Boss 台词时长字号 / 阶段闪光 / 主题装饰数量 / 学霸 BUFF 全部数值。
- `scripts/validate-config.mjs` 与 `src/config/validator.ts` 同步补齐：新模块校验 + `bossDialogue` key 对 `bossRoster.roster` 的白名单关联校验 + polishSettings 区间校验。

## 质量门结果

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run validate-config` | 通过（10 个模块全部合法） |
| `npm run build` | 成功（tsc + vite build） |
| `npm run verify:canvas-lock` | 6/6 通过 |
| `npm test` | 无 test 脚本（package.json 无该入口），以 smoke/verify 门替代 |
| CDP 走查（2340×1080 小米视口，dev 5174） | 7/7 通过、0 JS 异常 |

走查截图：`.tmp/t025-shots/`（menu / question / grass-theme / boss-intro / boss-phase2 / scholar-buff / result）；走查脚本 `.tmp/t025-walkthrough.mjs`（临时，不进仓库）。

## 技术债与边界（未做项）

- 按任务书未触碰：击杀连击伤害旁路、穿透弹跨子步重复命中、击杀经验→等级→伤害旁路等已知技术债；RewardSystem / ComboSystem 数值语义未动。
- hitstop 打击感微调：现有 hitstop 参数已在配置（weaponConfig.killFx），本任务未再改动数值，只新增了连击里程碑的 zoom pulse。
- Boss 死亡收场（翻白眼 + 缩放消失）未实现：Boss 死亡即通关切结算，收场表情实际不可见，改为死亡台词横幅（已实现）。
- fun-event-visual.md 其余事件（躺平 BUFF / 错题弹幕 / 考神召唤）按任务书「挑 1 个最低成本」未实现。
- 已知限制：无头 swiftshader 下 2340×1080 渲染极慢（约 0.1× 游戏内时间），走查脚本已用轮询适配；真机不受影响。
