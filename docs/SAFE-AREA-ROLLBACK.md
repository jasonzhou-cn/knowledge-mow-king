# 方案 D 回滚指南（SafeArea → 方案 A 直读模式）

方案 D 在 19.5:9 / 16:9 / 4:3 等 viewport 下让 HUD 自适应安全区，
如果出现问题，按下面三步任选一种回滚。

## 方式 1：常量开关（最快，无需 rebuild 之外的任何操作）

`src/systems/SafeArea.ts` 第 28-32 行：

```typescript
export const ENABLE_SAFE_AREA = true;  // ← 改为 false
```

`false` 时 GrassCuttingScene 直接退化为方案 A 行为：
- HUD 宽度 = `this.scale.width`（= 960 逻辑单位）
- HUD 高度 = `this.scale.height`（= 640 逻辑单位）
- SafeArea 完全不参与

只需 `npm run build` + 部署，UI 行为恢复方案 A 原状。

## 方式 2：Git revert（更彻底，撤销整个方案 D 提交）

```bash
git log --oneline -5   # 找到方案 D 的 commit hash（feat: 方案 D SafeArea...）
git revert <hash>      # 自动生成一个反提交
git push origin main   # 推送
```

`git revert` 不会丢失历史，所有改动可在未来通过 `git revert -m` 还原。

## 方式 3：手动 checkout（直接回退到方案 A 干净状态）

```bash
git checkout <方案A_commit_hash> -- src/scenes/GrassCuttingScene.ts index.html
git add src/scenes/GrassCuttingScene.ts index.html
git commit -m "revert: 回滚方案 D 到方案 A 直读模式"
git push origin main
```

## 选择建议

| 场景 | 推荐方式 |
|------|---------|
| 方案 D 出问题但代码已经在跑 | 1（改常量，最快） |
| 方案 D 整体设计不想要了 | 2（git revert） |
| 想干净回退到方案 A 完美状态 | 3（手动 checkout） |

## 当前状态

方案 D 已通过 CDP 实测（19.5:9 2340×1080 viewport，HUD 在安全区内、0 异常、视觉与方案 A 协同良好）。如果未发现问题，无需回滚。