/**
 * Vite 构建配置
 * 职责：定义开发服务器端口、基础路径与生产构建输出目录。
 * 采用相对 base 路径，保证构建产物可直接放到任意静态托管子目录下运行。
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 2048,
  },
});
