#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  printf '%s\n' 'Local model execution requires an Apple Silicon Mac. Portable tests use requirements-ci.lock.' >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' 'Install uv, then rerun this script.' >&2
  exit 1
fi
ai_env="$project_root/.tooling/character-ai/venv"
if [ ! -x "$ai_env/bin/python" ]; then
  uv python install 3.12.13
  uv venv --python 3.12.13 "$ai_env"
fi
"$ai_env/bin/python" -c 'import sys; assert sys.version_info[:3] == (3, 12, 13), "Expected Python 3.12.13"'
uv pip sync --python "$ai_env/bin/python" --require-hashes "$project_root/ai/requirements.lock"
printf '%s\n' "Python: $ai_env/bin/python"
