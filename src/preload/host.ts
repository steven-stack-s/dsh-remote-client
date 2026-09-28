import { ipcRenderer } from 'electron'

/**
 * 渲染侧观察器。本任务只上报标题；通知观察器在阶段 2 加入。
 *
 * 这里刻意不调用 contextBridge.exposeInMainWorld——远端页面无需知道
 * 自己被壳承载，保持零侵入。
 */
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('shell:title', document.title)
})

const observer = new MutationObserver(() => {
  ipcRenderer.send('shell:title', document.title)
})
observer.observe(document, { subtree: true, childList: true, characterData: true })

window.addEventListener('online', () => { ipcRenderer.send('shell:network', true) })
window.addEventListener('offline', () => { ipcRenderer.send('shell:network', false) })
