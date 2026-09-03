/**
 * 配置校验脚本（scripts/validate-config.mjs）
 * 用途：不启动浏览器、不依赖 Phaser，直接在 Node 里跑一遍 validateAllConfigs()，
 *      用于在提交前拦截非法配置（GDD 1.4 强类型校验原则）。
 *
 * 实现：validator.ts 只依赖类型定义，可以用 esbuild 原地转译成 ESM 后直接 import，
 *      不需要引入额外的测试框架。
 *
 * 用法：npm run validate-config
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const configDir = join(projectRoot, 'public', 'config');

/** 与 src/config/types.ts 的 ConfigModuleName 保持一致 */
const MODULES = [
  'gameSettings',
  'questionConfig',
  'grassCuttingConfig',
  'levelConfig',
  'rewardConfig',
  'subjectConfig',
  'questionBank',
  'weaponConfig',
  'bossDialogue',
  'resultFlavor',
];

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'kb-validate-'));
  const outFile = join(workDir, 'validator.mjs');

  try {
    await build({
      entryPoints: [join(projectRoot, 'src', 'config', 'validator.ts')],
      outfile: outFile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });

    const { validateAllConfigs } = await import(pathToFileURL(outFile).href);

    const raw = {};
    for (const name of MODULES) {
      const file = join(configDir, `${name}.json`);
      raw[name] = JSON.parse(readFileSync(file, 'utf8'));
    }

    validateAllConfigs(raw);
    console.log(`配置校验通过：${MODULES.length} 个模块全部合法`);
  } catch (error) {
    // 校验错误本身携带完整中文报告，直接原样输出
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
