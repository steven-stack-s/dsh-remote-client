#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 抽出某个版本的「面向用户」小节，用作 GitHub Release 正文。
 *
 * 用法：
 *   node scripts/extract-highlights.mjs 0.2.5              # 打印该版 Highlights
 *   node scripts/extract-highlights.mjs v0.2.5             # 前缀 v 也接受
 *   node scripts/extract-highlights.mjs 0.2.5 --out FILE   # 写入文件（workflow 用）
 *
 * 设计约定（与 CHANGELOG.md 头部那段说明配套）：
 *   - 只认 `### Highlights` 小节。仓库里其余小节（Fixed / Notes 等）是**面向开发者**的
 *     ——含根因、函数名、测试数、CI 过程，不适合出现在安装包下载页上。
 *   - 找不到 Highlights 时**回退为通用文案，并且不失败**（退出码 0）。
 *     理由：文档缺失不该让一次已构建好的发版就此中断；但会在 stderr 明确报警，
 *     让「这版没写 Highlights」在构建日志里一眼可见。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHANGELOG = join(HERE, '..', 'CHANGELOG.md')

/** 回退文案：无法定位到版本小节时使用。刻意不含任何版本特有信息。 */
const FALLBACK = [
  '本版本的具体改动请见仓库中的 [更新日志](CHANGELOG.md)。',
  '',
  '下载 `DSH.Remote.Client-*-setup.exe` 双击安装即可，**不需要安装 Node、pnpm 或任何运行环境**。',
].join('\n')

/**
 * 从 changelog 文本中抽出指定版本的 Highlights 小节。
 * @param {string} text  CHANGELOG.md 全文
 * @param {string} version 形如 `0.2.5`（不含 v）
 * @returns {{ body: string|null, reason: string }} body 为 null 表示没找到
 */
export function extractHighlights(text, version) {
  const lines = text.split(/\r?\n/)

  // 定位 `## [0.2.5]` 这一节。转义版本号里的点，避免 0.2.5 被当成正则通配。
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const versionRe = new RegExp(`^##\\s+\\[?${escaped}\\]?(\\s|$)`)
  const start = lines.findIndex((l) => versionRe.test(l))
  if (start === -1) return { body: null, reason: `CHANGELOG 里没有 ${version} 这一节` }

  // 该版本节的结束 = 下一个同级或更高级标题（`## `）。只看 ## 即可，### 是节内子标题。
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break }
  }

  // 在节内找 `### Highlights`，到下一个 `### ` 或节尾为止。
  const rel = lines.slice(start + 1, end)
  const h = rel.findIndex((l) => /^###\s+Highlights\s*$/i.test(l))
  if (h === -1) return { body: null, reason: `${version} 这一节里没有 ### Highlights` }

  const out = []
  for (let i = h + 1; i < rel.length; i++) {
    if (/^###\s/.test(rel[i])) break
    out.push(rel[i])
  }
  const body = out.join('\n').trim()
  return body ? { body, reason: 'ok' } : { body: null, reason: `${version} 的 ### Highlights 是空的` }
}

function main() {
  const argv = process.argv.slice(2)
  const version = (argv[0] || '').replace(/^v/, '')
  const outIdx = argv.indexOf('--out')
  const outFile = outIdx === -1 ? null : argv[outIdx + 1]

  if (!version) {
    console.error('用法: node scripts/extract-highlights.mjs <版本> [--out 文件]')
    process.exit(2) // 用法错误才非零退出：这是调用方写错了，应当暴露
  }

  let body = FALLBACK
  let reason = 'no-changelog'
  try {
    const res = extractHighlights(readFileSync(CHANGELOG, 'utf8'), version)
    if (res.body) { body = res.body; reason = 'ok' }
    else reason = res.reason
  } catch (e) {
    reason = `读取 CHANGELOG 失败: ${e.message}`
  }

  if (reason !== 'ok') {
    // 报警但不失败：见文件头「设计约定」。
    console.error(`::warning::未能取到 ${version} 的面向用户改动说明（${reason}），已回退为通用文案。`)
  }

  if (outFile) {
    writeFileSync(outFile, body + '\n')
    console.error(`已写入 ${outFile}（来源: ${reason}）`)
  } else {
    process.stdout.write(body + '\n')
  }
}

// 仅在被直接执行时跑 main，便于测试里 import 该函数。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
