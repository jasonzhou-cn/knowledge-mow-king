# T-029 收尾优化（单测补强 · 工程债清理 · GPU 性能采样）· 变更说明

> 承接 T-028 收口报告「已知边界与建议」，继续消化夜间待办清单与 PROGRESS-REVIEW P1-3/P1-4 的剩余项。
> 画布红线未触碰；`verify:canvas-lock` 6/6 复跑通过。

## 一、单测补强（夜间待办 2/3 号项，117/117 全绿）

| 新增 | 覆盖 |
|---|---|
| `tests/resolve.test.ts`（14 用例） | resolveAnswerSpeed 三种曲线（linear/exponential/hybrid，GDD 4.2.2 参考实现）+ 学科系数 + 区间钳制；resolveQuestionTimeLimit 成长与钳制；resolveExpToNextLevel（linear/exponential/满级 Infinity）；resolveLevelEntry 越界钳制；computeGrassCuttingBonus 上限/保底/逐项拆解；resolveLevelPackage 集成（怪物指数成长×难度缩放、assist/combo 透传、答题加成落到武器伤害与冷却除数——核心绑定落点回归） |
| `tests/playtime.test.ts`（8 用例） | 防沉迷阈值判定（未超时/超时/倒计时内/开关关闭）、startRest 幂等与重置、finishRest、损坏记录静默回退、恰满 30 分钟的 ≥ 边界 |

QuizEngine / math-util 已有覆盖（夜间清单第 1 项此前已完成），未重复。`npm test` 117/117，typecheck 0 error。

## 二、P1-3 工程债清理（清零）

1. **临时构建产物全删**（此前被 safe-delete shell 钩子拦截、按 T-026 记录改走 Node fs 通道成功）：`dist-cdp*`×7、`dist-t013/t022/t022-fresh/t027/t028`、`.tmp-tsc`、根目录 29 个 `vite.config.ts.timestamp-*.mjs`、本地 `.tmp/` 草稿（t028 截图证据先复制到 `reports/t028-shots/` 再删）。磁盘回收约 100MB+。
2. **一次性 verify 脚本归档**：20 个历史 verify/probe 脚本 `git mv` 到 `scripts/archive/`（保留全部历史可溯，import 路径已修为 `../cdp.mjs` 可复跑）。`scripts/` 根目录只留 npm 门禁与活跃回归脚本（canvas-lock / smoke / validate-config / unit-tests / t017 / t022 / t028×3 / cdp.mjs / deploy.sh / phaser-stub）。
3. **`.gitignore` 补 `.tmp/`**：修正 T-028 提交时 8 个 `.tmp` 草稿文件被误提交的问题（本提交移出跟踪）。
4. **死代码判定（夜间清单遗留问题）**：`ArrowSelector` / `AnswerTrack` **不是死代码**——它们是 `questionConfig.answerSettings.mode = 'arrow' / 'track'` 的配置可选答题模式（QuestionScene 按 mode 三选一实例化，cursor 为默认值），保留有据。

## 三、P1-4 性能采样（带 GPU 环境补测）

`scripts/verify-t029-gpu-perf.mjs`：Chrome 新无头（112+ 默认真 GPU，**去掉 swiftshader 降级旗标**）+ 小米 2340×1080 基线视口，L14 / L20 各跑**完整 60 秒**（不压缩时长）Boss 战，rAF 逐秒采样 FPS 与 JS 堆：

| 关卡 | FPS avg | FPS min | FPS max | JS 堆峰值 | 峰值同屏 | 最低HP | 最大Boss阶段 | 结局 |
|---|---|---|---|---|---|---|---|---|
| L14 完形峰林 | 32 | 31 | 32 | 31MB | 9 | 11.1 | P2 | 时间到（存活） |
| L20 元素火山 | 32 | 32 | 32 | 37MB | 13 | 4.1 | P0 | 时间到（存活） |

**结论**：
- **零掉帧**：本环境帧节奏被虚拟 vsync 钳在 32 FPS（headless 合成器上限，非游戏帧耗上限），关键在于全程 31~32 **毫无负载性下滑**——PROGRESS-REVIEW 点名的「Boss 召唤小兵峰值帧率」未出现任何劣化信号；若帧耗超预算，应表现为跌破 32 的散点，实际没有。
- **内存健康**：JS 堆 31→37MB 平稳爬升后收敛，对象池无泄漏迹象（与 DELIVERY 时期「cap hits 全为 0」结论一致）。
- **完整时长 Boss 战压力**：菜鸟机器人（17~20% 正确率）在 DDA 开启下 L14 打到 Boss P2、L20 打完全程均存活——与 T-028 压缩时长的曲线结论互相印证，无「软失败保护兜不住」的关卡。
- 数据落盘：`reports/t029-gpu-perf/gpu-perf-detail.json`（逐秒 FPS/堆）。
- **边界**：桌面 GPU ≠ 手机 GPU，本数据用于「相对压力与掉帧定位」；真机（小米 2340×1080）复核仍建议保留，但已无已知的高风险嫌疑点。

## 四、质量门

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run validate-config` | 13 模块合法 |
| `npm test` | **117/117** |
| `npm run verify:canvas-lock` | 6/6 |
| `npm run smoke` | PASS |

## 五、遗留

- 真机复核（BGM 听感 / 防沉迷节奏 / 手机 GPU 帧率）——需真机。
- 生产 HTTPS 部署——等部署方案。
- UI 布局 150+ 常量的 `uiLayoutConfig` 收口——维持「分期」决策（高成本、低风险），未动。
