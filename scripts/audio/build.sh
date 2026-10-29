#!/bin/sh
# Cut, peak-normalise and encode the game's sound effects into public/audio from the CC0
# sources downloaded by scripts/audio/fetch.sh. Needs ffmpeg with libmp3lame and a tar
# that reads 7z (macOS bsdtar) or 7z. Sources and licences: docs/data-sources.md.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets-src/audio"
OUT="$ROOT/public/audio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

FIRE="$SRC/firearm-library/extracted/Prepared SFX Library"
if [ ! -d "$FIRE" ]; then
  mkdir -p "$SRC/firearm-library/extracted"
  if command -v bsdtar >/dev/null; then bsdtar -xf "$SRC/firearm-library/Prepared SFX Library.7z" -C "$SRC/firearm-library/extracted"
  else 7z x -o"$SRC/firearm-library/extracted" "$SRC/firearm-library/Prepared SFX Library.7z"; fi
fi
for pack in impact-sounds rpg-audio; do
  [ -d "$SRC/kenney-$pack/x" ] || { mkdir -p "$SRC/kenney-$pack/x"; unzip -q -o "$SRC/kenney-$pack/$pack.zip" -d "$SRC/kenney-$pack/x"; }
done
IMPACT="$SRC/kenney-impact-sounds/x/Audio"
RPG="$SRC/kenney-rpg-audio/x/Audio"
RELOADS="$SRC/oga-springyspringo-reloads"

# encode IN NAME LAYOUT QUALITY: peak-normalise to -1 dBFS, then write 48 kHz MP3.
encode() {
  max=$(ffmpeg -nostats -i "$1" -af "aformat=channel_layouts=$3,volumedetect" -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
  gain=$(awk "BEGIN { print -1 - ($max) }")
  ffmpeg -v error -y -i "$1" -af "aformat=channel_layouts=$3,volume=${gain}dB" -ar 48000 -c:a libmp3lame -q:a "$4" "$OUT/$2.mp3"
}

# cut IN START DURATION FADE NAME LAYOUT QUALITY: one take with a short fade-in and a tail fade.
cut() {
  fade_start=$(awk "BEGIN { print $3 - $4 }")
  ffmpeg -v error -y -ss "$2" -t "$3" -i "$1" -af "highpass=f=25,afade=t=in:d=0.002,afade=t=out:st=$fade_start:d=$4" -c:a pcm_f32le "$TMP/$5.wav"
  encode "$TMP/$5.wav" "$5" "$6" "$7"
}

# whole IN NAME LAYOUT QUALITY [MAX_SECONDS]: a complete one-shot, optionally shortened.
whole() {
  if [ -n "${5:-}" ]; then cut "$1" 0 "$5" 0.05 "$2" "$3" "$4"
  else ffmpeg -v error -y -i "$1" -af "highpass=f=25" -c:a pcm_f32le "$TMP/$2.wav"; encode "$TMP/$2.wav" "$2" "$3" "$4"; fi
}

# Gunshots: Walther PPQ 9 mm and AK-47 from the Free Firearm Sound Library. Near takes are
# the shooter's own shots (stereo); mid-distance takes with their natural street tail are
# used for other players further away. Start times sit 3 ms before each detected onset.
n=1; for start in 1.4038 6.4413 10.6571; do cut "$FIRE/Walther PPQ/X_39P.wav" $start 0.7 0.3 pistol-near-$n stereo 2; n=$((n + 1)); done
n=1; for start in 1.082 5.239; do cut "$FIRE/Walther PPQ/X_31P.wav" $start 1.45 0.35 pistol-far-$n mono 2; n=$((n + 1)); done
n=1; for start in 0.608 3.254 6.018 9.153; do cut "$FIRE/AK-47/C_28P.wav" $start 0.7 0.3 rifle-near-$n stereo 2; n=$((n + 1)); done
n=1; for start in 0.335 4.398; do cut "$FIRE/AK-47/C_31P.wav" $start 1.8 0.4 rifle-far-$n mono 2; n=$((n + 1)); done

# Reloads. The pistol take loses two silent gaps to fit the 1.2 s reload (slide release
# lands near 0.95 s); the rifle take gains 0.12 s after the magazine comes out to fit 1.7 s.
ffmpeg -v error -y -i "$RELOADS/gunreload1.wav" -filter_complex \
  "[0]atrim=0:0.36,asetpts=N/SR/TB[a];[0]atrim=0.62:1.12,asetpts=N/SR/TB[b];[0]atrim=1.20:1.579,asetpts=N/SR/TB[c];[a][b][c]concat=n=3:v=0:a=1,highpass=f=25[o]" \
  -map "[o]" -c:a pcm_f32le "$TMP/reload-pistol.wav"
encode "$TMP/reload-pistol.wav" reload-pistol mono 3
ffmpeg -v error -y -i "$RELOADS/assaultriflereload1.wav" -filter_complex \
  "[0]atrim=0:0.62,asetpts=N/SR/TB,apad=pad_dur=0.12[a];[0]atrim=0.62,asetpts=N/SR/TB[b];[a][b]concat=n=2:v=0:a=1,highpass=f=25[o]" \
  -map "[o]" -c:a pcm_f32le "$TMP/reload-rifle.wav"
encode "$TMP/reload-rifle.wav" reload-rifle mono 3

# Footsteps: Kenney concrete for roads and pavements, grass for open ground and parks.
for i in 0 1 2 3 4; do
  whole "$IMPACT/footstep_concrete_00$i.ogg" step-hard-$((i + 1)) mono 4
  whole "$IMPACT/footstep_grass_00$i.ogg" step-soft-$((i + 1)) mono 4 0.45
done

# Bodies and surfaces.
for i in 0 1 2 3 4; do whole "$IMPACT/impactPunch_medium_00$i.ogg" body-hit-$((i + 1)) mono 4; done
for i in 0 1 2; do whole "$IMPACT/impactPunch_heavy_00$i.ogg" hurt-$((i + 1)) mono 4; done
for i in 0 1 2; do whole "$IMPACT/impactSoft_heavy_00$i.ogg" land-$((i + 1)) mono 4; done
for i in 0 1 2 3; do whole "$IMPACT/impactMining_00$i.ogg" bullet-impact-$((i + 1)) mono 4 0.45; done

# Handling: Kenney RPG Audio foley and BMacZero's magazine seat.
whole "$RPG/metalClick.ogg" dry-fire mono 4 0.2
whole "$RPG/metalLatch.ogg" latch mono 4
for i in 1 2 3; do whole "$RPG/drawKnife$i.ogg" draw-knife-$i mono 4; done
for i in 1 2 3 4; do whole "$RPG/cloth$i.ogg" cloth-$i mono 4; done
whole "$RPG/handleSmallLeather.ogg" grab-1 mono 4
whole "$RPG/handleSmallLeather2.ogg" grab-2 mono 4
whole "$SRC/oga-bmaczero-reloads/clipload1.wav" mag-in mono 4
whole "$RPG/knifeSlice.ogg" knife-hit-1 mono 4
whole "$RPG/knifeSlice2.ogg" knife-hit-2 mono 4

ls -l "$OUT" | awk 'NR > 1 { total += $5; files += 1 } END { printf "%d files, %.0f KB in %s\n", files, total / 1024, "public/audio" }'
