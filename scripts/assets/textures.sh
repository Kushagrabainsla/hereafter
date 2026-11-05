#!/bin/sh
# Bake the surface textures (scripts/assets/textures.py) into public/textures/ with Blender
# (4.4 or newer). See docs/asset-pipeline.md. Set BLENDER if Blender is not on PATH or in
# /Applications.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
"$BLENDER" -b --python-exit-code 1 --python "$ROOT/scripts/assets/textures.py" 2>&1 | grep -E "\[textures\]|Error|Traceback" || true
