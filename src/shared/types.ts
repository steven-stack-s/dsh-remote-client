/** 一个已配置的远端 dsh 主机。 */
export interface HostEntry {
  /** 恒等于 hostIdFromOrigin(origin)。 */
  id: string
  /** 规范化后的 origin，如 "http://nas:3080"。**永不包含 token 或 query**。 */
  origin: string
  /**
   * dsh web 的 launch token（未装认证插件的部署需要）。
   *
   * 与 origin 分开存，因为 `URL.origin` 属性**不含 query**，混在一起会被
   * 静默丢弃——而丢 token 就等于无法接入。同时 origin 必须保持纯净：
   * 它还是 cookie authority 的输入。
   */
  launchToken?: string
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
