#!/usr/bin/env bash
# Create package-local .venv, install FunASR, vendor model symlinks into models/.
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${PACKAGE_ROOT}/.venv"
REQ="${PACKAGE_ROOT}/scripts/requirements-funasr.txt"
PY="${PYTHON:-python3}"

usage() {
  cat <<'EOF'
Usage: setup-funasr.sh [--link-venv PATH] [--skip-models] [--force-models]

  Default: create .venv under transcribe/ and pip-install FunASR
  --link-venv PATH     Symlink .venv → PATH (reuse an existing FunASR env)
  --skip-models        Do not run vendor-models.sh / download
  --force-models       FORCE=1 for vendor-models.sh
EOF
}

LINK_VENV=""
SKIP_MODELS=0
FORCE_MODELS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --link-venv|--link-funclip)
      LINK_VENV="${2:-}"
      shift 2
      ;;
    --skip-models)
      SKIP_MODELS=1
      shift
      ;;
    --force-models)
      FORCE_MODELS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "${LINK_VENV}" ]]; then
  src="${LINK_VENV}"
  if [[ -x "${src}/bin/python" ]]; then
    :
  elif [[ -x "${src}/.venv/bin/python" ]]; then
    src="${src}/.venv"
  else
    echo "Python venv not found: ${LINK_VENV}" >&2
    exit 1
  fi
  if [[ -e "${VENV}" || -L "${VENV}" ]]; then
    rm -rf "${VENV}"
  fi
  ln -s "${src}" "${VENV}"
  echo "LINK  .venv -> ${src}"
else
  if [[ ! -x "${VENV}/bin/python" ]]; then
    echo "Creating venv at ${VENV}"
    "${PY}" -m venv "${VENV}"
  fi
  if command -v uv >/dev/null 2>&1; then
    echo "Installing deps with uv..."
    uv pip install --python "${VENV}/bin/python" -r "${REQ}"
  else
    echo "Installing deps with pip..."
    "${VENV}/bin/python" -m ensurepip --upgrade 2>/dev/null || true
    "${VENV}/bin/python" -m pip install --upgrade pip
    "${VENV}/bin/python" -m pip install -r "${REQ}"
  fi
fi

echo "Python: $("${VENV}/bin/python" -c 'import sys; print(sys.executable)')"
"${VENV}/bin/python" -c "import funasr, torch; print('funasr', funasr.__version__, 'torch', torch.__version__)"

vendor() {
  if [[ "${FORCE_MODELS}" -eq 1 ]]; then
    FORCE=1 bash "${PACKAGE_ROOT}/scripts/vendor-models.sh"
  else
    bash "${PACKAGE_ROOT}/scripts/vendor-models.sh"
  fi
}

if [[ "${SKIP_MODELS}" -eq 0 ]]; then
  if ! vendor; then
    echo "ModelScope cache empty — downloading FunASR models..."
    echo "  bundle: https://modelscope.cn/models/scott887/speech"
    if [[ "${FORCE_MODELS}" -eq 1 ]]; then
      FORCE=1 "${VENV}/bin/python" "${PACKAGE_ROOT}/scripts/download-funasr-models.py"
    else
      "${VENV}/bin/python" "${PACKAGE_ROOT}/scripts/download-funasr-models.py"
    fi
    vendor || true
  fi
fi

cat <<EOF

Ready.
  export FUNASR_PYTHON="${VENV}/bin/python"
  transcribe interview.mp3 --engine funasr
  "${VENV}/bin/python" "${PACKAGE_ROOT}/scripts/asr.py" --help
EOF
