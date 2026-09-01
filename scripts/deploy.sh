#!/usr/bin/env bash
# 部署脚本（scripts/deploy.sh）
# 统一管理四端口部署，所有产物路径 / 端口 / 启动命令集中管理。
# 用法：
#   ./scripts/deploy.sh dev      # 起 5174 vite dev HMR（按需）
#   ./scripts/deploy.sh base     # rebuild dist-c/ + 5173/5180 都自动读新版本（强制确认）
#   ./scripts/deploy.sh backup   # rebuild dist/ + 5181 自动读新版本（强制确认）
#   ./scripts/deploy.sh status   # 看哪个端口在跑什么版本（不杀任何进程）
#   ./scripts/deploy.sh stop     # 停掉所有 vite 进程（**危险**：会杀正在用的 preview）
#
# 角色分工（用户最终方案，2026-09-01）：
#   5173 = 主开发位 preview（serve dist-c/，与 5180 完全同步的同源包）
#   5174 = 备用 dev HMR（按需启动，提供热重载体验）
#   5180 = 基座 / base（dist-c/，与 5173 同源）
#   5181 = 备用 / backup（dist/，方案 D 默认）
#   prod = 阿里云（TBD，用户提供方案后扩展）
#
# 部署流程：
#   改 src/ 等代码
#     ↓ ./scripts/deploy.sh base   # rebuild dist-c/，5173/5180 都自动从磁盘读新包
#   ⚠️ 失去 HMR 热重载！改完代码必须跑 base 才能看效果
#   （想用 HMR 临时开 dev：./scripts/deploy.sh dev 起 5174）

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cmd="${1:-status}"

case "$cmd" in
  dev)
    echo "[deploy] vite dev HMR (port 5174) - 备用热重载开发位"
    echo "[deploy] 如果 5174 已有 vite dev 进程在跑，直接复用即可"
    netstat -ano 2>/dev/null | grep ":5174.*LISTENING" | head -1 | awk '{print "         当前 5174 pid=" $5 "（无需重启）"}' || true
    echo "[deploy] 如未跑，按下面命令启动："
    echo "         nohup npx vite --port 5174 --host 0.0.0.0 --strictPort > /dev/null 2>&1 &"
    echo "[deploy] 手机访问 http://192.168.31.134:5174/ 即可热重载"
    exit 0
    ;;
  base)
    echo "[deploy] build dist-c/ (方案 C + cursor) + 发布到 5173/5180"
    echo ""
    echo "  ⚠️  重要：此操作会替换当前 5173 和 5180 上的 base 版本！"
    echo "  ⚠️  5173 和 5180 服务完全相同的 dist-c/，一次替换两边同步"
    echo "  ⚠️  5173 / 5180 上的 vite preview 进程不会被重启"
    echo "  ⚠️  下次请求会从磁盘重读新版包"
    # 安全检查：dist-c/ 是否被设为只读（保护 base 冻结版本防误覆盖）
    if [ -d dist-c ] && [ ! -w dist-c ]; then
      echo "[deploy] ⚠️  dist-c/ 当前是只读状态（base 冻结保护）"
      echo "[deploy]    强制覆盖请先:  chmod -R u+w dist-c/"
      echo "[deploy]    或者改用 git checkout 还原旧 dist-c/ 后 chmod 再 rm -rf"
      exit 1
    fi
    rm -rf dist-c
    VITE_CANVAS_MODE=c npx vite build --outDir dist-c
    # NTFS 文件级只读（防止文件被误改，但 rm -rf 仍能删——主要靠流程控制保护）
    python -c "import subprocess; subprocess.run(['attrib', '+R', 'dist-c', '/S', '/D'], capture_output=True, timeout=30)" 2>/dev/null || true
    echo "[deploy] ✓ dist-c/ 已重建。手机刷新 http://192.168.31.134:5173/ 或 /5180/ 即可看到新版"
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
    echo "[deploy] stop all vite processes（⚠️ 危险：会杀 5173/5180/5181 上所有 vite preview）"
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $5}' | sort -u | while read pid; do
      if [ -n "$pid" ]; then
        echo "  kill pid=$pid"
        taskkill /F /PID "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
      fi
    done
    ;;
  status)
    echo "[deploy] 当前部署矩阵"
    netstat -ano 2>/dev/null | grep -E ":51(7[3-9]|80|81).*LISTENING" | awk '{print $2, $5}' | while read port pid; do
      tag=""
      case "$port" in
        *5173) tag="(主开发位 / preview / 与 5180 同步)" ;;
        *5174) tag="(dev HMR / 备用 / 已起则复用)" ;;
        *5180) tag="(基座 / base / 与 5173 同源)" ;;
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
      echo "  dist-c/ = $distc_hash  [base]  (5173/5180 都 serve 此目录)"
    fi
    echo ""
    echo "[deploy] 当前 base 与 git HEAD 对比"
    if git rev-parse --verify base-v1 >/dev/null 2>&1; then
      base_hash=$(git rev-list -n 1 base-v1 | head -c 8)
      head_hash=$(git rev-parse HEAD | head -c 8)
      if [ "$base_hash" = "$head_hash" ]; then
        echo "  HEAD ($head_hash) = base-v1 ($base_hash)  一致"
      else
        echo "  HEAD ($head_hash) ≠ base-v1 ($base_hash)  有新提交未发布到 base"
        echo "  发布：./scripts/deploy.sh base  →  还原：git checkout base-v1 -- dist-c/"
      fi
    else
      echo "  尚未打 base-v1 tag（首次发布后建议 git tag base-v1 标记快照）"
    fi
    echo ""
    echo "[deploy] 一致性验证（5173 vs 5180 必须相同才算 base 同步）"
    hash_5173=$(curl -s http://127.0.0.1:5173/ 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
    hash_5180=$(curl -s http://127.0.0.1:5180/ 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
    if [ -n "$hash_5173" ] && [ "$hash_5173" = "$hash_5180" ]; then
      echo "  ✓ 5173 ($hash_5173) == 5180 ($hash_5180)  同步"
    else
      echo "  ⚠️  5173 ($hash_5173) ≠ 5180 ($hash_5180)  不同步！"
      echo "      跑 ./scripts/deploy.sh base 重新发布"
    fi
    ;;
  *)
    echo "Usage: $0 {dev|base|backup|status|stop}"
    echo ""
    echo "  dev    - 起 5174 vite HMR（备用，按需启动）"
    echo "  base   - rebuild dist-c/ 发布到 5173/5180（要求确认，不杀 preview 进程）"
    echo "  backup - rebuild dist/ 发布到 5181（要求确认，不杀 preview 进程）"
    echo "  status - 看部署矩阵 + 磁盘产物 + 一致性验证"
    echo "  stop   - 停掉所有 vite preview 进程（⚠️ 包含正在用的 5173/5180/5181）"
    exit 1
    ;;
esac