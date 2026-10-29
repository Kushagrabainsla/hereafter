#!/bin/sh
# Rebuild public/models/{knife,pistol,rifle,player}.glb from the downloaded sources with Blender.
# Set BLENDER to the Blender executable if it is not on PATH or in /Applications.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
[ -f "$ROOT/assets-src/viewmodels/rocketbox/Military_Male_03.fbx" ] || sh "$ROOT/scripts/viewmodels/fetch.sh"
for weapon in knife pistol rifle; do
  "$BLENDER" -b --python "$ROOT/scripts/viewmodels/build.py" -- --weapon "$weapon" --out "$ROOT/public/models/$weapon.glb" ${PREVIEW:+--preview "$PREVIEW"}
done
"$BLENDER" -b --python "$ROOT/scripts/viewmodels/build_player.py" -- --out "$ROOT/public/models/player.glb" ${PREVIEW:+--preview "$PREVIEW"}
