#!/usr/bin/env node
/**
 * 生成应用图标与托盘图标（DeepSeek 鲸鱼标志）。
 *
 * 素材：`build/deepseek-whale.svg` —— 取自 dsh 官方前端 dist 的 `favicon.svg`，
 * 是单条 `<path>` 的纯矢量图（无字体依赖、透明底、主色 `fill="#000"`），
 * 因此只需替换 `fill` 就能产出不同颜色的版本。
 *
 * 产出：
 *   1. `build/icon.png` —— 256×256，**黑色**鲸鱼 + 透明底。
 *      electron-builder 据此生成 Windows 的 .ico（要求至少 256×256）。
 *
 *   2. `src/main/tray-icons.ts` —— 托盘图标的 base64 常量，共 6 份：
 *      16/32 像素 × 黑/白/灰。
 *
 *      **为什么托盘要做黑/白两色**：Windows 任务栏默认深色，黑色鲸鱼会几乎
 *      看不见。托盘图标随系统主题选色（深色主题用白、浅色主题用黑），
 *      这与 macOS 的 template image 是同一思路。灰色用于「离线」状态。
 *
 * 用法：
 *   pnpm icons        # 见 package.json 的 scripts
 *
 * 本脚本是幂等的：随时重跑都会覆盖产出，不会累积。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const SVG_PATH = join(root, 'build', 'deepseek-whale.svg')
const svgSource = readFileSync(SVG_PATH, 'utf8')

if (!svgSource.includes('fill="#000"')) {
  // 素材被换掉时尽早失败，避免生成一堆颜色不对的图标还浑然不觉。
  throw new Error(`${SVG_PATH} 里找不到 fill="#000"，无法确定主色。请检查素材。`)
}

/**
 * 把素材主色替换为指定颜色。
 *
 * @param fill - CSS 颜色值（如 `#000`）。
 * @returns 替换后的 SVG 文本。
 */
function recolor(fill) {
  return svgSource.replaceAll('fill="#000"', `fill="${fill}"`)
}

/**
 * 渲染 SVG 为 PNG 字节。
 *
 * @param svg - SVG 文本。
 * @param size - 目标边长（像素，正方形）。
 * @returns PNG 字节。
 */
function render(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    // 不设 background —— 保持透明底。
  })
  return resvg.render().asPng()
}

/** 托盘图标的配色方案。 */
const TRAY_VARIANTS = [
  { key: 'LIGHT', fill: '#000', desc: '浅色主题下使用（深色线条在浅背景上清晰）' },
  { key: 'DARK', fill: '#fff', desc: '深色主题下使用（浅色线条在深背景上清晰）' },
  { key: 'OFFLINE', fill: '#8b949e', desc: '离线重试中' },
]

/** 托盘图标尺寸：Windows 在 100% 缩放下取 16，高 DPI 下取 32。 */
const TRAY_SIZES = [16, 32]

// ── 1) 应用图标 ────────────────────────────────────────────────────────────
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), render(recolor('#000'), 256))
console.log('✓ build/icon.png  （256×256，黑色，透明底）')

// ── 2) 托盘图标 ────────────────────────────────────────────────────────────
const constants = []
for (const variant of TRAY_VARIANTS) {
  const svg = recolor(variant.fill)
  for (const size of TRAY_SIZES) {
    const png = render(svg, size)
    constants.push({
      name: `TRAY_ICON_${variant.key}_${String(size)}`,
      desc: `${variant.desc}（${size}×${size}）`,
      data: png.toString('base64'),
    })
  }
}

const lines = [
  '// 本文件由 scripts/generate-icons.mjs 生成 —— 请勿手工编辑。',
  '// 重新生成：pnpm icons',
  '//',
  '// 素材为 DeepSeek 鲸鱼标志（build/deepseek-whale.svg），透明底。',
  '// 托盘同时提供浅色/深色两套，是因为 Windows 任务栏默认深色，',
  '// 黑色图标会几乎看不见；随系统主题选色与 macOS 的 template image 同理。',
  '',
]

for (const item of constants) {
  lines.push(`/** ${item.desc} */`)
  lines.push(`export const ${item.name} =`)
  lines.push(`  'data:image/png;base64,${item.data}'`)
  lines.push('')
}

writeFileSync(join(root, 'src', 'main', 'tray-icons.ts'), lines.join('\n'))
console.log(`✓ src/main/tray-icons.ts  （${String(constants.length)} 份托盘图标）`)
for (const item of constants) {
  console.log(`    ${item.name}`)
}
