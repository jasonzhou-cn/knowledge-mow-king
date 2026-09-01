# Canvas 适配方案管理（方案 A / C / D）

## 三个方案对比

| 方案 | 视觉特征 | 黑边 | 变形 | 配置 |
|------|---------|------|------|------|
| **A（双 canvas）** | 背景 canvas 铺满 viewport + Phaser canvas FIT 居中 | 0% | 无 | `CANVAS_MODE = 'a'` |
| **C（Phaser RESIZE）** | Phaser canvas 物理 = viewport，填满整个屏幕 | 0% | **会变形** | `CANVAS_MODE = 'c'` |
| **D（A + SafeArea）** | 同 A，但 Phaser 内部 UI 算安全区 | 0% | 无 | `CANVAS_MODE = 'd'`（默认） |

## 回滚机制（按速度递增）

### L1：构建期回滚（30 秒，零 Git 风险）

**改文件回滚**：
```bash
# 切到方案 A
# 编辑 src/config/CanvasMode.ts
export const CANVAS_MODE = 'd';  // 改 'c' → 'd'
npm run build && 部署
```

**环境变量回滚**（推荐，CI/部署脚本可控）：
```bash
# 部署前用环境变量
VITE_CANVAS_MODE=a npm run build   # 强制方案 A
VITE_CANVAS_MODE=d npm run build   # 强制方案 D（默认）
VITE_CANVAS_MODE=c npm run build   # 强制方案 C（最新）
```

### L2：部署期回滚

如果用 CI 部署，**回滚上一个发布版本即可**——不用回退代码。
```bash
# 例如之前发版用了 c
VITE_CANVAS_MODE=d npm run build && deploy
# 出问题：直接重新发布上次的 dist 产物
```

### L3：Git 回滚（彻底，最稳）

```bash
# 查提交历史
git log --oneline | grep -i canvas

# 撤销方案 C 提交
git revert <方案 C 的 commit hash>
git push origin main
```

或者直接 checkout：
```bash
git checkout <方案 A 干净状态 commit> -- src/main.ts src/config/CanvasMode.ts
git commit -m "revert: 回到方案 D 默认"
```

## 推荐策略

| 场景 | 推荐 |
|------|------|
| 当前生产稳定运行 | **保持 'd'**（最稳） |
| 想试方案 C 0 黑边 | 环境变量 `VITE_CANVAS_MODE=c npm run build` 部署，**Git 不变** |
| 方案 C 试用发现变形不可接受 | 重新 `VITE_CANVAS_MODE=d npm run build` 部署——不动代码 |
| 方案 C 整体废弃 | Git revert 撤销方案 C 提交 |

## 验证方式

`scripts/verify-canvas-modes.mjs` 在三种模式各跑一遍 19.5:9 viewport，
输出每种方案的 canvas 物理尺寸、HUD 位置、是否变形、是否黑边。

## 选 C 的话变形有多严重？

viewport 19.5:9 (2340×1080)，逻辑 960×640：
- 水平拉伸率 2340/960 = 2.44×，垂直 1080/640 = 1.69×
- 圆形怪物会变**横椭圆**（宽 1.44× 高）
- 文字保持字号相对游戏大小一致，但游戏世界被压扁
- 优点：完全填满屏、视觉一体感强
- 缺点：物理感错位（怪物移动速度按逻辑单位算，但视觉被拉伸）

**如果你的 9-18 岁玩家对画面比例不敏感，方案 C 0 黑边的体验更好。**
**如果想保留「大刀在正确位置砍到怪物」的物理感，方案 A/D 不会变形。**