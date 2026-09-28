import { describe, expect, it } from 'vitest'
import { hostIdFromOrigin, partitionNameFor } from '../src/main/partitions.js'

describe('hostIdFromOrigin', () => {
  it('对同一 origin 稳定', () => {
    expect(hostIdFromOrigin('http://nas:3080')).toBe(hostIdFromOrigin('http://nas:3080'))
  })

  it('对不同 origin 相异', () => {
    expect(hostIdFromOrigin('http://nas:3080')).not.toBe(hostIdFromOrigin('http://nas:3081'))
  })

  it('输出 16 位小写十六进制', () => {
    expect(hostIdFromOrigin('http://nas:3080')).toMatch(/^[0-9a-f]{16}$/u)
  })
})

describe('partitionNameFor', () => {
  it('带 persist 前缀且与 id 同源', () => {
    const name = partitionNameFor('http://nas:3080')
    expect(name).toBe(`persist:host-${hostIdFromOrigin('http://nas:3080')}`)
  })
})
