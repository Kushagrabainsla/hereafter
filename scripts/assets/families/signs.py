"""Every sign in the Night Market, from src/world/signs.json: neon tubes bent into letters on a
dark backer, lit boxes with raised letters, and double-sided blade signs on wall brackets.
Built into public/models/signs.glb by scripts/assets/build.py, one piece per sign named
sign_<id>.

Each sign backs onto y = 0 and faces -Y (the game turns -Y to face out of its wall), centred
on its face. A blade sign stands out from the wall instead: its bracket backs onto y = 0 and
its panel runs out along -Y, lettered on both sides (+X and -X), centred on its height.
Lit parts use glow_ink_<id> and glow_face_<id>, coloured as the sign; the game lights them
at the sign's intensity and dims them when the sign is shot out.
"""

import json
import math
import os

from mathutils import Matrix

from lib import ROOT, Piece, box, join, material, move, rounded_rect, text_mesh, tube

SIGNS = json.load(open(os.path.join(ROOT, "src", "world", "signs.json"), encoding="utf-8"))["signs"]
# Bebas Neue's capitals stand about 0.7 of the type size.
CAP = 0.7


def hex_color(text):
    return int(text.lstrip("#"), 16)


def materials():
    material("sign_backer", 0x0c0b10, 0.3, 0.3)
    material("sign_frame", 0x222429, 0.7, 0.45)
    material("sign_bracket", 0x1c1e21, 0.75, 0.5)
    for sign in SIGNS:
        material(f"glow_ink_{sign['id']}", hex_color(sign["ink"]), 0.0, 0.3)
        if sign["style"] == "lightbox":
            material(f"glow_face_{sign['id']}", hex_color(sign["board"]), 0.0, 0.5)


def fit(obj, width):
    """Narrows text that would run wider than `width`."""
    xs = [v.co.x for v in obj.data.vertices]
    span = max(xs) - min(xs)
    if span > width:
        obj.data.transform(Matrix.Diagonal((width / span, 1, 1, 1)))
    return obj


def neon(sign):
    """Glass tubes following the letters and a rounded border, standing off a dark backer."""
    w, h, sid = sign["width"], sign["height"], sign["id"]
    r = min(0.011, max(0.006, h * 0.014))
    backer = box("backer", -w / 2, w / 2, -0.025, 0.0, -h / 2, h / 2, "sign_backer", bev=0.008)
    letters = fit(text_mesh("letters", sign["text"], h * 0.56 / CAP, f"glow_ink_{sid}", neon=r, spacing=1.12, resolution=2, tube_sides=4), w * 0.86)
    move(letters, (0, -0.025 - r - 0.012, 0))
    border = tube("border", rounded_rect(w * 0.97, h * 0.88, min(0.08, h * 0.16)), r * 0.85, f"glow_ink_{sid}", verts=4, caps=False)
    move(border, (0, -0.025 - r - 0.012, 0))
    return join([backer, letters, border], f"sign_{sid}")


def lightbox(sign):
    """A steel box lit from inside: its face in the sign's colour, raised letters in front."""
    w, h, sid = sign["width"], sign["height"], sign["id"]
    frame = box("frame", -w / 2, w / 2, -0.12, 0.0, -h / 2, h / 2, "sign_frame", bev=0.012)
    face = box("face", -w / 2 + 0.04, w / 2 - 0.04, -0.124, -0.118, -h / 2 + 0.04, h / 2 - 0.04, f"glow_face_{sid}")
    letters = fit(text_mesh("letters", sign["text"], h * 0.5 / CAP, f"glow_ink_{sid}", extrude=0.018, spacing=1.08, resolution=2), w * 0.84)
    move(letters, (0, -0.124, 0))
    return join([frame, face, letters], f"sign_{sid}")


def blade(sign):
    """A vertical sign sticking out from the wall on a bracket, its letters stacked in neon on
    both faces."""
    h, sid = sign["height"], sign["id"]
    inner, outer, half_t = 0.19, 0.81, 0.06
    r = 0.008
    panel = box("panel", -half_t, half_t, -outer, -inner, -h / 2, h / 2, "sign_backer", bev=0.01)
    rim = [box(f"rim{s}", s * (half_t + 0.004) - 0.004, s * (half_t + 0.004) + 0.004, -outer, -inner, -h / 2, h / 2, "sign_frame") for s in (-1, 1)]
    plate = box("plate", -0.08, 0.08, -0.02, 0.0, h / 2 - 0.45, h / 2 + 0.12, "sign_bracket", bev=0.005)
    arm = tube("arm", [(0, -0.01, h / 2 + 0.07), (0, -outer - 0.04, h / 2 + 0.07)], 0.018, "sign_bracket", verts=8)
    strut = tube("strut", [(0, -0.01, h / 2 - 0.4), (0, -0.55, h / 2 + 0.06)], 0.013, "sign_bracket", verts=8)
    hangers = [tube(f"hanger{y}", [(0, y, h / 2 + 0.07), (0, y, h / 2)], 0.006, "sign_bracket", verts=6) for y in (-inner - 0.05, -outer + 0.05)]
    parts = [panel, plate, arm, strut] + rim + hangers
    letters = [c for c in sign["text"] if c != " "]
    for side in (-1, 1):
        turn = Matrix.Rotation(math.radians(90 if side > 0 else -90), 4, "Z")
        for i, letter in enumerate(letters):
            glyph = fit(text_mesh(f"l{side}{i}", letter, 0.34 / CAP, f"glow_ink_{sid}", neon=r, resolution=2, tube_sides=4), 0.42)
            glyph.data.transform(turn)
            move(glyph, (side * (half_t + 0.004 + r + 0.012), -(inner + outer) / 2, h / 2 - 0.39 - 0.42 * i))
            parts.append(glyph)
        border = tube(f"border{side}", rounded_rect(0.56, h - 0.06, 0.06), r * 0.85, f"glow_ink_{sid}", verts=4, caps=False)
        border.data.transform(turn)
        move(border, (side * (half_t + 0.004 + r + 0.012), -(inner + outer) / 2, 0))
        parts.append(border)
    return join(parts, f"sign_{sid}")


def make(sign):
    return lambda: {"neon": neon, "lightbox": lightbox, "blade": blade}[sign["style"]](sign)


def budget(sign):
    letters = len(sign["text"].replace(" ", ""))
    return {"neon": 220 * letters + 500, "lightbox": 200 * letters + 300, "blade": 2 * 220 * letters + 900}[sign["style"]]


def size(sign):
    if sign["style"] == "blade":
        return (0.19, 0.85, sign["height"] + 0.12)
    return (sign["width"], 0.06 if sign["style"] == "neon" else 0.142, sign["height"])


PIECES = [Piece(f"sign_{s['id']}", make(s), budget(s), size(s), "wall", f"{s['text']} ({s['style']})") for s in SIGNS]
