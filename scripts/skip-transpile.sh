#!/usr/bin/env bash
# Skip 转译管线：Swift 源码（本仓库唯一事实源）→ Kotlin → Android 工程
#
# 编译自洽模型：
#   * clock/RuntimeLedger.kt 是【生成物】，不进版本库（.gitignore）——
#     fresh clone 后在工具链环境跑本脚本即可再生，Gradle 随后可编译
#   * clock/RuntimeLedgerStore.kt 是宿主侧持久化（Android 原生代码），随仓库分发
#   * 需要：macOS/Linux + Swift 5.9+ + skip CLI（brew install skiptools/skip/skip）
set -euo pipefail
cd "$(dirname "$0")/../swift/PetRuntimeClock"

# 1. 测试先行（保证账本逻辑正确再转译）
swift test

# 2. 转译 Swift -> Kotlin（输出到 ./kotlin/）
rm -rf kotlin
skip transpile

# 3. 拷入 Android 工程并统一包名（app 内以 blue.fat.fish.clock 包引用）
DEST=../../app/src/main/java/blue/fat/fish/clock
mkdir -p "$DEST"
find kotlin -name '*.kt' | while read -r f; do
  sed -E 's/^package [A-Za-z0-9_.]+/package blue.fat.fish.clock/' "$f" > "$DEST/$(basename "$f")"
  echo "  -> $DEST/$(basename "$f")"
done

echo "== 完成：clock/RuntimeLedger.kt 为生成物，勿提交（已 gitignore）=="
