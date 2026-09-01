#!/usr/bin/env bash
# 部署脚本（scripts/deploy.sh）
# 统一管理三环境部署，所有产物路径 / 端口 / 启动命令集中管理。
# 用法：
#   ./scripts/deploy.sh dev      # 起 5173 dev（HMR，主开发位）
#   ./scripts/deploy.sh base     # rebuild dist-c/ + vite preview 从磁盘重读，发布到 5180
#   ./scripts/deploy.sh backup   # rebuild dist/ + vite preview 从磁盘重读，发布到 5181
#   ./scripts/deploy.sh status   # 看哪个端口在跑什么版本（不杀任何进程）
#   ./scripts/deploy.sh stop     # 停掉所有 vite 进程（**危险**：会杀正在用的 dev）
#
# 角色分工（用户最终方案，2026-09-01）：
#   5173 = 主开发位（dev HMR，所有新版本在这里改代码）
#   5180 = 基座 / base（方案 C + cursor，上次发布的稳定版本保留作对照）
#   5181 = 备用 / backup（方案 D 默认，备用/应急回退）
#   prod = 阿里云（TBD，用户提供方案后扩展）
#
# 部署流程：
#   开发（5173 HMR）
#     ↓ 验证通过 + git commit
#   构建 → dist-c/ 或 dist/
#     ↓ ./scripts/deploy.sh base / backup
#   浏览器刷新 5180 / 5181（vite preview 从磁盘重读，无须重启进程）

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cmd="${1:-status}"

case "$cmd" in
  dev)
    echo "[deploy] vite dev (port 5173, HMR) - 主开发位"
    npx vite --port 5173 --host 0.0.0.0 --strictPort
    ;;
  base)
    echo "[deploy] build dist-c/ (方案 C + cursor) + 发布到 5180"
    echo ""
    echo "  ⚠️  重要：此操作会替换当前 5180 上的 base 版本！"
    echo "  ⚠️  5180 当前服务的是冻结的 base 快照（tag: base-v1）"
    echo ""
    if [ -f .git/HEAD ] && git rev-parse --verify base-v1 >/dev/null 2>&1; then
      current_base=$(git rev-list -n 1 base-v1)
      current_head=$(git rev-parse HEAD)
      echo "  base-v1  = $current_base"
      echo "  HEAD     = $current_head"
      if [ "$current_base" != "$current_head" ]; then
        echo "  ⚠️  HEAD 已偏离 base-v1（开发了新版本）"
      fi
    fi
    echo ""
    echo "  按 Enter 继续（替换 base），Ctrl+C 取消"
    read -r _ < /dev/tty || { echo "[deploy] 取消"; exit 1; }
    rm -rf dist-c
    VITE_CANVAS_MODE=c npx vite build --outDir dist-c
    # NTFS 文件级只读（防止文件被误改，但 rm -rf 仍能删——主要靠流程控制保护）
    python -c "import subprocess; subprocess.run(['attrib', '+R', 'dist-c', '/S', '/D'], capture_output=True, timeout=30)" 2>/dev/null || true
    echo "[deploy] ✓ dist-c/ 已重建（base 已替换为新版本）。手机刷新 http://192.168.31.134:5180/ 即可看到新版"
    echo "[deploy]    想恢复原 base：git checkout base-v1 -- dist-c/"
    ;;
  backup)
    echo "[deploy] build dist/ (方案 D 默认) + 发布到 5181"
    echo ""
    echo "  ⚠️  重要：此操作会替换当前 5181 上的 backup 版本！"
    echo ""
    echo "  按 Enter 继续（替换 backup），Ctrl+C 取消"
    read -r _ < /dev/tty || { echo "[deploy] 取消"; exit 1; }
    rm -rf dist
    npm run build
    python -c "import subprocess; subprocess.run(['attrib', '+R', 'dist', '/S', '/D'], capture_output=True, timeout=30)" 2>/dev/null || true
    echo "[deploy] ✓ dist/ 已重建（backup 已替换为新版本）。手机刷新 http://192.168.31.134:5181/ 即可看到新版"
    echo "[deploy]    想恢复原 backup：git checkout <last_backup_commit> -- dist/"
    ;;
  stop)
    echo "[deploy] stop all vite processes（⚠️ 危险：会杀 5173-5181 上所有 vite）"
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $5}' | sort -u | while read pid; do
      if [ -n "$pid" ]; then
        echo "  kill pid=$pid"
        taskkill //PID "$pid" //F 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
      fi
    done
    ;;
  status)
    echo "[deploy] 当前部署矩阵"
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $2, $5}' | while read port pid; do
      tag=""
      case "$port" in
        *5173) tag="(主开发位 / dev HMR)" ;;
        *5180) tag="(基座 / base / 方案 C + cursor)" ;;
        *5181) tag="(备用 / backup / 方案 D 默认)" ;;
      esac
      echo "  port $port  pid $pid  $tag"
    done
    echo ""
    echo "[deploy] 磁盘产物（vite preview 从磁盘读）"
    if [ -d dist ]; then
      dist_hash=$(ls dist/assets/*.js 2>/dev/null | head -1 | xargs -n1 basename 2>/dev/null)
      echo "  dist/   = $dist_hash  [backup]"
    fi
    if [ -d dist-c ]; then
      distc_hash=$(ls dist-c/assets/*.js 2>/dev/null | head -1 | xargs -n1 basename 2>/dev/null)
      echo "  dist-c/ = $distc_hash  [base]"
    fi
    echo ""
    echo "[deploy] 冻结保护：base/backup 命令执行前要求交互确认（按 Enter 继续）"
    echo "[deploy] 还原旧版本：git checkout base-v1 -- dist-c/  # dist/ 同理"
    ;;
  *)
    echo "Usage: $0 {dev|base|backup|status|stop}"
    echo ""
    echo "  dev    - 起 5173 vite HMR（主开发位）"
    echo "  base   - rebuild dist-c/ 发布到 5180（不动服务进程）"
    echo "  backup - rebuild dist/ 发布到 5181（不动服务进程）"
    echo "  status - 看部署矩阵 + 磁盘产物"
    echo "  stop   - 停掉所有 vite 进程（⚠️ 包含正在用的 dev）"
    exit 1
    ;;
esac