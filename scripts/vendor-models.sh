#!/usr/bin/env bash
# Create local FunASR model symlinks under <package>/models/.
# Preferred source: scott887/speech (four-model bundle).
# Fallback: official iic/damo ModelScope cache, then scott887/funasr-paraformer.
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${TRANSCRIBE_MODELS_DIR:-${PACKAGE_ROOT}/models}"
CACHE_ROOT="${MODELSCOPE_CACHE:-${HOME}/.cache/modelscope}"

# logical|bundle-subdir|official-cache-name
declare -a LINKS=(
  "seaco_paraformer|iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch|iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
  "fsmn_vad|damo--speech_fsmn_vad_zh-cn-16k-common-pytorch|damo--speech_fsmn_vad_zh-cn-16k-common-pytorch"
  "punc_ct|damo--punc_ct-transformer_zh-cn-common-vocab272727-pytorch|damo--punc_ct-transformer_zh-cn-common-vocab272727-pytorch"
  "campplus|damo--speech_campplus_sv_zh-cn_16k-common|damo--speech_campplus_sv_zh-cn_16k-common"
)

mkdir -p "${MODELS_DIR}"

is_model_dir() {
  local base="$1"
  [[ -f "${base}/configuration.json" || -f "${base}/config.yaml" ]]
}

resolve_one() {
  local cache_name="$1"
  [[ -n "${cache_name}" ]] || return 1
  local slash_name="${cache_name/--//}"
  local candidates=(
    "${CACHE_ROOT}/models/${cache_name}/snapshots/master"
    "${CACHE_ROOT}/models/${cache_name}"
    "${CACHE_ROOT}/hub/${slash_name}"
    "${CACHE_ROOT}/hub/models/${slash_name}"
    "${CACHE_ROOT}/models/${slash_name}"
    "${HOME}/.cache/modelscope/hub/${slash_name}"
    "${HOME}/.cache/modelscope/hub/models/${slash_name}"
  )
  local base latest
  for base in "${candidates[@]}"; do
    if [[ -d "${base}/snapshots/master" ]] && is_model_dir "${base}/snapshots/master"; then
      echo "${base}/snapshots/master"
      return 0
    fi
    if [[ -d "${base}/snapshots" ]]; then
      latest="$(ls -1t "${base}/snapshots" 2>/dev/null | head -1 || true)"
      if [[ -n "${latest}" && -d "${base}/snapshots/${latest}" ]] && is_model_dir "${base}/snapshots/${latest}"; then
        echo "${base}/snapshots/${latest}"
        return 0
      fi
    fi
    if is_model_dir "${base}"; then
      echo "${base}"
      return 0
    fi
  done
  return 1
}

resolve_nested() {
  local root="$1"
  local nested="$2"
  local cand
  for cand in \
    "${root}/${nested}/snapshots/master" \
    "${root}/${nested}"
  do
    if is_model_dir "${cand}"; then
      echo "${cand}"
      return 0
    fi
  done
  if [[ -d "${root}/${nested}/snapshots" ]]; then
    local latest
    latest="$(ls -1t "${root}/${nested}/snapshots" 2>/dev/null | head -1 || true)"
    if [[ -n "${latest}" ]] && is_model_dir "${root}/${nested}/snapshots/${latest}"; then
      echo "${root}/${nested}/snapshots/${latest}"
      return 0
    fi
  fi
  return 1
}

SPEECH_ROOT=""
if SPEECH_ROOT="$(resolve_one "scott887--speech")"; then
  :
else
  SPEECH_ROOT=""
fi
# resolve_one may return the snapshot/master of the bundle itself (tiny root config).
# Prefer the bundle root that contains nested iic-- / damo-- dirs.
if [[ -n "${SPEECH_ROOT}" ]]; then
  if [[ ! -d "${SPEECH_ROOT}/iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch" ]]; then
    parent="$(dirname "${SPEECH_ROOT}")"
    grand="$(dirname "${parent}")"
    for cand in "${SPEECH_ROOT}" "${parent}" "${grand}"; do
      if [[ -d "${cand}/iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch" ]]; then
        SPEECH_ROOT="${cand}"
        break
      fi
    done
  fi
fi

ok=0
fail=0
for entry in "${LINKS[@]}"; do
  IFS='|' read -r name nested official <<<"${entry}"
  dest="${MODELS_DIR}/${name}"
  if is_model_dir "${dest}"; then
    echo "SKIP  ${name} (already present)"
    ok=$((ok + 1))
    continue
  fi

  src=""
  if [[ -n "${SPEECH_ROOT}" ]]; then
    src="$(resolve_nested "${SPEECH_ROOT}" "${nested}" || true)"
  fi
  if [[ -z "${src}" ]]; then
    src="$(resolve_one "${official}" || true)"
  fi
  if [[ -z "${src}" && "${name}" == "seaco_paraformer" ]]; then
    src="$(resolve_one "scott887--funasr-paraformer" || true)"
  fi
  if [[ -z "${src}" ]]; then
    echo "MISSING: ${name}" >&2
    fail=$((fail + 1))
    continue
  fi

  if [[ -L "${dest}" ]]; then
    rm -f "${dest}"
  elif [[ -d "${dest}" ]]; then
    if [[ -z "$(ls -A "${dest}" 2>/dev/null | grep -v '^\.gitkeep$' || true)" ]]; then
      rmdir "${dest}" 2>/dev/null || true
    elif [[ "${FORCE:-}" != "1" ]]; then
      echo "SKIP (exists, not a symlink): ${dest}  set FORCE=1 to replace" >&2
      continue
    else
      rm -rf "${dest}"
    fi
  elif [[ -e "${dest}" ]]; then
    echo "SKIP (exists): ${dest}" >&2
    continue
  fi
  ln -s "${src}" "${dest}"
  echo "LINK  ${name} -> ${src}"
  ok=$((ok + 1))
done

echo "---"
echo "linked=${ok} missing=${fail} models_dir=${MODELS_DIR}"
if [[ "${fail}" -gt 0 ]]; then
  echo "Populate ModelScope cache first (one-time online):" >&2
  echo "  transcribe setup-funasr" >&2
  echo "  # bundle: https://modelscope.cn/models/scott887/speech" >&2
  exit 1
fi
