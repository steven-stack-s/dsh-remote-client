import { hostIdFromOrigin } from './partitions.js'
import { normalizeOrigin } from '../shared/origin.js'
import type { HostEntry, HostsFile } from '../shared/types.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** 空的配置结构。 */
export function emptyHosts(): HostsFile {
  return { version: 1, hosts: [] }
}

/**
 * 由 origin 派生默认显示名（去掉协议前缀）。
 *
 * @param origin - 规范化后的 origin。
 * @returns 默认 label。
 */
export function defaultLabelFor(origin: string): string {
  return origin.replace(/^https?:\/\//u, '')
}

/**
 * 新增或更新一台主机。已存在同一 origin 时只更新 label、launchToken 与
 * lastUsedAt，绝不产生第二条记录——cookie 与 partition 都按 origin 唯一。
 *
 * @param data - 当前配置。
 * @param rawOrigin - 用户填写的地址，内部会规范化。
 * @param label - 可选显示名，缺省用 {@link defaultLabelFor}。
 * @param launchToken - 可选的 dsh launch token；传入即更新（dsh 重启后 token 会变，
 *   重新添加同一主机是更新令牌的主要途径）。
 * @returns 新的配置对象。
 */
export function addHost(
  data: HostsFile,
  rawOrigin: string,
  label?: string,
  launchToken?: string,
): HostsFile {
  const origin = normalizeOrigin(rawOrigin)
  const id = hostIdFromOrigin(origin)
  const now = Date.now()
  const existing = data.hosts.find(h => h.id === id)

  if (existing !== undefined) {
    const updated: HostEntry = {
      ...existing,
      ...(label !== undefined && { label }),
      // 仅在显式传入时覆盖；不传则保留旧 token（用户可能只是重命名或切换）。
      ...(launchToken !== undefined && { launchToken }),
      lastUsedAt: now,
    }
    return {
      ...data,
      hosts: data.hosts.map(h => (h.id === id ? updated : h)),
      lastHostId: id,
    }
  }

  const entry: HostEntry = {
    id,
    origin,
    ...(launchToken !== undefined && { launchToken }),
    label: label ?? defaultLabelFor(origin),
    addedAt: now,
    lastUsedAt: now,
  }
  return { ...data, hosts: [...data.hosts, entry], lastHostId: id }
}

/**
 * 删除一台主机。若被删除者是 lastHostId，则清空该字段。
 *
 * @param data - 当前配置。
 * @param id - 目标主机 id。
 * @returns 新的配置对象。
 */
export function removeHost(data: HostsFile, id: string): HostsFile {
  const hosts = data.hosts.filter(h => h.id !== id)
  if (hosts.length === data.hosts.length) return data
  return {
    ...data,
    hosts,
    lastHostId: data.lastHostId === id ? undefined : data.lastHostId,
  }
}

/**
 * 重命名一台主机。
 *
 * @param data - 当前配置。
 * @param id - 目标主机 id。
 * @param label - 新显示名。
 * @returns 新的配置对象。
 */
export function renameHost(data: HostsFile, id: string, label: string): HostsFile {
  if (!data.hosts.some(h => h.id === id)) return data
  return { ...data, hosts: data.hosts.map(h => (h.id === id ? { ...h, label } : h)) }
}

/**
 * 标记一台主机为最近使用，并把它设为启动目标。
 *
 * @param data - 当前配置。
 * @param id - 目标主机 id。
 * @returns 新的配置对象。
 */
export function touchHost(data: HostsFile, id: string): HostsFile {
  if (!data.hosts.some(h => h.id === id)) return data
  const now = Date.now()
  return {
    ...data,
    hosts: data.hosts.map(h => (h.id === id ? { ...h, lastUsedAt: now } : h)),
    lastHostId: id,
  }
}

/**
 * 决定启动时打开哪台主机：优先 lastHostId，失效则回退到最近使用的一台。
 *
 * @param data - 当前配置。
 * @returns 目标主机，无可用主机时返回 undefined。
 */
export function resolveStartupHost(data: HostsFile): HostEntry | undefined {
  if (data.hosts.length === 0) return undefined
  const preferred = data.hosts.find(h => h.id === data.lastHostId)
  if (preferred !== undefined) return preferred
  return [...data.hosts].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
}

/** 配置文件名。 */
const HOSTS_FILE = 'hosts.json'

/**
 * 某数据目录下的配置文件路径。
 *
 * @param dir - 数据目录（运行时为 app.getPath('userData')，测试时为临时目录）。
 * @returns 配置文件绝对路径。
 */
export function hostsFilePath(dir: string): string {
  return join(dir, HOSTS_FILE)
}

/**
 * 校验解析后的值形如 HostsFile。
 *
 * @param value - JSON.parse 的结果。
 * @returns 合法时返回 true。
 */
function isHostsFile(value: unknown): value is HostsFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1) return false
  if (!Array.isArray(candidate.hosts)) return false
  return candidate.hosts.every(entry => {
    if (typeof entry !== 'object' || entry === null) return false
    const host = entry as Record<string, unknown>
    return typeof host.id === 'string'
      && typeof host.origin === 'string'
      && typeof host.label === 'string'
      && typeof host.addedAt === 'number'
      && typeof host.lastUsedAt === 'number'
  })
}

/**
 * 解析配置文本，损坏时备份原文件。
 *
 * 异步与同步两个入口共用本函数，保证两者的备份与回退语义永不漂移。
 *
 * @param raw - 文件内容。
 * @param path - 文件路径，用于备份。
 * @param backup - 备份实现，注入以使异步/同步各自使用对应 API。
 * @returns 解析结果，损坏时为空配置。
 */
function parseHosts(raw: string, path: string, backup: (from: string, to: string) => void): HostsFile {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isHostsFile(parsed)) throw new Error('结构不合法')
    return parsed
  } catch {
    try {
      backup(path, `${path}.corrupt-${String(Date.now())}`)
    } catch {
      // 备份失败不应吞掉可用性：仍返回空配置，让用户能继续操作。
    }
    return emptyHosts()
  }
}

/**
 * 读取配置。文件缺失或目录不存在都返回空配置；内容损坏时先把原文件
 * 改名为 `hosts.json.corrupt-<时间戳>` 留证，再返回空配置——静默丢弃
 * 用户的主机列表是不可接受的。
 *
 * @param dir - 数据目录。
 * @returns 配置对象。
 */
export async function loadHosts(dir: string): Promise<HostsFile> {
  const path = hostsFilePath(dir)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyHosts()
  }
  return parseHosts(raw, path, (from, to) => { void rename(from, to).catch(() => undefined) })
}

/**
 * {@link loadHosts} 的同步版本，供 `app.whenReady()` 之前调用——
 * Chromium 命令行开关只能在启动早期设置，那时无法 await。
 *
 * @param dir - 数据目录。
 * @returns 配置对象。
 */
export function loadHostsSync(dir: string): HostsFile {
  const path = hostsFilePath(dir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return emptyHosts()
  }
  return parseHosts(raw, path, (from, to) => { renameSync(from, to) })
}

/**
 * 写入配置，必要时创建目录。以换行结尾便于人工查看与版本控制。
 *
 * @param dir - 数据目录。
 * @param data - 要写入的配置。
 */
export async function saveHosts(dir: string, data: HostsFile): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(hostsFilePath(dir), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
