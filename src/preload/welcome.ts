import { contextBridge, ipcRenderer } from 'electron'

/**
 * 欢迎页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥。
 */
contextBridge.exposeInMainWorld('shell', {
  /**
   * 提交一台新主机。
   *
   * @param input - 用户填写的地址与可选显示名。
   * @returns 成功或带可读原因失败。
   */
  addHost: (input: { origin: string, label?: string }) =>
    ipcRenderer.invoke('shell:welcome:add', input) as Promise<
      { ok: true } | { ok: false, message: string }
    >,
})
