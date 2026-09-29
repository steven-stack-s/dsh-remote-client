import { describe, expect, it } from 'vitest'
import { APPROVAL_SELECTOR, MESSAGE_SELECTOR, notifyRules } from '../src/preload/selectors.js'

/**
 * 选择器「未勘察（null）→ 完全静默」这条契约的守卫。
 *
 * 背景：真实选择器必须由维护者在用户真机上勘察后填入（见该文件注释与
 * `docs/dom-勘察脚本.js`）。在填之前，通知功能应当**只是不触发**：
 * `notifyRules()` 返回空数组 → `host.ts` 连 MutationObserver 都不创建。
 *
 * 这些断言**不依赖两个常量当时填没填**：`null` 分支用显式传参覆盖，
 * 因此维护者填入真实选择器后不会把测试改红，而契约本身被永久守住。
 */
describe('notifyRules', () => {
  it('两个选择器都为 null（未勘察）→ 没有任何规则', () => {
    expect(notifyRules(null, null)).toEqual([])
  })

  it('空白选择器同样视为未勘察（不能拿给 querySelector，会抛 SyntaxError）', () => {
    expect(notifyRules('   ', '')).toEqual([])
    expect(notifyRules('\t\n', '  ')).toEqual([])
  })

  it('只有审批选择器可用时，只产出一条 urgent 规则', () => {
    expect(notifyRules('[data-approval]', null)).toEqual([
      { selector: '[data-approval]', urgent: true },
    ])
  })

  it('只有消息选择器可用时，只产出一条非 urgent 规则', () => {
    expect(notifyRules(null, '[data-message]')).toEqual([
      { selector: '[data-message]', urgent: false },
    ])
  })

  it('审批规则排在消息规则之前（同一处 DOM 变化时的优先级）', () => {
    const rules = notifyRules('[data-approval]', '[data-message]')
    expect(rules.map(rule => rule.urgent)).toEqual([true, false])
  })

  it('原样保留选择器字符串（不做 trim，避免改变用户勘察到的语义）', () => {
    // 前后空白的合法选择器（如 '[data-x] ' ）不进 isUsableSelector 的空白分支，
    // 但也不应被悄悄改写——改写了就不再是勘察到的那条选择器了。
    expect(notifyRules('[data-x] ', null)).toEqual([{ selector: '[data-x] ', urgent: true }])
  })

  it('默认参数取当前常量：结果可安全迭代，且不含空白选择器', () => {
    const rules = notifyRules()
    expect(Array.isArray(rules)).toBe(true)
    for (const rule of rules) {
      expect(typeof rule.selector).toBe('string')
      expect(rule.selector.trim()).not.toBe('')
      expect(typeof rule.urgent).toBe('boolean')
    }
    // 当前（未勘察）状态下应当为空——一旦维护者填入选择器，这条自动不再成立，
    // 因此这里只断言「不为空的都合法」，不断言长度。
  })

  it('两个常量只能是 null 或非空白字符串（不许留空白占位）', () => {
    for (const selector of [APPROVAL_SELECTOR, MESSAGE_SELECTOR]) {
      const valid = selector === null || (typeof selector === 'string' && selector.trim() !== '')
      expect(valid, `非法的选择器占位：${JSON.stringify(selector)}`).toBe(true)
    }
  })
})
