/** 一个已配置的远端 dsh 主机。 */
export interface HostEntry {
  /** 恒等于 hostIdFromOrigin(origin)。 */
  id: string
  /** 规范化后的 origin，如 "http://nas:3080"。 */
  origin: string
  /** 用户可读名。 */
  label: string
  addedAt: number
  lastUsedAt: number
}

/** hosts.json 的完整结构。 */
export interface HostsFile {
  version: 1
  hosts: HostEntry[]
  lastHostId?: string
}
