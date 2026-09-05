# Nightly-Report（2026-09-01 夜间自动开发）

## 执行时间窗口
2026-09-01 23:00 → 23:20（GMT+8）

## 完成任务列表

### 任务 1：重建零依赖单测体系到 main ✅
- 背景：PR #1（08-31）的测试体系未合并进 main；main 已在 T-015/T-016 中把题库扩至 300 题、关卡扩至 20 关、QuestionEntry 新增 solution 字段
- 产出：`scripts/run-unit-tests.mjs`（esbuild 转译 + node --test）、package.json 新增 `npm test`、tests/math-util（18 用例）/question-bank（13）/quiz-engine（8）
- 修复：QuestionBank.draw() 的 excludeIds 兼容 Set 传法（防御性，避免误传 Set 时 TypeError 崩溃）

### 任务 2：新增三个核心系统单测 ✅
- tests/combo-system.test.ts（9 用例）：连击递增、窗口超时、伤害乘数钳制、reset
- tests/reward-system.test.ts（15 用例）：连对档位、完美/极速/无伤判定、单次+每日双上限钳制、计分、结算文案
- tests/progression-system.test.ts（11 用例）：localStorage stub、升级/连升/满级、解锁只增不减、每日奖励钳制、存档往返、损坏存档回退

### 任务 3：单测接入 GitHub Actions CI ✅
- 新增 `.github/workflows/ci.yml`：npm ci → validate-config → typecheck → test → build，push（main/nightly/**）与 PR 触发

## 校验结果
| 步骤 | 结果 |
|------|------|
| validate-config（8 模块） | ✅ |
| typecheck（tsc --noEmit） | ✅ |
| npm test（6 文件 74 用例） | ✅ 74/74 |
| vite build | ✅ 39 modules |

## 交付 PR
- **PR #2（Draft）**：https://github.com/jasonzhou-cn/knowledge-mow-king/pull/2
- 分支：`nightly/2026-09-01-unit-tests-and-ci`，commit `c1a4d4c`
- 未引入任何新 npm 依赖

## 说明与风险
- `__KB_DEBUG__` 为 DEV 模式调试钩子（scripts/verify-*.mjs 依赖），**保留不清理**（上轮遗留待办撤销）
- 检测到工作区存在用户并行开发的 T-017 新手引导改动（MenuScene.ts / TutorialOverlay.ts / verify-t017-tutorial.mjs），已明确排除在本次提交之外，未误提交
- 网络：git fetch 曾报 Empty reply，已通过 repo-local `http.version=HTTP/1.1` + `http.postBuffer` 解决

## 下一晚建议待办
1. **合并落地测试体系**：PR #1 与 PR #2 内容重叠（测试体系），review 合并后关闭 PR #1
2. resolve.ts 解析器补单测（resolveLevelPackage / computeGrassCuttingBonus / resolveAnswerSpeed 曲线）
3. T-017 新手引导（用户并行开发中）合入后，补 TutorialOverlay 的 isTutorialDone 单测
4. MonsterSpawner 性能回归测试（池化上限、帧率保护断言）
5. CI 验证：确认 GitHub Actions 在 PR 上首次运行需仓库管理员批准（Actions 权限）
