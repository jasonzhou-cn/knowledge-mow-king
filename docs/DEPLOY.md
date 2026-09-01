# 部署与回滚指南（docs/DEPLOY.md）

## 三环境部署矩阵（最终方案 2026-09-01）

| 端口 | 角色 | 内容 | 用途 |
|------|------|------|------|
| **5173** | **主开发位** | vite dev HMR（直接编译 src/） | **新版本开发在此进行**——你改代码、自动热重载 |
| **5180** | **基座 / base** | 方案 C + cursor 模式（dist-c/） | **冻结的稳定版本**——base-v1 tag 标记，新版本对照基线 |
| **5181** | **备用 / backup** | 方案 D 默认（dist/） | 备用 / 应急回退 |
| prod | TBD | 用户方案后填 | 阿里云生产环境 |

**你手机访问地址（局域网）**：
```
http://192.168.31.134:5173/   # 主开发位（HMR，改代码即见）
http://192.168.31.134:5180/   # 基座 / 当前 base 快照
http://192.168.31.134:5181/   # 备用
```

## 5173 与 5180 的关系（重要）

```
git HEAD (dcbb07a) ──────┬─────────────────── 同一份源代码
                         ↓                            ↓
              5173 (dev HMR)                  5180 (preview)
              实时编译 src/                  serve dist-c/
              改代码 → 自动刷新             改代码 → 不会立即反映
                                                     ↓
                                       必须跑 ./scripts/deploy.sh base
                                       rebuild dist-c/ 后才能反映
```

**5173 是开发位**（"基于当前 src/"），**5180 是 base 快照**（dist-c/ 是 src/ 的 build 产物，hash 不同但源代码相同）。两者代表**同一份代码的两种渲染方式**。

要把 5173 的开发成果发布到 5180 base：`bash scripts/deploy.sh base`

## 部署脚本

`bash scripts/deploy.sh` 统一管理：

| 命令 | 作用 | 是否杀进程 |
|------|------|----------|
| `status` | 看部署矩阵 + 磁盘产物（**只读，不杀任何进程**） | 否 |
| `dev` | 起 5173 vite HMR | 否（但占用 5173） |
| `base` | rebuild dist-c/ + **交互确认**后发布到 5180 | 否 |
| `backup` | rebuild dist/ + **交互确认**后发布到 5181 | 否 |
| `stop` | ⚠️ 停掉所有 vite 进程（含正在用的 dev） | **是** |

## 完整部署流程

```
开发（5173 HMR）
    ↓ 验证通过 + git commit
rebuild + publish（带确认）
    ↓ ./scripts/deploy.sh base       # 替换 5180 base（按 Enter 确认）
    ↓   或 ./scripts/deploy.sh backup  # 替换 5181 backup
备份与回滚
    ↓ git tag base-v2 标记新发布的版本
应急回退
    ↓ git checkout base-v1 -- dist-c/  # 还原 base 旧版本（5180）
    ↓ vite preview 自动读盘（无须重启）
```

## 回滚机制（三层）

### L1：构建期（确认后立即生效）

```bash
# 改配置回上一稳定版
git checkout base-v1 -- public/config/  src/config/
./scripts/deploy.sh base   # 重建 + 发布
```

### L2：部署期（用旧 dist 还原，最快）

```bash
# 还原 base 到 base-v1
git checkout base-v1 -- dist-c/
# vite preview 自动从磁盘重读，无须重启
# 手机刷新 5180 即可见旧版本
```

### L3：Git 回滚（彻底）

```bash
git revert <bad_commit>
git push origin main
```

## 当前 Git Tag（冻结基座快照）

```bash
$ git tag -l
base-v1        # 指向 dcbb07a（部署到 5180 的冻结基座）

# 查看 base-v1 详情
$ git show base-v1
tag base-v1
Tagger: Jason Zhou
Date:   Tue Sep 1 15:24:22 2026 +0800

Base version v1: 方案 C + cursor 模式，部署在 5180 作为冻结基座
```

## Base 冻结保护机制

**现实约束**：在 Git Bash on Windows + NTFS 上，**文件权限（chmod -w / attrib +R）无法阻止 `rm -rf` 删除目录**。NTFS 的 read-only 只防文件内容修改，不防目录删除。

**所以 base 的保护只能靠流程**：
1. **git tag base-v1**：标记 base 快照，可随时 `git checkout base-v1 -- dist-c/` 还原
2. **deploy.sh base/backup 要求确认**：执行前要求按 Enter 确认，避免误操作
3. **deploy.sh 自动设置 NTFS +R**：防文件内容被改，防部分编辑器误存
4. **status 显示当前 hash + tag 对比**：可一眼看出 base 是否偏离 base-v1

**强烈推荐**：每次替换 base 前先 `git tag base-v2` 标记旧版，万一新版有问题可 `git checkout base-v1 -- dist-c/` 还原。

## 状态码速查

```bash
$ bash scripts/deploy.sh status
[deploy] 当前部署矩阵
  port 0.0.0.0:5173  pid 42388  (主开发位 / dev HMR)
  port 0.0.0.0:5180  pid 32712  (基座 / base / 方案 C + cursor)
  port 0.0.0.0:5181  pid 44968  (备用 / backup / 方案 D 默认)

[deploy] 磁盘产物（vite preview 从磁盘读）
  dist/   = index-CoRN88bH.js  [backup]
  dist-c/ = index-BFwJXcfs.js  [base]
```

## 重要操作注意事项

1. **base/backup 不会重启 vite preview 进程**——只 rebuild 产物目录。重启浏览器/刷新页面即可看新版。
2. **base/backup 现在需要交互确认**——按 Enter 继续，Ctrl+C 取消（防止误覆盖）
3. **如果 vite preview 进程挂了**（断网/异常），手动重启：
   ```bash
   nohup npx vite preview --port 5180 --host 0.0.0.0 --outDir dist-c > /dev/null 2>&1 &
   ```
4. **不要随便跑 `stop`**——它会杀所有 51xx 端口的 vite 进程，包括正在用的 dev。
5. **5173 HMR 是开发体验**——它会实时刷新浏览器，无需 `base`/`backup` 命令；只在需要"模拟生产"或"分享稳定版给别人"时才 build。

## 生产环境部署（用户提供方案后）

TBD — 待你提供阿里云部署细节（域名、端口、Caddy/Nginx 配置、SSL）。
我会基于此文档扩展：
1. `./scripts/deploy.sh prod` 实现（build + rsync + restart Caddy/Nginx）
2. CI/CD 配置（GitHub Actions 自动 build + 部署）
3. SSL 证书 + HTTPS（fullscreen API / orientation lock 需要安全上下文）