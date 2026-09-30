/**
 * (English) Dev-time DevTools Console probe for the dsh front-end. It hunts for the
 * stable DOM signals (approval request appears / new assistant message) consumed by
 * the native-notification feature. Usage: paste this whole file into the DevTools
 * Console of a dsh window. The notes below are in Chinese; the comment text is
 * intentionally untranslated — this is a developer tool, not user-facing docs.
 *
 * DSH DOM 特征勘察脚本
 * =====================
 *
 * 用途：为「原生通知」功能找出 dsh 前端里**稳定的 DOM 信号**
 *      （① 审批请求出现  ② 新增助手消息）。
 *
 * 为什么需要它：dsh 前端的类名是哈希化的（如 `.mna1RW_strip`），跨版本会变，
 * 不能作为判据。必须从真实运行的前端里找出稳定的 `data-*` / `role` / `aria-*`
 * 属性。而维护者没有图形环境、也没有运行中的 dsh，无法自行勘察。
 *
 * ─────────────────────────────────────────────────────────────
 * 用法（约 2 分钟）
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 打开客户端，连上一台 dsh，进入一个会话。
 *
 * 2. 在客户端窗口里按 `Ctrl+Shift+I` 打开 DevTools，切到 **Console** 标签。
 *
 * 3. 把本文件**全部内容**粘贴进去，回车。
 *    看到 `[DSH DOM 探针] 已启动` 即成功。
 *
 * 4. **推荐用两段式采集**（结果最干净）：
 *
 *    a) 在 Console 里运行：  __dshDomProbe.start()
 *       —— 记录"此刻界面已有什么"作为基线
 *
 *    b) 回到 dsh 界面，**触发一次需要审批的操作**
 *       （例如让它执行一条 shell 命令），等审批卡片出现
 *
 *    c) 立刻回到 Console 运行：  __dshDomProbe.diff()
 *       —— 它会自动把"基线之后新增的元素签名"复制到剪贴板
 *
 *    d) 把剪贴板内容发给我
 *
 * 5. 如果第 4 步采集到的东西太少（说明审批卡片没有新增独立元素），
 *    再用全量模式兜底：运行 `__dshDomProbe.copy()`，把结果发我。
 *
 *    （全量模式结果会多很多，但信息更全，我可以从中筛。）
 *
 * ─────────────────────────────────────────────────────────────
 * 说明
 * ─────────────────────────────────────────────────────────────
 *
 * - 脚本**只读** DOM，不修改页面、不发送任何网络请求。
 * - 刻意**跳过 class 属性**（哈希化的，不可靠），只采集 `data-*` / `role` /
 *   `aria-*` / `id`。
 * - 每个签名会带上出现次数与一小段文本（最多 60 字符），便于我判断它是什么。
 * - 如果觉得采集到的东西里含敏感内容（比如代码片段），可以先自行删掉再发我。
 */

(() => {
  if (globalThis.__dshDomProbe) {
    console.warn('[DSH DOM 探针] 已在运行。如需重启，先刷新页面。')
    return
  }

  /** 采集到的签名 → 记录。 */
  const hits = new Map()
  /** 两段式采集的基线快照。 */
  let baseline = null
  /** 是否已停止。 */
  let stopped = false

  /**
   * 取出一个元素的「稳定属性」。
   *
   * 只保留跨版本不太可能变化的属性：`data-*` / `role` / `aria-*` / `id`。
   * **刻意排除 class** —— dsh 的类名是构建期哈希化的。
   *
   * @param el - 目标元素。
   * @returns 属性名到值的映射；没有稳定属性时返回空对象。
   */
  function stableAttrs(el) {
    const out = {}
    for (const attr of el.attributes || []) {
      const n = attr.name
      if (n === 'role' || n === 'id' || n.startsWith('data-') || n.startsWith('aria-')) {
        out[n] = attr.value
      }
    }
    return out
  }

  /**
   * 计算一个元素签名的字符串形式（标签 + 稳定属性）。
   *
   * @param el - 目标元素。
   * @returns 签名字符串；该元素没有稳定属性时返回 null。
   */
  function signatureOf(el) {
    const attrs = stableAttrs(el)
    if (Object.keys(attrs).length === 0) return null
    return `${el.tagName}|${JSON.stringify(attrs)}`
  }

  /**
   * 记录一个元素（去重，累计出现次数）。
   *
   * @param el - 目标元素。
   * @param how - 来源标记（existing / added）。
   */
  function record(el, how) {
    if (el.nodeType !== 1) return
    const sig = signatureOf(el)
    if (sig === null) return
    const prev = hits.get(sig)
    if (prev !== undefined) {
      prev.count += 1
      return
    }
    hits.set(sig, {
      tag: el.tagName,
      attrs: stableAttrs(el),
      how,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      count: 1,
    })
  }

  /**
   * 递归扫描一棵子树。
   *
   * @param root - 根节点。
   * @param how - 来源标记。
   */
  function scan(root, how) {
    if (root.nodeType === 1) record(root, how)
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('*').forEach(child => record(child, how))
    }
  }

  /** 开始观察 DOM 变化。 */
  const observer = new MutationObserver(mutations => {
    if (stopped) return
    for (const m of mutations) {
      for (const node of m.addedNodes) scan(node, 'added')
    }
  })
  observer.observe(document.body, { subtree: true, childList: true })

  // 先扫一遍当前已渲染的内容。
  scan(document.body, 'existing')

  /**
   * 导出当前全部签名。
   *
   * @returns 按出现次数降序排列的签名数组。
   */
  function allSignatures() {
    return [...hits.values()].sort((a, b) => b.count - a.count)
  }

  globalThis.__dshDomProbe = {
    /** 显示当前采集到的签名（Console 里以表格呈现）。 */
    dump() {
      const arr = allSignatures()
      console.log(`[DSH DOM 探针] 已采集 ${arr.length} 种签名`)
      console.table(arr.slice(0, 80))
      return arr
    },

    /** 记录基线。之后用 diff() 只看新增。 */
    start() {
      baseline = new Set(hits.keys())
      console.log(`[DSH DOM 探针] 基线已记录（当前 ${baseline.size} 种签名）`)
      console.log('→ 现在去 dsh 界面触发一次审批，然后回来运行 __dshDomProbe.diff()')
    },

    /** 导出「基线之后新增」的签名并复制到剪贴板。 */
    diff() {
      if (baseline === null) {
        console.warn('[DSH DOM 探针] 还没记录基线，请先运行 __dshDomProbe.start()')
        return
      }
      const added = allSignatures().filter(item => !baseline.has(`${item.tag}|${JSON.stringify(item.attrs)}`))
      const json = JSON.stringify(added, null, 1)
      console.log(`[DSH DOM 探针] 新增 ${added.length} 种签名`)
      console.table(added.slice(0, 80))
      if (added.length === 0) {
        console.warn('没有新增签名 —— 审批卡片可能复用了已有元素。请改用 __dshDomProbe.copy() 全量导出。')
        return
      }
      copy(json)
      console.log(`已复制到剪贴板（${json.length} 字符）。请把它发给维护者。`)
    },

    /** 全量导出并复制到剪贴板（兜底模式）。 */
    copy() {
      const arr = allSignatures()
      const json = JSON.stringify(arr, null, 1)
      copy(json)
      console.log(`[DSH DOM 探针] 已复制 ${arr.length} 种签名（${json.length} 字符）到剪贴板`)
      if (json.length > 200000) {
        console.warn('内容较大，也许改用两段式 start()/diff() 更干净。')
      }
    },

    /** 停止采集。 */
    stop() {
      stopped = true
      observer.disconnect()
      console.log('[DSH DOM 探针] 已停止采集')
    },

    /** 清空已采集内容（重新开始）。 */
    reset() {
      hits.clear()
      baseline = null
      console.log('[DSH DOM 探针] 已清空')
    },
  }

  console.log('%c[DSH DOM 探针] 已启动', 'color:#4c8bf5;font-weight:bold;font-size:14px')
  console.log('推荐流程：')
  console.log('  1. 运行  __dshDomProbe.start()        ← 记录基线')
  console.log('  2. 去 dsh 界面触发一次「需要审批」的操作（如让它执行命令）')
  console.log('  3. 运行  __dshDomProbe.diff()         ← 自动复制新增签名到剪贴板')
  console.log('  4. 把剪贴板内容发给维护者')
  console.log('若第 3 步显示"没有新增签名"，改用  __dshDomProbe.copy()  全量导出。')
})()
