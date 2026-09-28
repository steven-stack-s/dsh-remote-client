import { contextBridge, ipcRenderer } from 'electron'

/** 主进程返回给编辑页的主机快照。 */
export interface EditableHost {
  /** 主机 id（用于校验编辑对象）。 */
  id: string
  label: string
  origin: string
  launchToken?: string
}

/**
 * 编辑页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥
 * （远端页面加载的是 `src/preload/host.ts`，那里没有任何桥）。
 */
contextBridge.exposeInMainWorld('shell', {
  /**
   * 读取待编辑主机的当前值。
   *
   * @returns 主机快照；已不存在时返回 null。
   */
  loadHost: () =>
    ipcRenderer.invoke('shell:edit:load') as Promise<EditableHost | null>,

  /**
   * 保存编辑结果。
   *
   * @param input - 显示名、主机地址与令牌。
   * @returns 成功或带可读原因失败。
   */
  saveHost: (input: { label: string, origin: string, launchToken: string }) =>
    ipcRenderer.invoke('shell:edit:save', input) as Promise<
      { ok: true } | { ok: false, message: string }
    >,

  /** 关闭编辑窗口（取消）。 */
  close: () => { ipcRenderer.send('shell:edit:close') },
})
