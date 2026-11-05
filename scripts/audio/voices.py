#!/usr/bin/env python3
"""Build the players' voices and memes into public/audio from src/game/voiceLines.json and
src/game/memes.json.

Voice lines (public/audio/voice/<hi|en>/<line id>.mp3) come from a recording if there is one:
  assets-src/voices/<hi|en>/<line id>.<wav|mp3|m4a|ogg|flac|aiff>   recorded take
  English placeholder: Piper TTS, voice "norman" (public-domain LibriVox data), run with
                       PIPER_PYTHON (a Python that has `pip install piper-tts`).
  Hindi: no placeholder. A Hindi line is silent until it is recorded.
Wordless efforts (jump, climb, pain, death) are cut from the CC0 "Male Grunt/Yelling sounds"
pack by HaelDB, vocalist 3, downloaded by scripts/audio/fetch.sh.
Memes (public/audio/meme/<code>.mp3) come from a clip named after the meme's code, or for a
sound effect from its file in assets-src/memes/sfx (scripts/audio/memes.sh makes those):
  assets-src/memes/<code>.<wav|mp3|m4a|ogg|flac|aiff>               e.g. H1.m4a, E6a.wav
A meme without a clip is silent. A meme's "cut" keeps only that part of a longer clip.

Every voice clip is trimmed of silence, high-passed, peak-normalised to -3 dBFS and written as
48 kHz mono MP3; memes keep their low end and reverb tails and peak at -4 dBFS. Existing
outputs are rebuilt only with --force or when their source is newer.
Usage: python3 scripts/audio/voices.py [--force] [--only hi|en|effort|meme]
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LINES = json.load(open(os.path.join(ROOT, "src", "game", "voiceLines.json"), encoding="utf-8"))
MEMES = json.load(open(os.path.join(ROOT, "src", "game", "memes.json"), encoding="utf-8"))["memes"]
SRC = os.path.join(ROOT, "assets-src")
OUT = os.path.join(ROOT, "public", "audio", "voice")
RECORDINGS = os.path.join(SRC, "voices")
MEME_SRC = os.path.join(SRC, "memes")
MEME_OUT = os.path.join(ROOT, "public", "audio", "meme")
EXTENSIONS = ("wav", "mp3", "m4a", "ogg", "flac", "aiff")
PIPER_MODEL = os.path.join(SRC, "audio", "piper-norman", "en_US-norman-medium.onnx")
GRUNTS = os.path.join(SRC, "audio", "oga-haeldb-grunts", "x", "yelling sounds")
# Vocalist 3's short grunts for effort, short yells for pain and long ones for dying.
EFFORTS = {
    "jump": ["3grunt3", "3grunt4", "3grunt5"],
    "climb": ["3grunt1", "3grunt2", "3grunt6"],
    "pain": ["3yell3", "3yell4", "3yell7", "3yell8", "3yell12", "3yell15"],
    "death": ["3yell1", "3yell6", "3yell9", "3yell14", "3yell16"],
}
FORCE = "--force" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None


def run(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, **kw)


def first(folder, name):
    for ext in EXTENSIONS:
        path = os.path.join(folder, f"{name}.{ext}")
        if os.path.exists(path):
            return path
    return None


def recording(lang, line_id):
    return first(os.path.join(RECORDINGS, lang), line_id)


def meme_source(meme):
    """A clip named after the meme's code, else a sound effect's fetched file."""
    return first(MEME_SRC, meme["code"]) or (meme.get("sfx") and first(os.path.join(MEME_SRC, "sfx"), meme["sfx"]))


def finish_meme(source, target, cut=None):
    """Cut the meme's part of a longer clip if asked ([start, end] in seconds, with a short fade
    at the end), trim silence (keeping quiet tails), peak-normalise to -4 dBFS and encode it."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    part = f"atrim={cut[0]}:{cut[1]},asetpts=N/SR/TB,afade=t=out:st={max(0, cut[1] - cut[0] - 0.25):.3f}:d=0.25," if cut else ""
    trim = part + "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.08,areverse"
    probe = run("ffmpeg", "-nostats", "-i", source, "-af", f"aformat=channel_layouts=mono,{trim},volumedetect", "-f", "null", "-").stderr.decode()
    peak = float([l for l in probe.splitlines() if "max_volume" in l][0].split("max_volume:")[1].split("dB")[0])
    run("ffmpeg", "-v", "error", "-y", "-i", source, "-af", f"aformat=channel_layouts=mono,{trim},volume={-4 - peak:.2f}dB,afade=t=in:d=0.003",
        "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "96k", target)


def finish(source, target, placeholder=False):
    """Trim, high-pass, peak-normalise to -3 dBFS and encode one clip. A synthesised placeholder
    also has its pauses shortened to 0.12 s; a recorded take keeps its timing."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    # Synthesised speech trails off in breathy noise, so its silence threshold is higher.
    floor = -34 if placeholder else -42
    trim = f"silenceremove=start_periods=1:start_threshold={floor}dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold={floor}dB:start_silence=0.06,areverse,highpass=f=90"
    if placeholder:
        trim += f",silenceremove=stop_periods=-1:stop_duration=0.15:stop_threshold={floor}dB:stop_silence=0.08"
    probe = run("ffmpeg", "-nostats", "-i", source, "-af", f"aformat=channel_layouts=mono,{trim},volumedetect", "-f", "null", "-").stderr.decode()
    peak = float([l for l in probe.splitlines() if "max_volume" in l][0].split("max_volume:")[1].split("dB")[0])
    run("ffmpeg", "-v", "error", "-y", "-i", source, "-af", f"aformat=channel_layouts=mono,{trim},volume={-3 - peak:.2f}dB,afade=t=in:d=0.004",
        "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "64k", target)


def stale(target, source=None):
    return FORCE or not os.path.exists(target) or (source is not None and os.path.getmtime(source) > os.path.getmtime(target))


def piper(texts, folder):
    """Synthesise {id: text} with Piper into folder/<id>.wav, in one process."""
    python = os.environ.get("PIPER_PYTHON", "python3")
    program = (
        "import json, sys, wave\n"
        "from piper import PiperVoice, SynthesisConfig\n"
        "voice = PiperVoice.load(sys.argv[1])\n"
        "# Less noise than the defaults, which trailed off in breaths, and a quicker delivery.\n"
        "config = SynthesisConfig(noise_scale=0.333, noise_w_scale=0.4, length_scale=0.85)\n"
        "for line_id, text in json.loads(sys.argv[3]).items():\n"
        "    with wave.open(f'{sys.argv[2]}/{line_id}.wav', 'wb') as out: voice.synthesize_wav(text, out, syn_config=config)\n"
    )
    try:
        run(python, "-c", program, PIPER_MODEL, folder, json.dumps(texts))
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        detail = error.stderr.decode()[-400:] if isinstance(error, subprocess.CalledProcessError) else str(error)
        sys.exit("Piper failed. Set PIPER_PYTHON to a Python with `pip install piper-tts`.\n"
                 "piper-tts 1.3 on macOS looks for its eSpeak data one folder above the package: link each entry of\n"
                 "<site-packages>/piper/espeak-ng-data into <site-packages> if it reports a missing 'phontab'.\n" + detail)


def main():
    temp = tempfile.mkdtemp()
    built = {"hi": 0, "en": 0, "effort": 0, "recorded": 0, "meme": 0, "silent": 0}
    try:
        lines = LINES["lines"]
        if ONLY in (None, "en"):
            todo = {}
            for line in lines:
                target, take = os.path.join(OUT, "en", f"{line['id']}.mp3"), recording("en", line["id"])
                if take and stale(target, take):
                    finish(take, target); built["en"] += 1; built["recorded"] += 1
                elif not take and stale(target):
                    todo[line["id"]] = line["en"]
            if todo:
                if not os.path.exists(PIPER_MODEL):
                    sys.exit(f"Missing {PIPER_MODEL}: run scripts/audio/fetch.sh first.")
                piper(todo, temp)
                for line_id in todo:
                    finish(os.path.join(temp, f"{line_id}.wav"), os.path.join(OUT, "en", f"{line_id}.mp3"), True); built["en"] += 1
        if ONLY in (None, "hi"):
            for line in lines:
                target, take = os.path.join(OUT, "hi", f"{line['id']}.mp3"), recording("hi", line["id"])
                if take and stale(target, take):
                    finish(take, target); built["hi"] += 1; built["recorded"] += 1
                elif not take and os.path.exists(target):
                    # No synthesised Hindi: an unrecorded line is silent.
                    os.remove(target)
        if ONLY in (None, "effort"):
            for kind, names in EFFORTS.items():
                assert len(names) == LINES["efforts"][kind], kind
                for index, name in enumerate(names):
                    source, target = os.path.join(GRUNTS, f"{name}.wav"), os.path.join(OUT, "effort", f"{kind}-{index + 1}.mp3")
                    if not os.path.exists(source):
                        sys.exit(f"Missing {source}: run scripts/audio/fetch.sh first.")
                    if stale(target):
                        finish(source, target); built["effort"] += 1
        if ONLY in (None, "meme"):
            for meme in MEMES:
                source, target = meme_source(meme), os.path.join(MEME_OUT, f"{meme['code']}.mp3")
                if not source:
                    built["silent"] += 1
                elif stale(target, source):
                    finish_meme(source, target, meme.get("cut")); built["meme"] += 1
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    print(f"Voices: {built['en']} English, {built['hi']} Hindi, {built['effort']} efforts built ({built['recorded']} from recordings).")
    print(f"Memes: {built['meme']} built, {built['silent']} without a clip yet.")


main()
