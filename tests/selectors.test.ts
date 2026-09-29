import { describe, expect, it } from 'vitest'
import {
  APPROVAL_SELECTOR,
  MESSAGE_ATTRIBUTE,
  MESSAGE_SELECTOR,
  notifyRules,
} from '../src/preload/selectors.js'

/**
 * 选择器模块的契约守卫。
 *
 * 两条规则都已从上游组件源码勘察确认并启用（审批已真机验证可用、消息在
 * task-19 补齐）。这些断言守的是**规则的形态**，而不是常量当时的值：
 *
 * - 未勘察（`null`）→ 完全静默：`notifyRules()` 返回空数组 → `host.ts` 连
 *   MutationObserver 都不创建（用显式传参覆盖，不依赖常量当时填没填）；
 * - 两条规则的**触发方式**各不相同，且审批那条的选择器/urgent 一字未变
 *   （回归守卫：审批通知已真机验证，改坏了会立刻表现成功能消失）。
 */
describe('notifyRules', () => {
  it('两个选择器都为 null（未勘察）→ 没有任何规则', () => {
    expect(notifyRules(null, null)).toEqual([])
  })

  it('空白选择器同样视为未勘察（不能拿给 querySelector，会抛 SyntaxError）', () => {
    expect(notifyRules('   ', '')).toEqual([])
    expect(notifyRules('\t\n', '  ')).toEqual([])
  })

  it('只有审批选择器可用时，只产出一条 appear 规则', () => {
    expect(notifyRules('[data-approval]', null)).toEqual([
      { trigger: 'appear', selector: '[data-approval]', urgent: true },
    ])
  })

  it('只有消息选择器可用时，只产出一条 attribute-removed 规则（带属性名）', () => {
    expect(notifyRules(null, '[data-message]', 'data-message')).toEqual([
      {
        trigger: 'attribute-removed',
        selector: '[data-message]',
        urgent: false,
        attribute: 'data-message',
      },
    ])
  })

  it('消息规则的属性名为空白 → 该规则不启用（否则 attributeFilter 里会出现空串）', () => {
    expect(notifyRules('[data-approval]', '[data-message]', '   ')).toEqual([
      { trigger: 'appear', selector: '[data-approval]', urgent: true },
    ])
  })

  it('审批规则排在消息规则之前（同一次 DOM 变化时的优先级）', () => {
    const rules = notifyRules('[data-approval]', '[data-message]', 'data-message')
    expect(rules.map(rule => rule.urgent)).toEqual([true, false])
    expect(rules.map(rule => rule.trigger)).toEqual(['appear', 'attribute-removed'])
  })

  it('原样保留选择器字符串（不做 trim，避免改变勘察到的语义）', () => {
    // 前后空白的合法选择器（如 '[data-x] '）不进 isUsableSelector 的空白分支，
    // 但也不应被悄悄改写——改写了就不再是勘察到的那条选择器了。
    expect(notifyRules('[data-x] ', null)).toEqual([
      { trigger: 'appear', selector: '[data-x] ', urgent: true },
    ])
  })

  it('默认参数取当前常量：两条规则的触发方式各自正确', () => {
    const rules = notifyRules()
    expect(rules.map(rule => rule.trigger)).toEqual(['appear', 'attribute-removed'])
    // 属性移除类规则必须带齐 selector/urgent/attribute，否则观察器无从观察。
    for (const rule of rules) {
      expect(typeof rule.selector).toBe('string')
      expect(rule.selector.trim()).not.toBe('')
      expect(typeof rule.urgent).toBe('boolean')
      if (rule.trigger === 'attribute-removed') {
        expect(rule.attribute.trim()).not.toBe('')
      }
    }
  })

  it('审批规则（已真机验证）的选择器与 urgent 保持不变', () => {
    // 回归守卫：审批通知是唯一已被用户确认工作的通知，这条规则一旦被改动风险最大。
    expect(APPROVAL_SELECTOR).toBe('[data-approval-key]:not([aria-busy="true"])')
    const approval = notifyRules().find(rule => rule.trigger === 'appear')
    expect(approval).toEqual({
      trigger: 'appear',
      selector: '[data-approval-key]:not([aria-busy="true"])',
      urgent: true,
    })
  })

  it('消息规则：选择器由属性名拼出，两者不可能漂移', () => {
    expect(MESSAGE_ATTRIBUTE).toBe('data-streaming')
    expect(MESSAGE_SELECTOR).toBe(`[${MESSAGE_ATTRIBUTE}]`)
    const message = notifyRules().find(rule => rule.trigger === 'attribute-removed')
    expect(message).toEqual({
      trigger: 'attribute-removed',
      selector: '[data-streaming]',
      urgent: false,
      attribute: 'data-streaming',
    })
  })

  it('两个常量只能是 null 或非空白字符串（不许留空白占位）', () => {
    for (const selector of [APPROVAL_SELECTOR, MESSAGE_SELECTOR]) {
      const valid = selector === null || (typeof selector === 'string' && selector.trim() !== '')
      expect(valid, `非法的选择器占位：${JSON.stringify(selector)}`).toBe(true)
    }
  })
})
