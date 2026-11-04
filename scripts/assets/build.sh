#!/bin/sh
# Build the asset families in scripts/assets/families with Blender (4.4 or newer), check them,
# and compress each into public/models/<family>.glb with meshopt. See docs/asset-pipeline.md.
#   npm run build:assets                       every family
#   FAMILY=lights npm run build:assets         one family
#   PREVIEW=DIR npm run build:assets           also render a sheet of close-ups per family
# Set BLENDER if Blender is not on PATH or in /Applications.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
[ -f "$ROOT/assets-src/fonts/BebasNeue-Regular.ttf" ] || sh "$ROOT/scripts/assets/fetch.sh"
FAMILIES="${FAMILY:-$(ls "$ROOT/scripts/assets/families" | sed -n 's/\.py$//p')}"
for family in $FAMILIES; do
  echo "== $family"
  "$BLENDER" -b --python-exit-code 1 --python "$ROOT/scripts/assets/build.py" -- --family "$family" ${PREVIEW:+--preview "$PREVIEW"} 2>&1 | grep -E "\[assets\]|Error|Traceback|Checks|  [a-z_]+:" || true
  out="$ROOT/public/models/$family.glb"
  [ -f "$out" ] || { echo "No $out: the build failed."; exit 1; }
  npx --yes @gltf-transform/cli@4.5.1 meshopt "$out" "$out" --level medium > /dev/null
  echo "compressed to $(wc -c < "$out" | tr -d ' ') bytes"
done
