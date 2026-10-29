#!/bin/sh
# Build public/models/props/<name>.glb and props.json from the sources fetched by scripts/props/fetch.sh.
# Per-prop settings (variant, simplify ratio, texture size, material, mass, credits) live in scripts/props/props.mjs.
# Steps per prop: prepare (variant, pose, single node, base at y = 0) -> weld -> simplify -> resize -> webp
# -> normalise (re-centre after simplification). Intermediate files go to assets-src/props/.build (ignored by git).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/assets-src/props"
TMP="$SRC/.build"
OUT="$ROOT/public/models/props"
GT="npx --yes @gltf-transform/cli@4.5.1"

[ -f "$SRC/barrel_03/barrel_03_1k.gltf" ] || sh "$HERE/fetch.sh"
[ -d "$HERE/node_modules/@gltf-transform/functions" ] || npm ci --prefix "$HERE" --no-audit --no-fund
rm -rf "$TMP"
mkdir -p "$TMP" "$OUT"

node "$HERE/props.mjs" list | while read -r name source ratio error texture; do
  echo "== $name"
  node "$HERE/props.mjs" prepare "$name" "$SRC/$source" "$TMP/$name.1.glb"
  $GT weld "$TMP/$name.1.glb" "$TMP/$name.2.glb"
  if [ "$ratio" = "1" ]; then
    cp "$TMP/$name.2.glb" "$TMP/$name.3.glb"
  else
    $GT simplify "$TMP/$name.2.glb" "$TMP/$name.3.glb" --ratio "$ratio" --error "$error"
  fi
  $GT resize "$TMP/$name.3.glb" "$TMP/$name.4.glb" --width "$texture" --height "$texture"
  $GT webp "$TMP/$name.4.glb" "$TMP/$name.5.glb" --quality 80
  node "$HERE/props.mjs" normalise "$TMP/$name.5.glb" "$OUT/$name.glb"
done

node "$HERE/props.mjs" manifest "$ROOT/public"
