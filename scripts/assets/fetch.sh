#!/bin/sh
# Download the fonts the asset pipeline letters signs with into assets-src/fonts (ignored by
# git). Bebas Neue by Dharma Type, SIL Open Font License 1.1, from the Google Fonts repository.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/assets-src/fonts"
mkdir -p "$DIR"
BASE="https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue"
[ -f "$DIR/BebasNeue-Regular.ttf" ] || curl -fsSL "$BASE/BebasNeue-Regular.ttf" -o "$DIR/BebasNeue-Regular.ttf"
[ -f "$DIR/BebasNeue-OFL.txt" ] || curl -fsSL "$BASE/OFL.txt" -o "$DIR/BebasNeue-OFL.txt"
echo "08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73  $DIR/BebasNeue-Regular.ttf" | shasum -a 256 -c -
