# 部署与回滚指南（docs/DEPLOY.md）

## 四端口部署矩阵（最终方案 2026-09-01）

| 端口 | 角色 | 内容 | 用途 |
|------|------|------|------|
| **5173** | **主开发位** | vite preview serve `dist-c/`（**与 5180 字节级一致**） | 你改代码后跑 `base`，5173 和 5180 同步刷新 |
| **5174** | **dev HMR（备用）** | vite dev（按需启动） | 真要 HMR 热重载时用，临时启动 |
| **5180** | **基座 / base** | vite preview serve `dist-c/`（**与 5173 字节级一致**） | 冻结的稳定版本（git tag `base-v1`） |
| **5181** | **备用 / backup** | vite preview serve `dist/`（方案 D 默认） | 备用 / 应急回退 |
| prod | TBD | 用户方案后填 | 阿里云生产环境 |

**你手机访问地址（局域网）**：
```
http://192.168.31.134:5173/   # 主开发位（与 5180 同源）
http://192.168.31.134:5174/   # dev HMR（按需启动）
http://192.168.31.134:5180/   # 基座 / base（与 5173 同源）
http://192.168.31.134:5181/   # 备用
```

## 5173 vs 5180 vs 5174 的关系（**最重要**）

```
git HEAD (fe56791)
   ├── dist-c/  (build 产物 dist-c/assets/index-BFwJXcfs.js)
   │     ├── 5173 vite preview  ←─┐
   │     └── 5180 vite preview  ←─┤── 服务完全相同的静态产物
   │                              │   (字节级一致 = 同一份 index-BFwJXcfs.js)
   │                              │
   └── src/  (开发源码)
         └── 5174 vite dev HMR ←── 实时编译 src/，与 5173/5180 不共享产物

5173 和 5180 = 同一份 build 产物（dist-c/）
5174 = 独立的 dev 服务，编译 src/ 实时输出（与 5173/5180 字节不同但源代码同源）
```

**5173 是 5180 的"克隆/检出"** —— 你要的"5173 是基于 5180 的版本"已经实现：两者跑 `dist-c/` 同一目录、同一 bundle hash。

## 部署脚本

`bash scripts/deploy.sh` 统一管理：

| 命令 | 作用 | 是否杀进程 |
|------|------|----------|
| `status` | 看部署矩阵 + 磁盘产物 + **5173 vs 5180 一致性验证** + git tag 对比 | 否 |
| `dev` | 起 5174 vite HMR（**前端编译，5173/5180 同步验证**用） | 否 |
| `base` | rebuild dist-c/ + **交互确认**后发布到 5173/5180 | 否 |
| `backup` | rebuild dist/ + **交互确认**后发布到 5181 | 否 |
| `stop` | ⚠️ 停掉所有 vite preview 进程（含 5173/5180/5181） | **是** |

## 完整部署流程

```
改 src/ 等代码
    ↓ 验证
跑 ./scripts/deploy.sh base
    ↓ 出现"按 Enter 确认"提示 → 按 Enter
    ↓ rebuild dist-c/
    ↓ 5173 / 5180 下次请求自动读新包
标记新版本
    ↓ git tag base-vN  # 标记本次发布（如 base-v2、base-v3）
应急回退
    ↓ git checkout base-v1 -- dist-c/  # 秒级还原 5173/5180 到旧版
```

## 验证一致性的 status 输出示例

```
[deploy] 当前部署矩阵
  port 5173  pid 45468  (主开发位 / preview / 与 5180 同步)
  port 5180  pid 32712  (基座 / base / 与 5173 同源)
  port 5181  pid 44968  (备用 / backup / 方案 D 默认)

[deploy] 磁盘产物
  dist/   = index-CoRN88bH.js  [backup]
  dist-c/ = index-BFwJXcfs.js  [base]  (5173/5180 都 serve 此目录)

[deploy] 当前 base 与 git HEAD 对比
  HEAD (fe567912) ≠ base-v1 (dcbb07a2)  有新提交未发布到 base
  发布：./scripts/deploy.sh base  →  还原：git checkout base-v1 -- dist-c/

[deploy] 一致性验证（5173 vs 5180 必须相同才算 base 同步）
  ✓ 5173 (index-BFwJXcfs.js) == 5180 (index-BFwJXcfs.js)  同步
```

## Base 冻结保护机制（多层）

1. **git tag `base-v1`**：标记 base 快照，可随时 `git checkout base-v1 -- dist-c/` 还原
2. **deploy.sh base/backup 要求确认**：执行前要求按 Enter 确认
3. **NTFS `attrib +R`**：文件级只读防文件内容被改（但 rm -rf 仍能删——NTFS 限制）
4. **status 一致性自动验证**：每次 status 检查 5173 vs 5180 hash 是否相同

**强烈推荐**：每次替换 base 前先 `git tag base-v2` 标记旧版。

## 当前 Git Tag（冻结基座快照）

```bash
$ git tag -l
base-v1        # 指向 dcbb07a（5173/5180 当前服务的快照）
```

## 回滚机制（三层）

### L1：构建期（确认后立即生效）

```bash
git checkout base-v1 -- public/config/ src/config/
./scripts/deploy.sh base   # 重建 + 发布
```

### L2：部署期（用旧 dist 还原，**秒级**）

```bash
git checkout base-v1 -- dist-c/
# vite preview 自动从磁盘重读，无须重启
# 手机刷新 5173 或 5180 即可见旧版本
```

### L3：Git 回滚（彻底）

```bash
git revert <bad_commit>
git push origin main
```

## 重要操作注意事项

1. **base/backup 不会重启 vite preview 进程**——只 rebuild 产物目录。重启浏览器/刷新页面即可看新版。
2. **base/backup 现在需要交互确认**——按 Enter 继续，Ctrl+C 取消（防止误覆盖）
3. **5173/5180 完全同步**：两者都 serve 同一 dist-c/ 目录，rebuild 后两边同时看到新版
4. **如果 vite preview 进程挂了**（断网/异常），手动重启：
   ```bash
   nohup npx vite preview --port 5173 --host 0.0.0.0 --outDir dist-c > /dev/null 2>&1 &
   nohup npx vite preview --port 5180 --host 0.0.0.0 --outDir dist-c > /dev/null 2>&1 &
   ```
5. **不要随便跑 `stop`**——它会杀所有 51xx 端口的 vite preview，包括正在用的 5173/5180
6. **5174 是临时的**——只在确实需要 HMR 时启动，不用就空着

## 生产环境部署（用户提供方案后）

TBD — 待你提供阿里云部署细节（域名、端口、Caddy/Nginx 配置、SSL）。