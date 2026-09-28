import { createHash } from 'node:crypto'

/**
 * origin 的稳定短标识，同时用作 HostEntry.id 与 partition 名的一部分。
 *
 * 用摘要而非 origin 原文，是因为 partition 名会成为 Chromium 的磁盘目录名，
 * 不能含 `:` `/` 等字符。
 *
 * @param origin - 规范化后的 origin。
 * @returns 16 位小写十六进制。
 */
export function hostIdFromOrigin(origin: string): string {
  return createHash('sha256').update(origin).digest('hex').slice(0, 16)
}

/**
 * 某 origin 对应的 Electron partition 名。
 *
 * `persist:` 前缀是 Electron 的持久化约定，缺失则退化为内存态、
 * 重启即丢失登录态。
 *
 * @param origin - 规范化后的 origin。
 * @returns Electron partition 名。
 */
export function partitionNameFor(origin: string): string {
  return `persist:host-${hostIdFromOrigin(origin)}`
}
