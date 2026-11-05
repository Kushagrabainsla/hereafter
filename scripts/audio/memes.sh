#!/bin/sh
# Rebuild the ten meme sound effects (assets-src/memes/sfx/<id>.wav) from their CC0 originals.
# Every original is downloaded into assets-src/audio/meme-sources/<id>/ (ignored by git) and checked
# against the SHA-256 of the file the sounds were made from. bonk reuses the Kenney Impact Sounds
# zip that scripts/audio/fetch.sh downloads, so run that first.
# Output: mono 44.1 kHz 16-bit WAV, peak -1 dBFS, leading/trailing silence trimmed.
# Needs curl, shasum, unzip, ffmpeg/ffprobe, awk and python3 (standard library, sad-trombone only).
# OUT=<dir> writes the results elsewhere; MEME_SRC=<dir> keeps the downloads elsewhere.
set -eu
ROOT="$(dirname "$(dirname "$(dirname "$0")")")"
case "$ROOT" in /*) ;; *) ROOT="$(pwd)/$ROOT" ;; esac
SRC="${MEME_SRC:-$ROOT/assets-src/audio/meme-sources}"
OUT="${OUT:-$ROOT/assets-src/memes/sfx}"
KENNEY_ZIP="$ROOT/assets-src/audio/kenney-impact-sounds/impact-sounds.zip"
UA="Mozilla/5.0 (hereafter build)"
BSB="https://bigsoundbank.com/UPLOAD/bwf-en"
OGA="https://opengameart.org/sites/default/files"
VSCO="https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hereafter-memes.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM
mkdir -p "$SRC" "$OUT"

# ---------------------------------------------------------------- helpers

# fetch <id> <file name> <url> <sha256>: download once into $SRC/<id>/ and verify.
fetch() {
  mkdir -p "$SRC/$1"
  if [ ! -f "$SRC/$1/$2" ]; then
    curl -fsSL --retry 3 -A "$UA" "$3" -o "$SRC/$1/$2.part"
    mv "$SRC/$1/$2.part" "$SRC/$1/$2"
  fi
  echo "$4  $SRC/$1/$2" | shasum -a 256 -c -
}

# calc <expression>: floating-point arithmetic.
calc() { awk "BEGIN { printf \"%.6f\", $1 }"; }

# peak <file> / rms <file> [filter]: overall level in dBFS.
peak() {
  ffmpeg -nostdin -i "$1" -af "aformat=sample_fmts=flt,astats=measure_perchannel=none:measure_overall=Peak_level" -f null - 2>&1 \
    | grep 'Peak level dB' | tail -1 | sed -E 's/.*Peak level dB: (-?[0-9.]+).*/\1/'
}
rms() {
  ffmpeg -nostdin -i "$1" -af "${2:-anull},astats=measure_perchannel=none:measure_overall=RMS_level" -f null - 2>&1 \
    | grep 'RMS level dB' | tail -1 | sed -E 's/.*RMS level dB: (-?[0-9.]+).*/\1/'
}
duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" </dev/null; }

# make_ir <out> <rt60 s> <lowpass Hz> <predelay s>: exponentially decaying noise burst (synthetic reverb).
make_ir() {
  ir_len=$(calc "$2 * 1.1 + $4")
  ffmpeg -nostdin -v error -y -f lavfi -i "aevalsrc=if(lt(t\\,$4)\\,0\\,(random(0)*2-1)*exp(-6.9*(t-$4)/$2)):s=44100:d=$ir_len" \
    -af "lowpass=f=$3,lowpass=f=$3" -c:a pcm_f32le "$1"
}

# reverb <in> <ir> <out> <wet dB relative to dry RMS> <tail s>: dry + convolved copy.
reverb() {
  rv_dry="$WORK/rv-dry.wav"; rv_wet="$WORK/rv-wet.wav"
  ffmpeg -nostdin -v error -y -i "$1" -af "aformat=sample_fmts=flt:channel_layouts=mono,aresample=44100,apad=pad_dur=$5" -c:a pcm_f32le "$rv_dry"
  ffmpeg -nostdin -v error -y -i "$rv_dry" -i "$2" -filter_complex "[1:a]aformat=sample_fmts=flt:channel_layouts=mono[ir];[0:a][ir]afir" -c:a pcm_f32le "$rv_wet"
  rv_gain=$(calc "($(rms "$rv_dry")) + ($4) - ($(rms "$rv_wet"))")
  ffmpeg -nostdin -v error -y -i "$rv_dry" -i "$rv_wet" -filter_complex "[1:a]volume=${rv_gain}dB[w];[0:a][w]amix=inputs=2:normalize=0:duration=longest" -c:a pcm_f32le "$3"
}

# finish <in> <id> <max s|0> <fade-out s> <ffmpeg pre-filter>: mono 44.1 kHz, normalise to -1 dBFS,
# trim silence below -50 dBFS at both ends, cap the length with a fade-out, 1 ms fade-in, 16-bit.
finish() {
  fa="$WORK/$2.a.wav"; fb="$WORK/$2.b.wav"; fc="$WORK/$2.c.wav"; fd="$WORK/$2.d.wav"
  ffmpeg -nostdin -v error -y -i "$1" -af "aformat=sample_fmts=flt,$5,aformat=sample_fmts=flt:channel_layouts=mono,aresample=44100" -c:a pcm_f32le "$fa"
  fn_gain=$(calc "-1.0 - ($(peak "$fa"))")
  ffmpeg -nostdin -v error -y -i "$fa" -af "volume=${fn_gain}dB,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03:detection=peak,areverse" -c:a pcm_f32le "$fb"
  fn_dur=$(duration "$fb")
  if [ "$(awk "BEGIN { print ($3 > 0 && $fn_dur > $3) }")" = 1 ]; then
    ffmpeg -nostdin -v error -y -i "$fb" -af "atrim=0:$3,afade=t=out:st=$(calc "$3 - $4"):d=$4" -c:a pcm_f32le "$fc"
  elif [ "$(awk "BEGIN { print ($4 > 0) }")" = 1 ]; then
    ffmpeg -nostdin -v error -y -i "$fb" -af "afade=t=out:st=$(calc "($fn_dur - $4 > 0) ? $fn_dur - $4 : 0"):d=$4" -c:a pcm_f32le "$fc"
  else
    cp "$fb" "$fc"
  fi
  ffmpeg -nostdin -v error -y -i "$fc" -af "afade=t=in:d=0.001" -c:a pcm_f32le "$fd"
  ffmpeg -nostdin -v error -y -i "$fd" -af "volume=$(calc "-1.0 - ($(peak "$fd"))")dB" -ar 44100 -ac 1 -c:a pcm_s16le "$OUT/$2.wav"
  echo "$2: $(duration "$OUT/$2.wav") s -> $OUT/$2.wav"
}

make_ir "$WORK/ir-room.wav" 0.9 6000 0.012
make_ir "$WORK/ir-hall.wav" 1.6 5000 0.02
make_ir "$WORK/ir-boom.wav" 1.1 3000 0.015

# ---------------------------------------------------------------- vine-boom
# Deep cinematic boom: a concert bass drum hit (BDrumNewhit_v7_rr1_Sum.wav) from VS Chamber
# Orchestra: Community Edition by Versilian Studios (github.com/sgossner/VSCO-2-CE), CC0 1.0 Universal.
# Pitched down ~3 semitones, low-end boost, tanh saturation, short synthetic reverb.
fetch vine-boom BDrumNewhit_v7_rr1_Sum.wav "$VSCO/Percussion/BDrumNewhit_v7_rr1_Sum.wav" 7024054e68261d2cca0ee58fdf9d6f23b54370792d04aa2c1ccf41acc090bd2b
ffmpeg -nostdin -v error -y -i "$SRC/vine-boom/BDrumNewhit_v7_rr1_Sum.wav" \
  -af "aformat=sample_fmts=flt:channel_layouts=mono,asetrate=44100*0.84,aresample=44100,highpass=f=30,lowshelf=g=5:f=110,equalizer=f=160:t=q:w=1:g=4,volume=14dB,asoftclip=type=tanh:oversample=4,volume=-3dB" \
  -c:a pcm_f32le "$WORK/boom.wav"
reverb "$WORK/boom.wav" "$WORK/ir-boom.wav" "$WORK/boom-verb.wav" -12 1.0
finish "$WORK/boom-verb.wav" vine-boom 1.6 0.7 anull

# ---------------------------------------------------------------- air-horn
# Air-horn blasts: "Gas fog horn #1" by Joseph SARDIN, BigSoundBank
# (bigsoundbank.com/gas-fog-horn-1-s1048.html), "CC0 (public domain): Free and royalty-free".
# The three blasts are kept and the gaps between them shortened to ~0.1 s; gentle limiting.
fetch air-horn 1048.wav "$BSB/1048.wav" 233b9c381d6d7229aa034f59b56e396bc9248feef1b2f0506911ca7ec9b14ab3
ffmpeg -nostdin -v error -y -i "$SRC/air-horn/1048.wav" -filter_complex \
  "[0:a]aformat=sample_fmts=flt:channel_layouts=mono,aresample=44100,asplit=3[a][b][c];[a]atrim=0.06:0.74,asetpts=N/SR/TB,afade=t=out:st=0.63:d=0.05[a1];[b]atrim=1.25:1.97,asetpts=N/SR/TB,afade=t=in:d=0.005,afade=t=out:st=0.67:d=0.05,adelay=720:all=1[b1];[c]atrim=2.46:3.45,asetpts=N/SR/TB,afade=t=in:d=0.005,adelay=1460:all=1[c1];[a1][b1][c1]amix=inputs=3:normalize=0:duration=longest" \
  -c:a pcm_f32le "$WORK/airhorn.wav"
finish "$WORK/airhorn.wav" air-horn 0 0.05 "alimiter=level_in=1.8:limit=1:attack=1:release=40:level=false:latency=true"

# ---------------------------------------------------------------- boing
# Cartoon spring boing: "BOING!" by Aeva, OpenGameArt (opengameart.org/content/boing), CC0.
# Trimmed to 1.8 s with a fade-out.
fetch boing boing.flac "$OGA/boing.flac" 9c6af38ca79332ad3fa66ad1229179d2a91655c1157d3620e21ef676f54d9fdd
finish "$SRC/boing/boing.flac" boing 1.8 0.6 anull

# ---------------------------------------------------------------- metal-pipe
# Metal clang: "Iron bar falling #1" by DenisChardonnet, BigSoundBank
# (bigsoundbank.com/iron-bar-falling-1-s0234.html), "CC0 (public domain): Free and royalty-free".
# Light synthetic room reverb.
fetch metal-pipe 0234.wav "$BSB/0234.wav" 40b1713a447c482950785428e746b696bce5fcf4d8fd630ccd4c6fa6a7fabc48
reverb "$SRC/metal-pipe/0234.wav" "$WORK/ir-room.wav" "$WORK/pipe-verb.wav" -8 1.2
finish "$WORK/pipe-verb.wav" metal-pipe 1.8 0.5 anull

# ---------------------------------------------------------------- bonk
# Hollow wooden knock: impactWood_medium_002.ogg from Kenney's "Impact Sounds"
# (kenney.nl/assets/impact-sounds), Creative Commons CC0. Taken from the zip fetch.sh downloads.
if [ ! -f "$KENNEY_ZIP" ]; then
  echo "Missing $KENNEY_ZIP: run scripts/audio/fetch.sh first." >&2
  exit 1
fi
mkdir -p "$SRC/bonk"
[ -f "$SRC/bonk/impactWood_medium_002.ogg" ] || unzip -q -o -j "$KENNEY_ZIP" Audio/impactWood_medium_002.ogg -d "$SRC/bonk"
echo "3f3f1917428b828f733a963167833c707bf88296ff158e1559c57c5cb813d799  $SRC/bonk/impactWood_medium_002.ogg" | shasum -a 256 -c -
finish "$SRC/bonk/impactWood_medium_002.ogg" bonk 0 0.04 anull

# ---------------------------------------------------------------- dun-dun
# Dramatic three-note brass sting (D, F, then a held C#), arranged from VS Chamber Orchestra:
# Community Edition samples by Versilian Studios (github.com/sgossner/VSCO-2-CE), CC0 1.0 Universal:
# tenor trombone, tuba and horn staccatos, tenor trombone and tuba sustains, timpani, bass drum.
fetch dun-dun tenortbn_stac_D3_v4_rr1.wav "$VSCO/Brass/Tenor%20Trombone/stac/tenortbn_stac_D3_v4_rr1.wav" 15fc0a2625e4cf3f6f55b4d4e251bb445d52bda4c1b59be49f816168ceec22fb
fetch dun-dun tenortbn_stac_F3_v4_rr1.wav "$VSCO/Brass/Tenor%20Trombone/stac/tenortbn_stac_F3_v4_rr1.wav" bc3ba076da4ae7a1a7e528daa7906faa2507c86754d0478965d59e8cb0ea1d95
fetch dun-dun tenortbn_sus_Cs3_v3_1.wav "$VSCO/Brass/Tenor%20Trombone/sus/tenortbn_sus_C%233_v3_1.wav" 7d70f3324d34c2f1d34d210b11bc2b43158f47b7dc77fa2f65c7157f0d786404
fetch dun-dun Tuba3_stac_D2_v2_rr1_Sum.wav "$VSCO/Brass/Tuba/stac/Tuba3_stac_D2_v2_rr1_Sum.wav" 4ed9b5455e0c8b2532e9cac41e32a9218e96a4260a0104008b0a86083d3b7ce2
fetch dun-dun Tuba3_stac_F2_v2_rr1_Sum.wav "$VSCO/Brass/Tuba/stac/Tuba3_stac_F2_v2_rr1_Sum.wav" 85b1e4d289417593141ff062262a7ce11f1829db6d018d164d9df3e0fe16d830
fetch dun-dun Tuba3_sus_D2_v3_rr1_Mid.wav "$VSCO/Brass/Tuba/sus/Tuba3_sus_D2_v3_rr1_Mid.wav" 714f93eab4ac32aaa88b1265ac12261d39bd97798cea0a81e7fd20afd977af81
fetch dun-dun MOHorn_stac_D2_v3_rr1.wav "$VSCO/Brass/F%20Horn/stac/MOHorn_stac_D2_v3_rr1.wav" 1960b9d7f8c3cd4e0532fc540d60c3b323e8c91e9e5d3a0b0bf2fbf0803f0951
fetch dun-dun MOHorn_stac_F2_v3_rr1.wav "$VSCO/Brass/F%20Horn/stac/MOHorn_stac_F2_v3_rr1.wav" 1f6df484f8b62e31f1add13ea2599ecfcfeec5ecbe4701b26480f13478df7ba8
fetch dun-dun Timpani3_Hit_v4_rr1_Sum.wav "$VSCO/Percussion/Timpani/Timpani3_Hit_v4_rr1_Sum.wav" 59a58eb828dc109e3cc7b7744a0f84e47182cadf2cf548a0c0b94ae5581cdc60
fetch dun-dun BDrumNewhit_v7_rr1_Sum.wav "$VSCO/Percussion/BDrumNewhit_v7_rr1_Sum.wav" 7024054e68261d2cca0ee58fdf9d6f23b54370792d04aa2c1ccf41acc090bd2b
# Layers: name|file|semitones|length s|fade-out s|start s|level dB (relative to -20 dBFS RMS of the first 0.3 s).
# Hits at 0, 0.40 and 0.80 s.
set --
while IFS='|' read -r dd_name dd_file dd_semi dd_len dd_fade dd_start dd_rel; do
  ffmpeg -nostdin -v error -y -i "$SRC/dun-dun/$dd_file" \
    -af "aformat=sample_fmts=flt:channel_layouts=mono,aresample=44100,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004:detection=peak,asetrate=$(calc "44100 * 2 ^ ($dd_semi / 12)"),aresample=44100,atrim=0:$dd_len,afade=t=out:st=$(calc "$dd_len - $dd_fade"):d=$dd_fade:curve=qsin" \
    -c:a pcm_f32le "$WORK/dd-$dd_name.wav"
  dd_gain=$(calc "-20 - ($(rms "$WORK/dd-$dd_name.wav" "atrim=0:0.3")) + ($dd_rel)")
  dd_ms=$(awk "BEGIN { printf \"%d\", $dd_start * 1000 + 0.5 }")
  ffmpeg -nostdin -v error -y -i "$WORK/dd-$dd_name.wav" -af "volume=${dd_gain}dB,adelay=${dd_ms}:all=1" -c:a pcm_f32le "$WORK/dd-$dd_name-placed.wav"
  set -- "$@" -i "$WORK/dd-$dd_name-placed.wav"
done <<'EOF'
t1|tenortbn_stac_D3_v4_rr1.wav|0|0.55|0.15|0|0
h1|MOHorn_stac_D2_v3_rr1.wav|0|0.55|0.15|0|-3
u1|Tuba3_stac_D2_v2_rr1_Sum.wav|0|0.55|0.15|0|-3
p1|Timpani3_Hit_v4_rr1_Sum.wav|0|0.55|0.20|0|-5
t2|tenortbn_stac_F3_v4_rr1.wav|0|0.55|0.15|0.40|0
h2|MOHorn_stac_F2_v3_rr1.wav|0|0.55|0.15|0.40|-3
u2|Tuba3_stac_F2_v2_rr1_Sum.wav|0|0.55|0.15|0.40|-3
p2|Timpani3_Hit_v4_rr1_Sum.wav|3|0.55|0.20|0.40|-5
t3|tenortbn_sus_Cs3_v3_1.wav|0|2.6|2.0|0.80|-3
u3|Tuba3_sus_D2_v3_rr1_Mid.wav|-1|2.6|2.0|0.80|-5
t3s|tenortbn_stac_D3_v4_rr1.wav|-1|0.9|0.5|0.80|1
h3s|MOHorn_stac_D2_v3_rr1.wav|-1|0.9|0.5|0.80|-2
u3s|Tuba3_stac_D2_v2_rr1_Sum.wav|-1|0.9|0.5|0.80|-2
p3|Timpani3_Hit_v4_rr1_Sum.wav|-1|2.6|1.2|0.80|-3
b3|BDrumNewhit_v7_rr1_Sum.wav|0|2.6|1.2|0.80|-7
EOF
ffmpeg -nostdin -v error -y "$@" -filter_complex "amix=inputs=$(($# / 2)):normalize=0:duration=longest" -c:a pcm_f32le "$WORK/dd-mix.wav"
set --
reverb "$WORK/dd-mix.wav" "$WORK/ir-hall.wav" "$WORK/dd-verb.wav" -11 1.2
finish "$WORK/dd-verb.wav" dun-dun 3.8 0.6 anull

# ---------------------------------------------------------------- crickets
# Night-time cricket chirps: "Field cricket" by Joseph SARDIN, BigSoundBank
# (bigsoundbank.com/field-cricket-s1020.html), "CC0 (public domain): Free and royalty-free".
# A 3 s excerpt (14.52 to 17.56 s), eight chirps.
fetch crickets 1020.wav "$BSB/1020.wav" 1a5d7f026c9fbc3bd56d2e4d4e4accfafdc6846db8e4698d896afc02744850f6
finish "$SRC/crickets/1020.wav" crickets 0 0.2 "atrim=14.52:17.56,asetpts=N/SR/TB,afade=t=in:d=0.04"

# ---------------------------------------------------------------- record-scratch
# Vinyl scratch: "Vinyl Scratch #18" by Joseph SARDIN, BigSoundBank
# (bigsoundbank.com/vinyl-scratch-18-s2875.html), "CC0 (public domain): Free and royalty-free".
# The original's few clipped peaks are repaired with adeclip.
fetch record-scratch 2875.wav "$BSB/2875.wav" a0cd43d569a1c7f0eafe3a94c1b8df043826d259a931f96179f94499a2bf1ec8
finish "$SRC/record-scratch/2875.wav" record-scratch 0 0.03 adeclip

# ---------------------------------------------------------------- fart
# Cartoon raspberry fart (made with the mouth): "Gastric Distress" by LFA, OpenGameArt
# (opengameart.org/content/gastric-distress), CC0. The clipped original is declipped first, then
# the 4.52 to 5.40 s chunk is cut out and gently limited.
fetch fart gastricdistress_bylfa_0.wav "$OGA/gastricdistress_bylfa_0.wav" ba19e9e10e668e15092b1ffff7f8bd0e19fc0a3667b56a586b029ec77df52dba
ffmpeg -nostdin -v error -y -i "$SRC/fart/gastricdistress_bylfa_0.wav" -af "aformat=sample_fmts=dbl,adeclip" -c:a pcm_f32le "$WORK/fart-declip.wav"
finish "$WORK/fart-declip.wav" fart 0 0.06 "atrim=4.52:5.40,asetpts=N/SR/TB,alimiter=level_in=1:limit=1:attack=1:release=30:level=false:latency=true"

# ---------------------------------------------------------------- sad-trombone
# "Wah wah wah waaah": real trombone notes (Eb3, D3, C#3, then a held C3 with vibrato) from the
# OldTrombone set of VS Chamber Orchestra: Community Edition by Versilian Studios
# (github.com/sgossner/VSCO-2-CE), CC0 1.0 Universal. C#3 is the D3 sustain a semitone down.
# A swept low-pass gives each note a plunger "wah"; the last note gets a ~4 Hz wah and droops a
# semitone. Light synthetic room reverb.
fetch sad-trombone Trombone_Sustain_Ds2_v4_1.wav "$VSCO/Brass/OldTrombone/Sustain/Trombone_Sustain_D%232_v4_1.wav" 9c11d41942269f0fdfe9079955bb0769fa5f752942dfb18b551c6851bcb93b15
fetch sad-trombone Trombone_Sustain_D2_v4_1.wav "$VSCO/Brass/OldTrombone/Sustain/Trombone_Sustain_D2_v4_1.wav" 886b81fc5a6baec849b6b8e8ccbaabffcd1365ab4a0755333a1e09f646c6bb0f
fetch sad-trombone Trombone_Vibrato_C2_v1_1.wav "$VSCO/Brass/OldTrombone/Vibrato/Trombone_Vibrato_C2_v1_1.wav" f37cd86a50c2245c1c2e09bd8aadf2e8ad7f30626f41a4c63f1ad468815c318b
st_prep="aformat=sample_fmts=flt:channel_layouts=mono,aresample=44100,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.003:detection=peak"
ffmpeg -nostdin -v error -y -i "$SRC/sad-trombone/Trombone_Sustain_Ds2_v4_1.wav" -af "$st_prep" -f f32le -c:a pcm_f32le "$WORK/st-n1.f32"
ffmpeg -nostdin -v error -y -i "$SRC/sad-trombone/Trombone_Sustain_D2_v4_1.wav" -af "$st_prep" -f f32le -c:a pcm_f32le "$WORK/st-n2.f32"
ffmpeg -nostdin -v error -y -i "$SRC/sad-trombone/Trombone_Sustain_D2_v4_1.wav" -af "$st_prep,asetrate=44100*0.943874,aresample=44100" -f f32le -c:a pcm_f32le "$WORK/st-n3.f32"
ffmpeg -nostdin -v error -y -i "$SRC/sad-trombone/Trombone_Vibrato_C2_v1_1.wav" -af "$st_prep" -f f32le -c:a pcm_f32le "$WORK/st-n4.f32"
python3 -I - "$WORK/st-mix.f32" "$WORK/st-n1.f32" "$WORK/st-n2.f32" "$WORK/st-n3.f32" "$WORK/st-n4.f32" <<'EOF'
import sys, array, math
SR = 44100
def load(p):
    a = array.array('f'); a.frombytes(open(p, 'rb').read()); return list(a)
def rms(x): return math.sqrt(sum(v*v for v in x)/len(x))
def svf_lp(x, fc_of_t, q=0.45):
    # state-variable low-pass whose cutoff follows fc_of_t(time)
    low = band = 0.0; out = [0.0]*len(x)
    for i, v in enumerate(x):
        f = 2*math.sin(math.pi*min(fc_of_t(i/SR), 6000)/SR)
        low += f*band; high = v - low - q*band; band += f*high
        out[i] = low
    return out
def resample_droop(x, start, dur, semis):
    # play at rate 1 until `start`, then glide the pitch down by `semis` over `dur` seconds
    out = []; pos = 0.0
    while pos < len(x)-1:
        i = int(pos); fr = pos-i
        out.append(x[i]*(1-fr) + x[i+1]*fr)
        t = len(out)/SR
        pos += 1.0 if t < start else 2**(-semis*min(1.0, (t-start)/dur)/12)
    return out
def env_amp(n, att, rel):
    return [min(1.0, (i/SR)/att) * min(1.0, ((n-i)/SR)/rel) for i in range(n)]
out_path, *notes = sys.argv[1:]
ns = [load(p) for p in notes]
ref = rms(ns[0][:int(0.4*SR)])                       # level-match the notes on their first 0.4 s
gains = [ref/max(1e-9, rms(n[:int(0.4*SR)])) for n in ns]
ns = [[v*g for v in n[:int(2.4*SR)]] for n, g in zip(ns, gains)]
SHORT = 0.47; GAP = 0.03; LONG = 1.95
starts = [0.0, SHORT+GAP, 2*(SHORT+GAP), 3*(SHORT+GAP)]
mix = [0.0]*int((starts[3] + LONG + 0.05)*SR)
for k in range(3):                                   # wah, wah, wah: plunger opens then closes
    n = ns[k][:int(SHORT*SR)]
    L = len(n)/SR
    def fc(t, L=L):
        return 330 + 2600*min(1.0, t/0.10)*min(1.0, max(0.0, (L-t)/0.14))
    y = svf_lp(n, fc); e = env_amp(len(y), 0.012, 0.05); s = int(starts[k]*SR)
    for i, v in enumerate(y): mix[s+i] += v*e[i]
n = resample_droop(ns[3][:int((LONG+0.3)*SR)], start=1.05, dur=0.8, semis=1.0)[:int(LONG*SR)]
L = len(n)/SR
def fc4(t):                                          # waaah: ~4.3 Hz wah that closes as it fades
    w = 1.0 if t < 0.35 else 0.5 + 0.5*math.cos(2*math.pi*4.3*(t-0.35))
    c = min(1.0, max(0.0, (L-t)/0.6))
    return 300 + 2400*min(1.0, t/0.12)*(0.25 + 0.75*w)*(0.4 + 0.6*c)
y = svf_lp(n, fc4); e = env_amp(len(y), 0.012, 0.55); s = int(starts[3]*SR)
for i, v in enumerate(y): mix[s+i] += v*e[i]*1.05
pk = max(abs(v) for v in mix)
open(out_path, 'wb').write(array.array('f', [v/pk*0.8 for v in mix]).tobytes())
EOF
ffmpeg -nostdin -v error -y -f f32le -ar 44100 -ac 1 -i "$WORK/st-mix.f32" -c:a pcm_f32le "$WORK/st-mix.wav"
reverb "$WORK/st-mix.wav" "$WORK/ir-room.wav" "$WORK/st-verb.wav" -14 0.8
finish "$WORK/st-verb.wav" sad-trombone 3.9 0.3 anull

echo "Meme sound effects written to $OUT"
