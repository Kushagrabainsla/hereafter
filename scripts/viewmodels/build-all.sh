#!/bin/sh
# Rebuild public/models/{hands,pistol,rifle,player}.glb from the downloaded sources with Blender.
# The bare arms (hands.glb) are the old knife rig: the game has no knife and takes the blade out
# as the file loads (src/game/weaponModels.ts).
# Set BLENDER to the Blender executable if it is not on PATH or in /Applications.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
[ -f "$ROOT/assets-src/viewmodels/rocketbox/Military_Male_03.fbx" ] || sh "$ROOT/scripts/viewmodels/fetch.sh"
"$BLENDER" -b --python "$ROOT/scripts/viewmodels/build.py" -- --weapon knife --out "$ROOT/public/models/hands.glb" ${PREVIEW:+--preview "$PREVIEW"}
for weapon in pistol rifle; do
  "$BLENDER" -b --python "$ROOT/scripts/viewmodels/build.py" -- --weapon "$weapon" --out "$ROOT/public/models/$weapon.glb" ${PREVIEW:+--preview "$PREVIEW"}
done
"$BLENDER" -b --python "$ROOT/scripts/viewmodels/build_player.py" -- --out "$ROOT/public/models/player.glb" ${PREVIEW:+--preview "$PREVIEW"}
