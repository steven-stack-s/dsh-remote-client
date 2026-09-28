#!/usr/bin/env bash
#
# 在 Linux 上构建 Windows 安装包（setup.exe）。
#
# 最终用户拿到的 setup.exe 自带完整 Electron 运行时，
# **不需要安装 Node、pnpm 或任何运行环境**。
#
# 本脚本固化了实际踩过的四个坑（2026-09-28 实测通过）：
#
#   1. Node 必须 ≥ 22.12（推荐 24）
#      electron-builder 26 的 blockmap 模块用 require() 加载 ESM 的 @noble/hashes。
#      Node 22.11 会报 ERR_REQUIRE_ESM 而失败；require(ESM) 从 22.12 起才默认支持。
#
#   2. Linux 上构建 Windows NSIS 安装包必须有 wine
#      否则在「signing with signtool.exe path=.../elevate.exe」之后
#      报 `wine process failed ENOENT`，最终只留下一个 161KB 的半成品 setup.exe。
#      Ubuntu: apt-get install -y wine64 wine
#
#   3. 二进制工具走国内镜像
#      electron-builder 要从 GitHub releases 下载 winCodeSign / nsis / 7zip，
#      国内直连会 ETIMEDOUT（实测 10 分钟超时）。镜像必须是：
#        https://registry.npmmirror.com/-/binary/electron-builder-binaries/
#      注意不是 npmmirror.com/mirrors/... （那条路径会超时）。
#
#   4. pnpm 首次安装后 rolldown 等平台绑定可能缺失
#      表现为 `Cannot find module @rolldown/binding-linux-x64-gnu`。
#      用 `pnpm install --force` 重装可解决。
#
# 用法：
#   ./scripts/build-windows.sh            # 在项目根执行
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▶ 环境检查"
NODE_MAJOR=$(node -p 'process.versions.node.split(".").slice(0,2).join(".")')
echo "  Node: $(node -v)  pnpm: $(pnpm -v)"
node -e '
const [maj, min] = process.versions.node.split(".").map(Number)
if (maj < 22 || (maj === 22 && min < 12)) {
  console.error("  ✗ Node 必须 ≥ 22.12（推荐 24）：electron-builder 需要 require(ESM) 支持")
  process.exit(1)
}
'
if ! command -v wine >/dev/null 2>&1; then
  echo "  ✗ 未找到 wine。Linux 上构建 Windows 安装包必需。"
  echo "    Ubuntu/Debian: sudo apt-get install -y wine64 wine"
  echo "    （仅当宿主就是 Windows 时才可跳过）"
  exit 1
fi
echo "  wine: $(wine --version 2>/dev/null | head -1)"

echo "▶ 配置镜像（写入 .npmrc，仅本机构建用）"
cat > .npmrc <<'NPMRC'
# 仅用于本机构建。含环境相关内容，已在 .gitignore 中忽略。
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
electron_builder_binaries_mirror=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
NPMRC

echo "▶ 安装依赖"
pnpm install --force

echo "▶ 测试与类型检查"
pnpm test
pnpm typecheck

echo "▶ 构建 Windows 安装包"
pnpm dist:win

echo
echo "✅ 完成。产物："
ls -lh release/*.exe
echo
echo "校验值："
sha256sum release/*.exe
echo
echo "提示：安装包未做代码签名，最终用户首次运行会遇到 SmartScreen"
echo "      「未知发布者」提示，点「更多信息」→「仍要运行」即可。"
echo "      若需消除，请配置证书（electron-builder 的 certificateFile）。"
