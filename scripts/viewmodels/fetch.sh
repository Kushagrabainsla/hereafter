#!/bin/sh
# Download the source assets for the first-person view models into assets-src/viewmodels.
# Sources, authors and licences are listed in docs/data-sources.md.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets-src/viewmodels"
mkdir -p "$SRC/rocketbox" "$SRC/opengameart" "$SRC/polyhaven"

# Microsoft Rocketbox avatar Military_Male_03 (MIT), pinned to one commit.
RB="https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/0943055db6ec570bcef9f2c8b41c9e5467c808f9"
curl -fsSL "$RB/LICENSE.md" -o "$SRC/rocketbox/LICENSE.md"
curl -fsSL "$RB/Assets/Avatars/Professions/Military_Male_03/Export/Military_Male_03.fbx" -o "$SRC/rocketbox/Military_Male_03.fbx"
for t in body_color_acu body_normal body_specular equipment_color_acu equipment_normal equipment_specular; do
  curl -fsSL "$RB/Assets/Avatars/Professions/Military_Male_03/Textures/sm004_$t.tga" -o "$SRC/rocketbox/sm004_$t.tga"
done

# Poly Haven models (CC0): 1K glTF with packed ARM textures.
for a in service_pistol fish_knife; do
  mkdir -p "$SRC/polyhaven/$a/textures"
  curl -fsSL "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/$a/${a}_1k.gltf" -o "$SRC/polyhaven/$a/${a}_1k.gltf"
  curl -fsSL "https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/$a/$a.bin" -o "$SRC/polyhaven/$a/$a.bin"
  for t in diff nor_gl arm; do
    curl -fsSL "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/$a/${a}_${t}_1k.jpg" -o "$SRC/polyhaven/$a/textures/${a}_${t}_1k.jpg"
  done
done

# AKM by LonesomeDucky on OpenGameArt (CC0), a Blender file with packed 4K textures.
curl -fsSL "https://opengameart.org/sites/default/files/akm54.blend" -o "$SRC/opengameart/akm54.blend"
echo "Sources downloaded to $SRC"
