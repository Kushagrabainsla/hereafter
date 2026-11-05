"""Street dressing: the service alley's dumpsters, pallets and manhole cover, the water tanks and
TV antennas on the roofs, the paper posters on the walls (one per entry in
src/world/posters.json, named poster_<id>) and the SOFA mural. Built into
public/models/street.glb by scripts/assets/build.py.

The dumpster, pallet and manhole stand on the ground with their origin under their middle and
their front toward -Y; the dumpster's back goes against a wall. The water tank and the antenna
stand on a roof the same way. The antenna's mast is 4 m and the game stretches it to each
roof's height. Posters and the mural back onto a wall at y = 0, facing -Y, centred on their
middle.
"""

import json
import math
import os
import random

import bmesh
from mathutils import Matrix

from lib import (RAD, ROOT, Piece, apply_modifiers, box, clip, cylinder, ellipse, fit, hull, join, lathe, material, mesh_object,
                 move, paint, prism, sphere, text_mesh, tube, turned_box)

POSTERS = json.load(open(os.path.join(ROOT, "src", "world", "posters.json"), encoding="utf-8"))["posters"]
# Bebas Neue's capitals stand about 0.7 of the type size.
CAP = 0.7
MURAL_PAINT = {"ground": 0x1d2433, "pink": 0xff5f7a, "amber": 0xffb347, "teal": 0x3fd0c9, "violet": 0x9b6bff,
               "cream": 0xfff4d6, "ink": 0x111318}


def hex_color(text):
    return int(text.lstrip("#"), 16)


def materials():
    material("street_dumpster", 0x2f5d3a, 0.4, 0.55)
    material("street_lid", 0x1f3a26, 0.0, 0.6)
    material("street_rust", 0x5e3420, 0.2, 0.85)
    material("street_stencil", 0xd8d4c4, 0.0, 0.7)
    material("street_rubber", 0x161616, 0.0, 0.8)
    material("street_steel", 0x3a3f44, 0.6, 0.45)
    material("street_galv", 0x8b9196, 0.8, 0.4)
    material("street_cable", 0x121212, 0.1, 0.6)
    material("street_pallet", 0xa88a64, 0.0, 0.85)
    material("street_pallet_old", 0x7f6a50, 0.0, 0.9)
    material("street_iron", 0x2b2b2d, 0.75, 0.6)
    material("street_iron_worn", 0x5c5c60, 0.85, 0.35)
    material("street_cedar", 0x6e4a32, 0.0, 0.85)
    material("street_cedar_dark", 0x45301f, 0.0, 0.9)
    material("street_hoop", 0x262628, 0.7, 0.55)
    material("poster_tape", 0xe6dcc0, 0.0, 0.35)
    for poster in POSTERS:
        for part in ("paper", "ink", "accent"):
            material(f"poster_{poster['id']}_{part}", hex_color(poster[part]), 0.0, 0.8 if part == "paper" else 0.6)
    for name, color in MURAL_PAINT.items():
        material(f"mural_{name}", color, 0.0, 0.7)


# ---------------------------------------------------------------------------
# service alley


def dumpster():
    """A steel bin with a sloping front, two plastic lids, lifting pins and four casters."""
    parts = []
    # The front leans out toward the top: from y = -0.42 at the bottom to -0.55 under the rim.
    lean = math.atan2(0.13, 1.04)
    front = lambda z: -0.42 - (z - 0.16) / 1.04 * 0.13
    parts.append(hull("bin", [(x, y, z) for x in (-0.88, 0.88) for y, z in ((0.5, 0.16), (-0.42, 0.16), (0.52, 1.2), (-0.55, 1.2))]
                      + [(x, y, z) for x in (-0.93, 0.93) for y, z in ((0.52, 1.2), (-0.55, 1.2))], "street_dumpster", bev=0.02))
    parts.append(box("rim", -0.96, 0.96, -0.58, 0.55, 1.17, 1.24, "street_dumpster", bev=0.012))
    # Two stiffening channels up the front, a band round the ends and the lifting pins.
    for i, x in enumerate((-0.62, 0.62)):
        parts.append(hull(f"channel{i}", [(x + dx, y, z) for dx in (-0.045, 0.045) for y, z in ((front(0.2), 0.2), (front(0.2) - 0.035, 0.2), (front(1.15), 1.15), (front(1.15) - 0.035, 1.15))], "street_dumpster"))
    for i, side in enumerate((-1, 1)):
        parts.append(box(f"band{i}", side * 0.9, side * 0.95, -0.5, 0.5, 0.62, 0.74, "street_dumpster"))
        parts.append(cylinder(f"pin{i}", 0.05, 0.12, (side * 0.99, 0.0, 0.85), "X", "street_steel", verts=10))
        parts.append(box(f"plate{i}", side * 0.92, side * 0.95, -0.12, 0.12, 0.74, 0.96, "street_steel"))
    # Lids: a wedge each, high at the hinges, with two ribs along their slope.
    slope = math.atan2(0.06, 1.16)
    for i, (x0, x1) in enumerate(((-0.95, -0.005), (0.005, 0.95))):
        parts.append(hull(f"lid{i}", [(x, y, z) for x in (x0, x1) for y, z in ((0.57, 1.24), (0.57, 1.33), (-0.6, 1.24), (-0.6, 1.27))], "street_lid", bev=0.01))
        parts.append(box(f"lip{i}", x0, x1, -0.62, -0.6, 1.2, 1.27, "street_lid"))
        for k, xr in enumerate((x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.7)):
            parts.append(turned_box(f"rib{i}{k}", (0.05, 1.08, 0.025), (xr, -0.02, 1.30 + 0.012), (slope, 0, 0), "street_lid"))
        parts.append(box(f"handle{i}", (x0 + x1) / 2 - 0.12, (x0 + x1) / 2 + 0.12, -0.66, -0.62, 1.22, 1.25, "street_lid"))
    for i, x in enumerate((-0.7, 0.0, 0.7)):
        parts.append(cylinder(f"hinge{i}", 0.025, 0.12, (x, 0.57, 1.3), "X", "street_steel", verts=8))
    # Casters: a swivel plate, a fork and a rubber wheel.
    for i, (x, y) in enumerate(((-0.74, -0.32), (0.74, -0.32), (-0.74, 0.36), (0.74, 0.36))):
        parts.append(box(f"swivel{i}", x - 0.07, x + 0.07, y - 0.07, y + 0.07, 0.14, 0.165, "street_steel"))
        parts.append(box(f"forkL{i}", x - 0.04, x - 0.03, y - 0.05, y + 0.05, 0.05, 0.14, "street_steel"))
        parts.append(box(f"forkR{i}", x + 0.03, x + 0.04, y - 0.05, y + 0.05, 0.05, 0.14, "street_steel"))
        parts.append(cylinder(f"wheel{i}", 0.065, 0.05, (x, y, 0.065), "X", "street_rubber", verts=12))
    # Stencilled lettering and rust, laid on the leaning front.
    def on_front(obj, z, out=0.002):
        obj.data.transform(Matrix.Translation((0, front(z) - out, z)) @ Matrix.Rotation(lean, 4, "X"))
        return obj
    parts.append(on_front(fit(text_mesh("name", "SOFA WASTE CO.", 0.13, "street_stencil", resolution=2), 1.0), 0.92))
    parts.append(on_front(fit(text_mesh("warning", "KEEP LIDS CLOSED", 0.07, "street_stencil", resolution=2), 0.9), 0.76))
    # Rust: ragged patches low down where water sits, and streaks run down from under the rim.
    rng = random.Random(4)
    for i, (x, z, r) in enumerate(((-0.42, 0.26, 0.11), (0.33, 0.22, 0.08), (0.78, 0.36, 0.06), (-0.8, 0.5, 0.05))):
        blot = [(x + px * rng.uniform(0.55, 1.35), pz * rng.uniform(0.55, 1.35)) for px, pz in ellipse(0.0, 0.0, r * 1.6, r, 0.0, 14)]
        parts.append(on_front(paint(f"rust{i}", blot, 0.0, "street_rust"), z, 0.0015))
    for i, x in enumerate((-0.86, -0.3, 0.12, 0.84)):
        length, width = rng.uniform(0.18, 0.42), rng.uniform(0.018, 0.035)
        streak = [(x - width / 2, 0.0), (x + width / 2, 0.0), (x + width * 0.2, -length), (x - width * 0.1, -length * 0.9)]
        parts.append(on_front(paint(f"streak{i}", streak, 0.0, "street_rust"), 1.15, 0.0015))
    return join(parts, "dumpster")


def pallet():
    """A 1.2 by 1.0 m timber pallet: three notched stringers, seven deck boards on top and three
    underneath, a few of them older and greyer."""
    parts, rng = [], random.Random(11)
    notched = [(-0.6, 0.018), (-0.6, 0.126), (0.6, 0.126), (0.6, 0.018), (0.38, 0.018), (0.38, 0.06), (0.14, 0.06),
               (0.14, 0.018), (-0.14, 0.018), (-0.14, 0.06), (-0.38, 0.06), (-0.38, 0.018)]
    for i, y in enumerate((-0.475, 0.0, 0.475)):
        parts.append(prism(f"stringer{i}", notched, y - 0.019, y + 0.019, "street_pallet_old" if i == 1 else "street_pallet"))
    for i in range(7):
        x = -0.53 + i * 1.06 / 6 + rng.uniform(-0.01, 0.01)
        mat = "street_pallet_old" if rng.random() < 0.3 else "street_pallet"
        board = box(f"top{i}", x - 0.07, x + 0.07, -0.5, 0.5, 0.126, 0.144, mat, bev=0.003, segments=1)
        board.data.transform(Matrix.Translation((x, 0, 0.135)) @ Matrix.Rotation(RAD(rng.uniform(-1.2, 1.2)), 4, "Z") @ Matrix.Translation((-x, 0, -0.135)))
        parts.append(board)
    for i, x in enumerate((-0.53, 0.0, 0.53)):
        parts.append(box(f"bottom{i}", x - 0.07, x + 0.07, -0.5, 0.5, 0.0, 0.018, "street_pallet", bev=0.003, segments=1))
    return join(parts, "pallet")


def manhole():
    """A cast-iron sewer cover in its frame: raised bars and a ring, lettered across the middle,
    the raised parts worn bright."""
    parts = [lathe("frame", [(0.43, 0.0), (0.43, 0.008), (0.355, 0.016), (0.355, 0.0)], "street_iron", verts=32),
             cylinder("cover", 0.35, 0.016, (0, 0, 0.008), "Z", "street_iron", verts=32),
             lathe("ring", [(0.312, 0.016), (0.312, 0.02), (0.33, 0.02), (0.33, 0.016)], "street_iron_worn", verts=32)]
    sewer = text_mesh("sewer", "SEWER", 0.1, "street_iron_worn", extrude=0.004, resolution=2)
    sewer.data.transform(Matrix.Translation((0, 0, 0.016)) @ Matrix.Rotation(RAD(-90), 4, "X"))
    parts.append(sewer)
    for i, y in enumerate([0.085 + k * 0.038 for k in range(6)]):
        for side in (-1, 1):
            half = math.sqrt(max(0.0, 0.3 ** 2 - y ** 2))
            parts.append(box(f"bar{i}{side}", -half, half, side * y - 0.007, side * y + 0.007, 0.016, 0.02, "street_iron_worn"))
    for i, x in enumerate((-0.24, 0.24)):
        parts.append(cylinder(f"pick{i}", 0.018, 0.004, (x, 0, 0.0145), "Z", "street_cable", verts=8))
    return join(parts, "manhole")


# ---------------------------------------------------------------------------
# rooftops


def water_tank():
    """A cedar water tank on a steel stand: fluted staves held by iron hoops, a shingled cone
    roof, X-braced legs, timber joists, an outlet pipe with a valve and a ladder up the front."""
    parts = []
    corners = ((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8))
    for i, (x, y) in enumerate(corners):
        parts.append(box(f"leg{i}", x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.0, 1.42, "street_steel"))
        parts.append(box(f"foot{i}", x - 0.12, x + 0.12, y - 0.12, y + 0.12, 0.0, 0.02, "street_steel"))
    for i in range(4):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
        parts.append(tube(f"braceA{i}", [(ax, ay, 0.12), (bx, by, 1.32)], 0.016, "street_steel", verts=4))
        parts.append(tube(f"braceB{i}", [(bx, by, 0.12), (ax, ay, 1.32)], 0.016, "street_steel", verts=4))
    for i, x in enumerate((-0.8, 0.8)):
        parts.append(box(f"girder{i}", x - 0.07, x + 0.07, -1.0, 1.0, 1.42, 1.54, "street_steel"))
    for i, y in enumerate((-0.66, -0.22, 0.22, 0.66)):
        parts.append(box(f"joist{i}", -1.12, 1.12, y - 0.06, y + 0.06, 1.54, 1.6, "street_cedar_dark"))
    radius = lambda z: 1.17 - 0.05 * (z - 1.6) / 2.0
    parts.append(lathe("staves", [(radius(1.6), 1.6), (radius(2.6), 2.6), (radius(3.58), 3.58)], "street_cedar", verts=48, ribs=24, rib_depth=0.008, cap_bottom=True))
    for i, z in enumerate((1.72, 1.95, 2.22, 2.55, 2.95, 3.4)):
        r = radius(z) / math.cos(math.pi / 24) + 0.004
        parts.append(lathe(f"hoop{i}", [(r - 0.02, z - 0.014), (r, z - 0.014), (r, z + 0.014), (r - 0.02, z + 0.014)], "street_hoop", verts=24))
    parts.append(lathe("roof", [(1.25, 3.54), (1.25, 3.6), (0.06, 4.2)], "street_cedar_dark", verts=48, ribs=24, rib_depth=0.012, cap_top=True))
    parts.append(cylinder("soffit", 1.25, 0.01, (0, 0, 3.545), "Z", "street_cedar_dark", verts=24))
    parts.append(cylinder("finial_post", 0.03, 0.12, (0, 0, 4.24), "Z", "street_hoop", verts=6))
    parts.append(sphere("finial", 0.055, (0, 0, 4.32), "street_hoop", segments=8, rings=5))
    # Outlet pipe down to the roof, with a gate valve.
    parts.append(tube("outlet", [(0.35, 0.3, 1.6), (0.35, 0.3, 0.35), (0.35, 0.55, 0.12), (0.35, 1.25, 0.12)], 0.06, "street_hoop", verts=8))
    parts.append(cylinder("valve", 0.085, 0.14, (0.35, 0.3, 0.9), "Z", "street_steel", verts=8))
    parts.append(cylinder("wheel", 0.1, 0.02, (0.35, 0.3, 1.02), "Z", "street_steel", verts=10))
    # A ladder up the front, standing off the hoops.
    for i, x in enumerate((-0.2, 0.2)):
        parts.append(box(f"rail{i}", x - 0.02, x + 0.02, -1.35, -1.31, 0.0, 3.85, "street_steel"))
        for k, z in enumerate((1.9, 3.3)):
            parts.append(box(f"stay{i}{k}", x - 0.012, x + 0.012, -1.33, -radius(z) + 0.02, z - 0.012, z + 0.012, "street_steel"))
    for k in range(12):
        parts.append(cylinder(f"rung{k}", 0.012, 0.4, (0, -1.33, 0.3 + k * 0.3), "X", "street_steel", verts=4))
    return join(parts, "water_tank")


def antenna():
    """A roof TV antenna on a 4 m mast: a tripod foot, a Yagi near the top, and its cable."""
    parts = [cylinder("mast", 0.025, 3.98, (0, 0, 2.0), "Z", "street_galv", verts=8),
             cylinder("cap", 0.03, 0.03, (0, 0, 3.995), "Z", "street_cable", verts=8)]
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.3
        foot = (math.cos(a) * 0.45, math.sin(a) * 0.45)
        parts.append(tube(f"leg{i}", [(foot[0], foot[1], 0.02), (0, 0, 0.75)], 0.012, "street_galv", verts=4))
        parts.append(box(f"pad{i}", foot[0] - 0.05, foot[0] + 0.05, foot[1] - 0.05, foot[1] + 0.05, 0.0, 0.02, "street_galv"))
    # The Yagi: a boom pointing along -Y, a reflector behind the dipole and directors ahead.
    z = 3.2
    parts.append(cylinder("boom", 0.014, 1.72, (0, -0.3, z), "Y", "street_galv", verts=6))
    parts.append(box("clamp", -0.04, 0.04, -0.04, 0.04, z - 0.06, z + 0.06, "street_galv"))
    for i, (y, length) in enumerate(((0.52, 1.1), (0.0, 0.62), (-0.28, 0.58), (-0.54, 0.54), (-0.8, 0.5), (-1.06, 0.46))):
        parts.append(cylinder(f"element{i}", 0.006, length, (0, y, z), "X", "street_galv", verts=4))
    parts.append(cylinder("dipole_l", 0.008, 0.36, (-0.2, 0.26, z), "X", "street_galv", verts=4))
    parts.append(cylinder("dipole_r", 0.008, 0.36, (0.2, 0.26, z), "X", "street_galv", verts=4))
    parts.append(box("balun", -0.04, 0.04, 0.22, 0.3, z - 0.05, z + 0.01, "street_cable"))
    parts.append(tube("cable", [(0.0, 0.26, z - 0.05), (0.03, 0.05, z - 0.25), (0.035, 0.0, z - 0.6), (0.035, 0.0, 0.5), (0.2, 0.25, 0.05), (0.6, 0.6, 0.02)], 0.006, "street_cable", verts=4))
    return join(parts, "antenna")


# ---------------------------------------------------------------------------
# posters and the mural


def poster(entry):
    """A paper poster: a big first line and smaller ones under it over an accent disc, taped up
    at the top, with one bottom corner peeling off the wall and a slight tilt."""
    w, h, pid = 0.62, 0.88, entry["id"]
    rng = random.Random(pid)
    corner = rng.choice((-1, 1))
    # How far a point lifts off the wall: nothing outside a 13 cm triangle at the peeling corner.
    def lift(x, z):
        d = (corner * x - w / 2) / 0.13 + (-z - h / 2) / 0.13 + 1
        return -0.035 * max(0.0, d) ** 2

    def peel(obj):
        for v in obj.data.vertices:
            v.co.y += lift(v.co.x, v.co.z)
        return obj

    xs, zs = [-0.31, -0.24, -0.17, 0.0, 0.17, 0.24, 0.31], [-0.44, -0.37, -0.3, -0.1, 0.1, 0.3, 0.37, 0.44]
    bm = bmesh.new()
    grid = [[bm.verts.new((x, -0.0015 + rng.uniform(-0.0006, 0.0), z)) for x in xs] for z in zs]
    for r in range(len(zs) - 1):
        for c in range(len(xs) - 1):
            bm.faces.new((grid[r][c], grid[r + 1][c], grid[r + 1][c + 1], grid[r][c + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    paper = mesh_object("paper", bm, f"poster_{pid}_paper")
    solid = paper.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness, solid.offset = 0.0015, -1
    apply_modifiers(paper)
    parts = [peel(paper), peel(paint("accent", ellipse(0.136, 0.176, 0.17, 0.17, 0.0, 28), -0.0035, f"poster_{pid}_accent"))]
    for i, line in enumerate(entry["lines"]):
        size = 0.14 if i == 0 else 0.073
        middle = -0.056 if i == 0 else (-0.234 if i == 1 else -0.331)
        text = fit(text_mesh(f"line{i}", line, size, f"poster_{pid}_ink", align="LEFT", resolution=2), 0.55)
        lo, hi = min(v.co.z for v in text.data.vertices), max(v.co.z for v in text.data.vertices)
        move(text, (-0.271, -0.0045, middle - (lo + hi) / 2))
        parts.append(peel(text))
    for i, side in enumerate((-1, 1)):
        parts.append(turned_box(f"tape{i}", (0.085, 0.0008, 0.028), (side * (w / 2 - 0.02), -0.0042, h / 2 - 0.016), (0, side * RAD(38), 0), "poster_tape"))
    other = -corner * (w / 2 - 0.02)
    parts.append(turned_box("tape_low", (0.085, 0.0008, 0.028), (other, -0.0042, -h / 2 + 0.016), (0, corner * RAD(38), 0), "poster_tape"))
    obj = join(parts, f"poster_{pid}")
    obj.data.transform(Matrix.Rotation(RAD(rng.uniform(-2.2, 2.2)), 4, "Y"))
    return obj


def mural():
    """The SOFA mural sprayed on the service alley wall: a dark ground, four colour blobs, the
    word in cream with a black outline and a pink offset line, and drips running down."""
    W, H = 5.6, 2.8
    # Positions as fractions of the mural's width and height from its top left, like the
    # painter's sketch.
    at = lambda u, v: (u * W - W / 2, H / 2 - v * H)
    rng = random.Random(21)
    edge = []
    for (u0, v0), (u1, v1) in (((0, 0), (1, 0)), ((1, 0), (1, 1)), ((1, 1), (0, 1)), ((0, 1), (0, 0))):
        for k in range(14):
            x, z = at(u0 + (u1 - u0) * k / 14, v0 + (v1 - v0) * k / 14)
            edge.append((x + rng.uniform(-0.012, 0.012), z + rng.uniform(-0.012, 0.012)))
    parts = [paint("ground", edge, -0.002, "mural_ground")]
    blobs = ((0.15, 0.6, 0.28, "pink"), (0.42, 0.35, 0.24, "amber"), (0.7, 0.62, 0.3, "teal"), (0.9, 0.3, 0.2, "violet"))
    for i, (u, v, r, colour) in enumerate(blobs):
        x, z = at(u, v)
        shape = clip(ellipse(x, z, r * W * 0.6, r * H * 0.9, -0.4, 32), -W / 2 + 0.03, W / 2 - 0.03, -H / 2 + 0.03, H / 2 - 0.03)
        parts.append(paint(f"blob{i}", shape, -0.004 - i * 0.002, f"mural_{colour}"))
    # Spray mist round the blobs.
    for i in range(36):
        u, v, r, colour = blobs[i % 4]
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(1.0, 1.25)
        x, z = at(u, v)
        x, z = x + math.cos(a) * r * W * 0.6 * d, z + math.sin(a) * r * H * 0.9 * d
        if abs(x) < W / 2 - 0.05 and abs(z) < H / 2 - 0.05:
            parts.append(paint(f"mist{i}", ellipse(x, z, rng.uniform(0.008, 0.022), rng.uniform(0.008, 0.022), 0.0, 6), -0.012, f"mural_{colour}"))
    # The word: an ink outline, cream letters and a pink line set off down and to the right.
    size, middle, width = 1.58, H / 2 - 0.52 * H, 3.7
    fill = text_mesh("fill", "SOFA", size, "mural_cream", resolution=3, spacing=1.05)
    xs = [v.co.x for v in fill.data.vertices]
    zs = [v.co.z for v in fill.data.vertices]
    cx, cz, stretch = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, width / (max(xs) - min(xs))
    place = lambda y, dx=0.0, dz=0.0: Matrix.Translation((dx, y, middle + dz)) @ Matrix.Diagonal((stretch, 1, 1, 1)) @ Matrix.Translation((-cx, 0, -cz))
    outline = text_mesh("outline", "SOFA", size, "mural_ink", resolution=3, spacing=1.05, offset=0.05)
    outline.data.transform(place(-0.016))
    fill.data.transform(place(-0.018))
    line = text_mesh("line", "SOFA", size, "mural_pink", neon=0.012, resolution=3, spacing=1.05, tube_sides=4)
    line.data.transform(Matrix.Diagonal((1, 0.12, 1, 1)))
    line.data.transform(place(-0.0215, 0.044, -0.044))
    parts += [outline, fill, line]
    # Drips running down from the bottom of the paint.
    for i in range(24):
        x, top = at(rng.random(), 0.75)
        bottom = top - rng.uniform(20, 80) / 384 * H
        colour = blobs[i % 4][3]
        shape = [(x - 0.011, top), *[(x + math.cos(RAD(a)) * 0.013, bottom + math.sin(RAD(a)) * 0.013) for a in range(180, 361, 30)], (x + 0.011, top)]
        parts.append(paint(f"drip{i}", shape, -0.014, f"mural_{colour}"))
    return join(parts, "mural")


PIECES = [
    Piece("dumpster", dumpster, 2600, (2.1, 1.25, 1.35), "base", "Four in the service alley, backs to the wall; the map's box stays as the collider."),
    Piece("pallet", pallet, 900, (1.22, 1.02, 0.144), "base", "A stack of two by the service alley door."),
    Piece("manhole", manhole, 1400, (0.86, 0.86, 0.02), "base", "In the service alley."),
    Piece("water_tank", water_tank, 2800, (2.5, 2.6, 4.38), "base", "Five on the roofs along the alleys.", 10),
    Piece("antenna", antenna, 700, (1.15, 1.76, 4.01), "base", "Five on the roofs, stretched to each mast's height.", 30),
    *[Piece(f"poster_{p['id']}", (lambda p=p: poster(p)), 2400, (0.64, 0.05, 0.9), "wall", "Pasted on a wall.") for p in POSTERS],
    Piece("mural", mural, 7000, (5.6, 0.03, 2.8), "wall", "The SOFA mural in the service alley."),
]
