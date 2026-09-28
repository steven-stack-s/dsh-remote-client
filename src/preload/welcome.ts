import { contextBridge, ipcRenderer } from 'electron'

/**
 * 欢迎页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥
 * （远端页面加载的是 `src/preload/host.ts`，那里没有任何桥）。
 */
contextBridge.exposeInMainWorld('shell', {
  /**
   * 提交一台新主机。
   *
   * @param input - 用户填写的地址与可选显示名。
   * @returns 成功（并告知是否需要重启才生效）或带可读原因失败。
   */
  addHost: (input: { origin: string, label?: string }) =>
    ipcRenderer.invoke('shell:welcome:add', input) as Promise<
      | { ok: true, needsRestart: boolean }
      | { ok: false, message: string }
    >,

  /**
   * 请求重启客户端（用于让新增的 `http://` 主机的安全上下文豁免生效）。
   *
   * @returns 主进程是否接受该请求（仅欢迎页会被接受）。
   */
  restart: () =>
    ipcRenderer.invoke('shell:restart') as Promise<{ ok: boolean }>,
})
