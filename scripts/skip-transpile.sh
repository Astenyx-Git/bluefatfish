#!/usr/bin/env bash
# Skip 转译：需要 macOS/Linux + Swift 5.9+ 工具链 + skip CLI（brew install skiptools/skip）
# 产物（kotlin/ 下）拷入 Android 工程，覆盖 vendored 手工转译版（二者应逐行近似）。
set -euo pipefail
cd "$(dirname "$0")/../swift/PetRuntimeClock"

# 1. 测试先行（保证账本逻辑正确再转译）
swift test

# 2. 转译 Swift -> Kotlin
skip transpile

# 3. 拷入 Android 工程
DEST=../../app/src/main/java/blue/fat/fish/clock
mkdir -p "$DEST"
find kotlin -name '*.kt' -exec cp -v {} "$DEST/" \;

echo "== 完成：请核对 RuntimeLedger.kt 与 vendored 版本差异后提交 =="
