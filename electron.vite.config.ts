import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'src/main/index.ts' } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // 双入口：host 用于远端主机窗口（零侵入，不暴露任何 API），
      // welcome 用于壳自有的欢迎页（只暴露窄接口 shell.addHost）。
      lib: {
        entry: {
          host: 'src/preload/host.ts',
          welcome: 'src/preload/welcome.ts',
        },
      },
    },
  },
})
