#!/usr/bin/env bash
set -euo pipefail

JSON_MODE=0
for arg in "$@"; do
  if [[ "$arg" == "--json" ]]; then
    JSON_MODE=1
  fi
done

# 1. 检查 CLI (transcribe / 1transcribe)
CLI_CMD=""
CLI_VERSION=""
CLI_IN_PATH=0

for cmd in transcribe 1transcribe; do
  if command -v "$cmd" >/dev/null 2>&1; then
    CLI_CMD="$cmd"
    CLI_IN_PATH=1
    CLI_VERSION="$("$cmd" --version 2>/dev/null || echo "")"
    break
  fi
done

# 2. 检查原生 ASR 推理二进制
BIN_NAME="transcribe-cli"
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
  BIN_NAME="transcribe-cli.exe"
fi

NATIVE_PATH=""
NATIVE_DETECTED=0

CANDIDATES=(
  "${TRANSCRIBE_BIN_PATH:-}"
  "$HOME/.local/bin/$BIN_NAME"
  "/usr/local/bin/$BIN_NAME"
  "/opt/homebrew/bin/$BIN_NAME"
  "$HOME/Documents/01-开发项目/mac_app/TranscribeKit/.build/arm64-apple-macosx/release/$BIN_NAME"
)

for p in "${CANDIDATES[@]}"; do
  if [[ -n "$p" && -f "$p" ]]; then
    NATIVE_PATH="$p"
    NATIVE_DETECTED=1
    break
  fi
done

# 3. 检查 SenseVoice 模型状态
MODEL_CACHE_DIR="${TRANSCRIBE_MODELS_DIR:-$HOME/.transcribe_models}"
MODEL_FILE_NAME="SenseVoiceSmall-Q8_0.gguf"
MODEL_FULL_PATH="$MODEL_CACHE_DIR/$MODEL_FILE_NAME"

MODEL_EXISTS=0
MODEL_SIZE_BYTES=0
MODEL_SIZE_MB="0"

if [[ -f "$MODEL_FULL_PATH" ]]; then
  MODEL_EXISTS=1
  if [[ "$OSTYPE" == "darwin"* ]]; then
    MODEL_SIZE_BYTES="$(stat -f%z "$MODEL_FULL_PATH" 2>/dev/null || stat -c%s "$MODEL_FULL_PATH" 2>/dev/null || echo 0)"
  else
    MODEL_SIZE_BYTES="$(stat -c%s "$MODEL_FULL_PATH" 2>/dev/null || stat -f%z "$MODEL_FULL_PATH" 2>/dev/null || echo 0)"
  fi
  MODEL_SIZE_MB="$(awk -v b="$MODEL_SIZE_BYTES" 'BEGIN { printf "%.2f", b / 1048576 }')"
fi

if [[ "$JSON_MODE" -eq 1 ]]; then
  cat << JSON_OUT
{
  "cli": {
    "command": $(if [[ -n "$CLI_CMD" ]]; then echo "\"$CLI_CMD\""; else echo "null"; fi),
    "version": $(if [[ -n "$CLI_VERSION" ]]; then echo "\"$CLI_VERSION\""; else echo "null"; fi),
    "inPath": $(if [[ "$CLI_IN_PATH" -eq 1 ]]; then echo "true"; else echo "false"; fi)
  },
  "nativeEngine": {
    "path": $(if [[ -n "$NATIVE_PATH" ]]; then echo "\"$NATIVE_PATH\""; else echo "null"; fi),
    "detected": $(if [[ "$NATIVE_DETECTED" -eq 1 ]]; then echo "true"; else echo "false"; fi)
  },
  "model": {
    "cacheDir": "$MODEL_CACHE_DIR",
    "fileName": "$MODEL_FILE_NAME",
    "exists": $(if [[ "$MODEL_EXISTS" -eq 1 ]]; then echo "true"; else echo "false"; fi),
    "sizeBytes": $MODEL_SIZE_BYTES,
    "sizeMB": "$MODEL_SIZE_MB"
  }
}
JSON_OUT
else
  echo "=== @1agents/transcribe 诊断报告 ==="
  echo "[CLI 状态]"
  if [[ "$CLI_IN_PATH" -eq 1 ]]; then
    echo "  - 存在于 PATH: ✅ 是 ($CLI_CMD)"
  else
    echo "  - 存在于 PATH: ❌ 否 (可通过 npm i -g @1agents/transcribe 安装)"
  fi
  if [[ -n "$CLI_VERSION" ]]; then
    echo "  - 当前版本: $CLI_VERSION"
  fi

  echo ""
  echo "[原生 ASR 引擎]"
  if [[ "$NATIVE_DETECTED" -eq 1 ]]; then
    echo "  - 状态: ✅ 已定位"
    echo "  - 引擎路径: $NATIVE_PATH"
  else
    echo "  - 状态: ⚠️ 未找到 (默认从 ~/.local/bin/transcribe-cli 查找)"
  fi

  echo ""
  echo "[SenseVoice 模型]"
  echo "  - 缓存目录: $MODEL_CACHE_DIR"
  echo "  - 模型文件: $MODEL_FILE_NAME"
  if [[ "$MODEL_EXISTS" -eq 1 ]]; then
    echo "  - 状态: ✅ 已就绪 (${MODEL_SIZE_MB} MB)"
  else
    echo "  - 状态: ⏳ 尚未下载 (首次运行 CLI 时将自动从 ModelScope 极速拉取)"
  fi
  echo "===================================="
fi
