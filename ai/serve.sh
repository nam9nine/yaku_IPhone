#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ai_python="${KIRYU_AI_WEB_PYTHON:-$project_root/.tooling/character-ai-web/venv/bin/python}"
ai_data="${KIRYU_AI_DATA:-$project_root/references/local/kiryu-ai}"
if [ ! -x "$ai_python" ]; then
  printf '%s\n' 'Run: sh ai/bootstrap-web.sh' >&2
  exit 1
fi
export PYTHONPATH="$project_root/ai${PYTHONPATH:+:$PYTHONPATH}"
exec "$ai_python" -m kiryu_ai.web_server --data-root "$ai_data" "$@"
