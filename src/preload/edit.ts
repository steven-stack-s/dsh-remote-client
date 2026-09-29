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
 * 主机选择器用的摘要。
 *
 * **刻意不含 launchToken**：令牌是凭据，只在该主机被选中时由 `loadHost` 单独
 * 下发，不做批量暴露。
 */
export interface HostSummary {
  id: string
  label: string
  origin: string
}

/**
 * 编辑页是壳自有页面，可以安全地暴露一个窄接口；远端页面则绝不放桥
 * （远端页面加载的是 `src/preload/host.ts`，那里没有任何桥）。
 */
contextBridge.exposeInMainWorld('shell', {
  /**
   * 列出所有可编辑的主机（供窗口顶部的主机选择器）。
   *
   * @returns 主机摘要列表（不含令牌）。
   */
  listHosts: () =>
    ipcRenderer.invoke('shell:edit:list') as Promise<HostSummary[]>,

  /**
   * 读取一台主机的当前值。
   *
   * @param hostId - 目标主机 id；省略时取本窗口的初始目标（打开窗口时的那台）。
   * @returns 主机快照；已不存在时返回 null。
   */
  loadHost: (hostId?: string) =>
    ipcRenderer.invoke('shell:edit:load', hostId) as Promise<EditableHost | null>,

  /**
   * 保存编辑结果。
   *
   * `id` 是**目标主机**（窗口内可切换编辑对象，因此不能靠主进程记住上一次的
   * 目标）；返回的 `id` 是保存后的主机 id —— 改地址会重算 id，调用方据此刷新。
   *
   * @param input - 目标主机 id、显示名、主机地址与令牌。
   * @returns 成功（含保存后的 id）或带可读原因失败。
   */
  saveHost: (input: { id: string, label: string, origin: string, launchToken: string }) =>
    ipcRenderer.invoke('shell:edit:save', input) as Promise<
      { ok: true, id: string } | { ok: false, message: string }
    >,

  /** 关闭编辑窗口（取消）。 */
  close: () => { ipcRenderer.send('shell:edit:close') },
})
