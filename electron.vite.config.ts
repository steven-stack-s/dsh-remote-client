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
          edit: 'src/preload/edit.ts',
        },
      },
      rollupOptions: {
        // 必须显式声明 external：externalizeDepsPlugin 只读 package.json 的
        // `dependencies`，本项目依赖全在 `devDependencies`，plugin 会把 electron-vite
        // 预设里本已正确的 external 列表覆盖成空，导致 npm `electron` 包被整包内联。
        // 该包顶层 `module.exports = getElectronPath()` 在 require 时即执行 spawnSync，
        // 在 sandbox: true 的 preload 里必然抛错 → preload 全挂、window.shell 为 undefined。
        external: ['electron'],
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
          edit: resolve('src/renderer/edit.html'),
        },
      },
    },
  },
})
