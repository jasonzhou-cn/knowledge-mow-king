# 部署与回滚指南（docs/DEPLOY.md）

## 三环境部署矩阵

| 环境 | 端口 | 构建命令 | 启动命令 | 用途 |
|------|------|---------|---------|------|
| **dev** | 5173 | — | `npm run dev`（HMR） | 开发调试，热重载 |
| **test-stable** | 5181 | `npm run build`（方案 D 默认） | `vite preview --port 5181 --outDir dist` | 测试基线，模拟生产 |
| **test-cursor** | 5180 | `VITE_CANVAS_MODE=c npm run build --outDir dist-c` | `vite preview --port 5180 --outDir dist-c` | 试验方案 C + cursor 模式 |
| **prod** | TBD | (用户提供方案后填) | — | 阿里云生产环境 |

部署脚本统一管理：`bash scripts/deploy.sh {dev|test|test-c|stop|status}`

## 你手机访问地址（局域网）

```
http://192.168.31.134:5173/   # dev (HMR，每次改代码自动刷新)
http://192.168.31.134:5181/   # test-stable (方案 D 推荐基线)
http://192.168.31.134:5180/   # test-cursor (方案 C 试验版)
```

## 部署流程（推荐）

```
本地 dev (5173) 验证
    ↓ git push origin main
GitHub main (代码托管 + 版本控制)
    ↓ 拉取 main + npm run build
test-stable (5181) 验证
    ↓ 验证通过
生产环境 (阿里云，TBD 端口)
```

## 回滚机制（三层）

### L1：构建期（30 秒，最快）

```bash
# 切回旧的 mode / 关闭 SafeArea / 切 CanvasMode
# 编辑 src/config/CanvasMode.ts: CANVAS_MODE = 'd'  # 改 'c' → 'd'
npm run build
```

### L2：部署期（CI/脚本可控）

```bash
# 用上一个稳定版本的 dist 直接 serve
git checkout <stable_commit> -- dist/
vite preview --port 5181 --outDir dist
```

### L3：Git 回滚（彻底）

```bash
git revert <bad_commit_hash>
git push origin main
```

## 当前已部署状态

```
port 5173 pid 42388 (dev HMR)
port 5180 pid 32712 (test-cursor / scheme C)  ← 试玩新版
port 5181 pid 44968 (test-stable / scheme D)  ← 测试基线
```

## 状态码速查

- `bash scripts/deploy.sh status` — 看所有 51xx 端口的部署状态
- `bash scripts/deploy.sh stop` — 停掉全部（**会杀掉 5173-5181 上所有 vite 进程**，包括正在用的 dev）
- `bash scripts/deploy.sh test` — rebuild dist + 起 5181（替换 test-stable 产物）

## 生产环境部署（用户提供方案后）

TBD — 待你提供阿里云部署细节（域名、端口、Caddy/Nginx 配置、SSL）。
我会基于此文档扩展：
1. `bash scripts/deploy.sh prod` 实现
2. CI/CD 配置（GitHub Actions 自动 build + 部署）
3. SSL 证书 + HTTPS（fullscreen API / orientation lock 需要安全上下文）