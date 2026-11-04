#!/bin/sh
# Download the CC0 sound sources into assets-src/audio (ignored by git).
# Sources, authors and licences are listed in docs/data-sources.md.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets-src/audio"
UA="Mozilla/5.0 (hereafter build)"
mkdir -p "$SRC/firearm-library" "$SRC/kenney-impact-sounds" "$SRC/kenney-rpg-audio" "$SRC/oga-springyspringo-reloads" "$SRC/oga-bmaczero-reloads"

# The Free Firearm Sound Library, prepared edition (CC0), by Ben Jaszczak, Brian Nelson,
# Kevin Heras and Matthew Nanney, mirrored on OpenGameArt.
LIB="$SRC/firearm-library/Prepared SFX Library.7z"
if [ ! -f "$LIB" ]; then
  curl -fL --retry 3 -A "$UA" "https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z" -o "$LIB"
fi
echo "cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6  $LIB" | shasum -a 256 -c -

# Kenney Impact Sounds and RPG Audio (CC0), through kenney.nl's own signed download link.
for pack in impact-sounds rpg-audio; do
  zip="$SRC/kenney-$pack/$pack.zip"
  if [ ! -f "$zip" ]; then
    id=$(printf "assets/%s" "$pack" | od -An -tx1 | tr -d ' \n')
    url=$(curl -fsSL -A "$UA" -H "Referer: https://kenney.nl/assets/$pack" "https://kenney.nl/download-link/$id" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | sed 's|\\/|/|g')
    curl -fsSL -A "$UA" -H "Referer: https://kenney.nl/assets/$pack" "$url" -o "$zip"
  fi
done

# Reload recordings on OpenGameArt (CC0): SpringySpringo's "Gun Reload Sounds" and
# BMacZero's "Gun Reload Sound Effects".
curl -fsSL -A "$UA" https://opengameart.org/sites/default/files/gunreload1.wav -o "$SRC/oga-springyspringo-reloads/gunreload1.wav"
curl -fsSL -A "$UA" https://opengameart.org/sites/default/files/assaultriflereload1_0.wav -o "$SRC/oga-springyspringo-reloads/assaultriflereload1.wav"
curl -fsSL -A "$UA" https://opengameart.org/sites/default/files/clipload1.wav -o "$SRC/oga-bmaczero-reloads/clipload1.wav"
# Voices (scripts/audio/voices.py): HaelDB's "Male Grunt/Yelling sounds" (CC0), and the Piper
# voice "norman" (MIT, trained on public-domain LibriVox recordings) for English placeholders.
mkdir -p "$SRC/oga-haeldb-grunts" "$SRC/piper-norman"
GRUNTS="$SRC/oga-haeldb-grunts/yelling-sounds.zip"
[ -f "$GRUNTS" ] || curl -fsSL -A "$UA" "https://opengameart.org/sites/default/files/yelling%20sounds.zip" -o "$GRUNTS"
echo "e9100a4e3b9dcd146993089970dc6097dcf9935fa4683b196040012bad65d67a  $GRUNTS" | shasum -a 256 -c -
[ -d "$SRC/oga-haeldb-grunts/x" ] || unzip -q -o "$GRUNTS" -d "$SRC/oga-haeldb-grunts/x"
for f in en_US-norman-medium.onnx en_US-norman-medium.onnx.json MODEL_CARD; do
  [ -f "$SRC/piper-norman/$f" ] || curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/norman/medium/$f" -o "$SRC/piper-norman/$f"
done
echo "b9739443232a80a59c7d18810dd856899bf16a7964725f5ab81ea49b1351cb71  $SRC/piper-norman/en_US-norman-medium.onnx" | shasum -a 256 -c -
echo "Sources downloaded to $SRC"
