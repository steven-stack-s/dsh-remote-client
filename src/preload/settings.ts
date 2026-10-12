import { contextBridge, ipcRenderer } from 'electron'
import type { ClientSettings } from '../shared/settings.js'

/**
 * 设置页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥
 * （远端页面加载的是 `src/preload/host.ts`，那里没有任何桥）。
 *
 * 暴露的方法刻意保持很少：读设置、写设置、读版本、检查更新、关窗。
 * **刻意不暴露**「读取设置文件路径」「重置全部设置」之类看起来方便的东西——
 * 每多一个方法就多一处需要校验 sender 的入口。
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
      { ok: true } | { ok: false; message: string }
    >,

  /** 关闭设置窗口。 */
  close: () => { ipcRenderer.send('shell:settings:close') },

  /**
   * 读取当前版本与更新器是否可用。
   *
   * @returns 版本号（取不到时为空串）与「能不能检查更新」。
   */
  version: () =>
    ipcRenderer.invoke('shell:settings:version') as Promise<{
      version: string
      updaterAvailable: boolean
    }>,

  /**
   * 立即检查一次更新。
   *
   * @returns 这次检查的结局与**相关版本号**。
   *
   * `version` 的语义：`outcome === 'available'` 时是**新版本号**（界面文案
   * 「发现新版本 X」里的 X）；`up-to-date` / `error` 时为空串；`disabled` 时是当前版本。
   * 该值由主进程的更新时间器提供 —— 界面**不要**拿别处的版本号替换它
   * （曾经被当前版本顶替，导致界面显示错版本）。
   */
  checkUpdate: () =>
    ipcRenderer.invoke('shell:settings:checkUpdate') as Promise<{
      outcome: 'up-to-date' | 'available' | 'downloading' | 'error' | 'disabled'
      version: string
    }>,
})
