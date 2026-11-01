#!/bin/bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

printf '\n  BYTEFORCE — PYVERIFY LOCAL ENVIRONMENT\n'
printf '  Repository: %s\n\n' "$ROOT"

PYTHON=""
for candidate in "$(command -v python3 2>/dev/null || true)" \
  "$ROOT/pyverify/.venv/bin/python" "$ROOT/.venv/bin/python"; do
  [[ -n "$candidate" && -x "$candidate" ]] || continue
  if "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  printf 'FAILED: Python 3.10 or newer is required. Install a compatible python3, then retry.\n'
  read -r -p 'Press Return to close this window. ' _ || true
  exit 1
fi

set +e
"$PYTHON" "$ROOT/scripts/run_now.py"
RESULT=$?
set -e
if [[ "$RESULT" -ne 0 ]]; then
  read -r -p 'Press Return to close this window. ' _ || true
fi
exit "$RESULT"
