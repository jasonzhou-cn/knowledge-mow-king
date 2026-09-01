/**
 * 单元测试运行器（scripts/run-unit-tests.mjs）
 * 用途：零新依赖地运行 tests/*.test.ts —— 用 esbuild 把每个测试文件 bundle 成 ESM，
 *       再用 Node 22 内置的 node --test 执行（完全复用 validate-config.mjs 的转译模式）。
 * 说明：tests/ 目录不在 tsconfig include 范围内，不参与 npm run typecheck / build，
 *       避免引入 @types/node 依赖；测试代码的类型正确性由运行结果兜底。
 * 用法：npm test
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const testsDir = join(projectRoot, 'tests');

async function main() {
  const files = readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
  if (files.length === 0) {
    console.error('tests/ 目录下没有找到 *.test.ts 测试文件');
    process.exit(1);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'kb-test-'));
  const outFiles = [];
  try {
    for (const file of files) {
      const outFile = join(workDir, file.replace(/\.ts$/, '.mjs'));
      await build({
        entryPoints: [join(testsDir, file)],
        outfile: outFile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        sourcemap: 'inline',
        logLevel: 'silent',
      });
      outFiles.push(outFile);
    }

    console.log(`运行 ${outFiles.length} 个测试文件（node --test）...\n`);
    const result = spawnSync(process.execPath, ['--test', ...outFiles], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error('单元测试转译失败：', error);
    process.exitCode = 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
