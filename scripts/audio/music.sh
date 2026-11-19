#!/bin/sh
# The shops' music: downloads each track (CC0 or public domain; see docs/data-sources.md#shop-music)
# into assets-src/music, checks it against its SHA-256, and makes public/audio/music/<shop>.mp3:
# the run-in and the end cut off, two-second fades so the loop seam is a soft dip, mono at 24 kHz
# and 56 kbps. The shops play them through a small speaker (SHOP_SPEAKER in gameAudio.ts), which
# keeps nothing above 6.5 kHz, so nothing audible is lost.
#   npm run build:music
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets-src/music"
OUT="$ROOT/public/audio/music"
UA="Mozilla/5.0 (hereafter build)"
FMA="https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks"
mkdir -p "$SRC" "$OUT"
# shop | source URL | SHA-256 | seconds cut from the start | length kept (s)
while IFS='|' read -r shop url sum start keep; do
  [ -n "$shop" ] || continue
  file="$SRC/$shop.mp3"
  [ -f "$file" ] || curl -fsSL -A "$UA" "$url" -o "$file"
  echo "$sum  $file" | shasum -a 256 -c - > /dev/null
  ffmpeg -nostdin -loglevel error -y -ss "$start" -t "$keep" -i "$file" -ac 1 -ar 24000 \
    -af "afade=t=in:d=2,afade=t=out:st=$(echo "$keep - 2" | bc):d=2,loudnorm=I=-18:TP=-2" \
    -b:a 56k "$OUT/$shop.mp3"
  echo "$shop: $(wc -c < "$OUT/$shop.mp3" | tr -d ' ') bytes"
done <<EOF
bar|$FMA/lCCI2O1MPgLWAyjcNnlyg8CKLUnHDlL1inahTM6b.mp3|18d5c30309738056edf86da015f72ef59902825833666e303e11d5c9a13f192c|1|150
noodles|$FMA/OuEa6beEW5fNG7AkJFycR5l1mM4ydag6LU6QshNZ.mp3|746ff2560f59145183d9ba8d82610fa73844f4133697996dafad1a5bd44097b7|1|150
boba|$FMA/b9aaLxa3HIdDsfDmLDUsR27znNe0aldiVWRJbDF9.mp3|5f0c5be828268e50d9dfe4dc3e8d581f131fa3f700d3622fe6db248a548ae2e8|1|150
tea|$FMA/ammMhqbbykaA4NEQFJXeQBT4csNjkLSIFJDaw54E.mp3|49b8af91ca033ae51d00a604b2926fbfcba75702141573898a9822b42333422b|1|150
dumplings|$FMA/RpoR5MzrX5QuZoBxwXXeBtrZ8bajHFYtMs0FVs6x.mp3|49a1180958914c0742212c9fb29a86d4b4618ee04a78f67e230e5b65b950bc5d|1|118
restaurant|$FMA/H8vJtt4KYtC4daSuLVmlg79hTlMjiG4ItSQQEsrD.mp3|632bdf59875ce10238b244010d760bb3e07c9a172dec6a6f89d9643d5998fedd|1|114
records|https://archive.org/download/78_tears_king-olivers-jazz-band-hardin-armstrong-joe-oliver-louis-armstrong-johnny-do_gbia0001053a/Tears%20-%20King%20Oliver%27s%20Jazz%20Band%20-%20Hardin.mp3|d042c5f5ce64ef9756753842aa4cb6fda07dc9843dc27a82cc8a59f65f72c724|3|190
laundry|https://archive.org/download/loc-jukebox-675580-the-midnight-waltz/jukebox-675580_the-midnight-waltz.mp3|91e9c4b4d0ce719a4fbff6b5dbbc1d86c7e56a5775f81fefa54fa6cd9ace22a1|3|185
EOF
