import { ipcRenderer } from 'electron'

/**
 * 渲染侧观察器：只上报网络连通性，供主进程决定是否立即重试。
 *
 * 这里刻意不调用 contextBridge.exposeInMainWorld——远端页面无需知道
 * 自己被壳承载，保持零侵入。
 *
 * 标题**不**在这里上报：`windows.ts` 已监听 Electron 原生的
 * `page-title-updated` 事件，那是零跨进程开销的唯一正路。
 * 早期版本用 MutationObserver 观察整个文档并逐次 send，在 dsh 流式输出
 * 时 DOM 每秒变化上百次，会造成 IPC 风暴，且与原生事件抢着 setTitle。
 */
window.addEventListener('online', () => { ipcRenderer.send('shell:network', true) })
window.addEventListener('offline', () => { ipcRenderer.send('shell:network', false) })
