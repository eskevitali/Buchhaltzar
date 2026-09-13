#!/bin/sh
set -eu
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --text="Для установщика Buchhaltzar нужен Python 3."
  else
    echo "Для установщика Buchhaltzar нужен Python 3." >&2
  fi
  exit 1
fi
exec "$PY" ./install.py "$@"
