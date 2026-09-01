# 部署与回滚指南（docs/DEPLOY.md）

## 三环境部署矩阵（最终方案 2026-09-01）

| 端口 | 角色 | 内容 | 用途 |
|------|------|------|------|
| **5173** | **主开发位** | vite dev HMR | **新版本开发在此进行**，热重载，所有代码改动从这里出发 |
| **5180** | **基座 / base** | 方案 C + cursor 模式（dist-c/） | **保留的稳定版本**，作为新版本对照；或快速回退至此版本 |
| **5181** | **备用 / backup** | 方案 D 默认（dist/） | 备用 / 应急回退 |
| prod | TBD | 用户方案后填 | 阿里云生产环境 |

**用户手机访问地址（局域网）**：
```
http://192.168.31.134:5173/   # 主开发位（你改代码看效果的地方）
http://192.168.31.134:5180/   # 基座 / 上次发布版本（保留不变）
http://192.168.31.134:5181/   # 备用（保留不变）
```

## 部署脚本

`bash scripts/deploy.sh` 统一管理：

| 命令 | 作用 |
|------|------|
| `status` | 看部署矩阵 + 磁盘产物（**只读，不杀任何进程**） |
| `dev` | 起 5173 vite HMR |
| `base` | rebuild dist-c/ 发布到 5180（**不动服务进程**，下次请求自动读新包） |
| `backup` | rebuild dist/ 发布到 5181（**不动服务进程**，下次请求自动读新包） |
| `stop` | ⚠️ 停掉所有 vite 进程（含正在用的 dev） |

## 完整部署流程

```
开发（5173 HMR）
    ↓ 验证通过 + git commit
rebuild + publish
    ↓ ./scripts/deploy.sh base   # 发布新版本到基座（5180）
    ↓   或 ./scripts/deploy.sh backup  # 发布到备用（5181）
备份与回滚
    ↓ git tag v0.x.x 标记发布版本
应急回退
    ↓ git checkout <last_stable_commit> -- dist-c/
    ↓ vite preview 自动读取（无须重启）
```

## 回滚机制（三层）

### L1：构建期（30 秒，最快）

```bash
# 改配置回上一稳定版
git checkout <stable_commit> -- public/config/  src/config/
./scripts/deploy.sh base   # rebuild + 发布到 5180
```

### L2：部署期（用旧 dist）

```bash
# 还原 dist-c/ 到上一稳定 commit
git checkout <stable_commit> -- dist-c/
# vite preview 自动从磁盘重读，无须重启
# 手机刷新 5180 即可见旧版本
```

### L3：Git 回滚（彻底）

```bash
git revert <bad_commit>
git push origin main
```

## 状态码速查

```bash
$ bash scripts/deploy.sh status
[deploy] 当前部署矩阵
  port 0.0.0.0:5173  pid 42388  (主开发位 / dev HMR)
  port 0.0.0.0:5180  pid 32712  (基座 / base / 方案 C + cursor)
  port 0.0.0.0:5181  pid 44968  (备用 / backup / 方案 D 默认)

[deploy] 磁盘产物（vite preview 从磁盘读）
  dist/   = index-XXX.js  [backup]
  dist-c/ = index-YYY.js  [base]
```

## 重要操作注意事项

1. **`./scripts/deploy.sh base/backup` 不会重启 vite preview 进程**——它只重建产物目录。重启浏览器/刷新页面即可看新版。
2. **如果 vite preview 进程挂了**（断网/异常），手动重启：
   ```bash
   nohup npx vite preview --port 5180 --host 0.0.0.0 --outDir dist-c > /dev/null 2>&1 &
   ```
3. **不要随便跑 `stop`**——它会杀所有 51xx 端口的 vite 进程，包括正在用的 dev。
4. **5173 HMR 是开发体验**——它会实时刷新浏览器，无需 `base`/`backup` 命令；只在需要"模拟生产"或"分享稳定版给别人"时才 build。

## 生产环境部署（用户提供方案后）

TBD — 待你提供阿里云部署细节（域名、端口、Caddy/Nginx 配置、SSL）。
我会基于此文档扩展：
1. `./scripts/deploy.sh prod` 实现（build + rsync + restart Caddy/Nginx）
2. CI/CD 配置（GitHub Actions 自动 build + 部署）
3. SSL 证书 + HTTPS（fullscreen API / orientation lock 需要安全上下文）