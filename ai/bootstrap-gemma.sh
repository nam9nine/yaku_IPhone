#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  printf '%s\n' 'This Gemma runtime requires Apple Silicon macOS.' >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' 'Install uv, then rerun this script.' >&2
  exit 1
fi
gemma_root="${KIRYU_GEMMA_ROOT:-$project_root/.tooling/gemma}"
export UV_CACHE_DIR="$gemma_root/uv-cache"
if [ ! -x "$gemma_root/venv/bin/python" ]; then
  uv python install 3.12.13
  uv venv --python 3.12.13 "$gemma_root/venv"
fi
"$gemma_root/venv/bin/python" -c 'import sys; assert sys.version_info[:3] == (3, 12, 13)'
uv pip sync --python "$gemma_root/venv/bin/python" --require-hashes "$project_root/ai/requirements-gemma.lock"
PYTHONPATH="$project_root/ai" "$gemma_root/venv/bin/python" -m kiryu_ai.gemma_assets --directory "$gemma_root"
printf '%s\n' "Gemma assets and environment: $gemma_root"
