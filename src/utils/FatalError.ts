/**
 * 致命错误阻断（src/utils/FatalError.ts）
 * 职责：当配置校验失败等不可恢复错误发生时，在游戏画布之上渲染一层明确的中文错误提示，
 *      并完全阻断游戏启动——绝不允许脏配置悄悄进入运行环境（GDD 1.4 强类型校验原则）。
 */

const OVERLAY_ID = 'fatal-error';
const MESSAGE_ID = 'fatal-error-msg';

/**
 * 展示致命错误并阻断。
 * @param message 面向开发者的中文错误详情
 */
export function showFatalError(message: string): void {
  // eslint-disable-next-line no-console
  console.error('[知识割草王] 启动阻断：\n' + message);

  const overlay = document.getElementById(OVERLAY_ID);
  const msgBox = document.getElementById(MESSAGE_ID);
  if (overlay && msgBox) {
    msgBox.textContent = message;
    overlay.style.display = 'flex';
  }
  // 抛出以彻底停止后续初始化流程
  throw new Error(`知识割草王启动阻断：${message.split('\n')[0]}`);
}

/** 隐藏致命错误提示层（配置热更新成功后可调用） */
export function clearFatalError(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.style.display = 'none';
}
