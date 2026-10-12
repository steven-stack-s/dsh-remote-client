import { contextBridge, ipcRenderer } from 'electron'
import type { ClientSettings } from '../shared/settings.js'

/**
 * 设置页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥
 * （远端页面加载的是 `src/preload/host.ts`，那里没有任何桥）。
 *
 * 只暴露这三个方法：读、写、关。**刻意不暴露**「读取设置文件路径」「重置全部
 * 设置」之类看起来方便的东西——每多一个方法就多一处需要校验 sender 的入口，
 * 而本页面的全部职责就是把四个偏好写进 settings.json。
 */
contextBridge.exposeInMainWorld('shell', {
  /**
   * 读取当前设置。
   *
   * @returns 一份字段齐全的设置（缺字段已由主进程补默认值）。
   */
  load: () => ipcRenderer.invoke('shell:settings:load') as Promise<ClientSettings>,

  /**
   * 保存设置。
   *
   * @param input - 用户在界面上改成的值。
   * @returns 成功，或带可读原因的失败（例如写盘失败）。
   */
  save: (input: ClientSettings) =>
    ipcRenderer.invoke('shell:settings:save', input) as Promise<
      { ok: true } | { ok: false, message: string }
    >,

  /** 关闭设置窗口。 */
  close: () => { ipcRenderer.send('shell:settings:close') },
})
