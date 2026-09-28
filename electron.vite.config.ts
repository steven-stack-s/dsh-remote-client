import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'src/main/index.ts' } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // sandbox: true 的 preload 不支持 ESM（Electron 官方：Sandboxed preload
      // scripts can't use ESM imports），必须输出 CJS。package.json 是
      // "type": "module"，故 .js 会被当作 ESM，必须用 .cjs。
      lib: {
        entry: {
          host: 'src/preload/host.ts',
          welcome: 'src/preload/welcome.ts',
        },
      },
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          welcome: resolve('src/renderer/welcome.html'),
          offline: resolve('src/renderer/offline.html'),
        },
      },
    },
  },
})
