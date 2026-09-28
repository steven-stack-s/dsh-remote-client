import { describe, expect, it } from 'vitest'
import { RETRY_MAX_MS, backoffDelay } from '../src/main/backoff.js'

describe('backoffDelay', () => {
  it('按 1s → 2s → 4s → 8s 指数增长', () => {
    expect(backoffDelay(0)).toBe(1000)
    expect(backoffDelay(1)).toBe(2000)
    expect(backoffDelay(2)).toBe(4000)
    expect(backoffDelay(3)).toBe(8000)
  })

  it('上限为 30s', () => {
    expect(backoffDelay(10)).toBe(RETRY_MAX_MS)
    expect(backoffDelay(100)).toBe(30_000)
  })

  it('恰在上限前仍按指数增长（16s 未被截断）', () => {
    expect(backoffDelay(4)).toBe(16_000)
  })

  it('序列单调不减', () => {
    const series = Array.from({ length: 20 }, (_v, i) => backoffDelay(i))
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]!).toBeGreaterThanOrEqual(series[i - 1]!)
    }
  })

  it('永不返回 0 或负数（避免忙等重试）', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(backoffDelay(i)).toBeGreaterThan(0)
    }
  })
})
