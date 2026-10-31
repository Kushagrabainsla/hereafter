#!/bin/sh
# Rebuild public/models/market-kit.glb with Blender (4.4 or newer); set BLENDER if it is not
# on PATH or in /Applications. Pass PREVIEW=DIR to also render the pieces against a wall.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
"$BLENDER" -b --python-exit-code 1 --python "$ROOT/scripts/kit/build.py" -- --out "$ROOT/public/models/market-kit.glb" ${PREVIEW:+--preview "$PREVIEW"}
