#!/usr/bin/env bash
# 部署脚本（scripts/deploy.sh）
# 统一管理三环境部署，所有产物路径 / 端口 / 启动命令集中管理。
# 用法：
#   ./scripts/deploy.sh dev     # 起 5173 dev（HMR）
#   ./scripts/deploy.sh test    # build + 起 5181（方案 D 默认，测试基线）
#   ./scripts/deploy.sh test-c  # build + 起 5180（方案 C 试验）
#   ./scripts/deploy.sh stop    # 停掉所有 vite preview / dev
#   ./scripts/deploy.sh status  # 看哪个端口在跑哪个版本

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cmd="${1:-status}"

case "$cmd" in
  dev)
    echo "[deploy] vite dev (port 5173, HMR)"
    npx vite --port 5173 --host 0.0.0.0 --strictPort
    ;;
  test)
    echo "[deploy] build dist + preview (port 5181, scheme D default)"
    rm -rf dist && npm run build
    npx vite preview --port 5181 --host 0.0.0.0 --strictPort --outDir dist
    ;;
  test-c)
    echo "[deploy] build dist-c + preview (port 5180, scheme C cursor)"
    rm -rf dist-c && VITE_CANVAS_MODE=c npx vite build --outDir dist-c
    npx vite preview --port 5180 --host 0.0.0.0 --strictPort --outDir dist-c
    ;;
  stop)
    echo "[deploy] stop all vite processes"
    # Vite preview 后台进程是 node 调用 vite preview
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $5}' | sort -u | while read pid; do
      if [ -n "$pid" ]; then
        echo "  kill pid=$pid"
        taskkill //PID "$pid" //F 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
      fi
    done
    ;;
  status)
    echo "[deploy] status"
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $2, $5}' | while read port pid; do
      tag=""
      case "$port" in
        *5173) tag="(dev HMR)" ;;
        *5180) tag="(test-cursor / scheme C)" ;;
        *5181) tag="(test-stable / scheme D)" ;;
      esac
      echo "  port $port pid $pid $tag"
    done
    ;;
  *)
    echo "Usage: $0 {dev|test|test-c|stop|status}"
    exit 1
    ;;
esac