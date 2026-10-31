#!/bin/sh
# Rebuild the Night Market's baked light: export the static surfaces from the game's own code
# in headless Chrome, then bake them with Cycles in Blender (4.4 or newer). Set CHROME or
# BLENDER if they are not in the default macOS places. Extra arguments go to bake.py,
# for example --samples 768.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
node "$ROOT/scripts/lightmaps/export.mjs"
# Cycles' Metal kernel compiler now and then crashes while starting; a second try gets past it.
"$BLENDER" -b --python-exit-code 1 --python "$ROOT/scripts/lightmaps/bake.py" -- "$@" \
  || "$BLENDER" -b --python-exit-code 1 --python "$ROOT/scripts/lightmaps/bake.py" -- "$@"
