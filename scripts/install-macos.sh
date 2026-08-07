#!/bin/bash
# install-macos.sh — Kimi Switch macOS 一键安装辅助脚本
#
# 背景：macOS 包未做 Developer ID 签名（无开发者账号），从网络下载后会被
# Gatekeeper 的「下载隔离（quarantine）」属性拦截。本脚本清除该属性后启动应用。
#
# 用法（把 Kimi Switch.app 拖入「应用程序」文件夹后执行）：
#   bash install-macos.sh
#
# 若脚本提示找不到应用，请先手动把 Kimi Switch.app 拖到 /Applications 再运行。

set -e

APP_NAME="Kimi Switch"
APP_PATH="/Applications/${APP_NAME}.app"
DOWNLOADED_DMG_NAME="KimiSwitch.dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 未找到 ${APP_PATH}"
  echo ""
  echo "请先把「${APP_NAME}.app」拖到「应用程序」文件夹，再重新运行本脚本："
  echo "  1. 双击下载的 ${DOWNLOADED_DMG_NAME}（磁盘映像会自动挂载）"
  echo "  2. 把其中的 Kimi Switch.app 拖入「应用程序」文件夹"
  echo "  3. 回到终端重新运行：bash install-macos.sh"
  exit 1
fi

echo "① 清除「下载隔离」属性（Gatekeeper 拦截的来源）..."
xattr -cr "$APP_PATH" 2>/dev/null || true
echo "   完成"

echo "② 验证代码签名状态："
if codesign -dv "$APP_PATH" 2>&1 | grep -q "Signature=adhoc"; then
  echo "   Signature=adhoc（正常，ad-hoc 签名，右键打开即可运行）"
else
  echo "   （未检测到签名信息，属正常，不影响本脚本的运行方式）"
fi

echo "③ 正在启动「${APP_NAME}」..."
open "$APP_PATH"
echo ""
echo "✅ 启动完成。"
echo ""
echo "如果仍提示「无法验证开发者」，请按下面任一种方式再试："
echo "  a) 右键 ${APP_NAME}.app → 打开 → 在弹出的提示中点「打开」"
echo "  b) 系统设置 → 隐私与安全性 → 滚动到「安全性」→ 点「仍要打开」"
echo ""
echo "首次启动后应用即可正常使用，之后无需重复本操作。"
