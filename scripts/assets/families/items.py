"""Items in the world: the stands guns wait on, spare and dropped magazines, spent cases and
thrown grenades. Built into public/models/items.glb by scripts/assets/build.py, at real size.

Frames, matching how the game moves each one:
  pickup_stand      stands on the floor, its glowing ring (glow_ring) lit by the game.
  magazine_*        feed lips at the origin, the body hanging down (-Z), its front toward +Y
                    (the game's -Z, where the barrel points); the pistol's leans back with
                    the grip.
  case_*            a spent case standing on its base, centred on the origin, its axis along Z.
  grenade_*         centred on the origin, fuze up, the lever down the +X side.
"""

import math

import bmesh
from mathutils import Matrix

from lib import (RAD, Piece, box, cylinder, hull, join, lathe, material, mesh_object, move, paint, prism, text_mesh)


def materials():
    material("items_stand", 0x192e34, 0.4, 0.65)
    material("items_stand_rim", 0x2b3f45, 0.6, 0.45)
    material("items_rubber", 0x111416, 0.0, 0.9)
    material("items_bolt", 0x8f989c, 0.9, 0.35)
    material("glow_ring", 0x59d3d0, 0.35, 0.34)
    material("items_mag_steel", 0x26292c, 0.75, 0.42)
    material("items_mag_plate", 0x18191a, 0.4, 0.6)
    material("items_hole", 0x0a0a0b, 0.0, 0.9)
    material("items_brass", 0xd2a650, 1.0, 0.34)
    material("items_primer", 0xb9b4a8, 1.0, 0.3)
    material("items_lacquer", 0x77684a, 0.7, 0.45)
    material("items_copper", 0xb8733a, 1.0, 0.3)
    material("items_olive", 0x3f4a33, 0.3, 0.55)
    material("items_yellow", 0xc9a227, 0.1, 0.6)
    material("items_fuze", 0x9a9c94, 0.8, 0.4)
    material("items_smoke_can", 0x4a5246, 0.3, 0.6)
    material("items_band", 0xe8e6de, 0.0, 0.7)


# ---------------------------------------------------------------------------
# the gun stand


def pickup_stand():
    """A low steel plinth with a glowing ring in a channel round a ribbed rubber mat, bolted
    down: what a gun pickup spins above."""
    parts = [lathe("base", [(0.6, 0.0), (0.6, 0.014), (0.578, 0.04), (0.56, 0.072), (0.545, 0.085), (0.5, 0.085), (0.5, 0.072),
                            (0.42, 0.072), (0.42, 0.085)], "items_stand", verts=32, cap_bottom=True),
             lathe("rim", [(0.601, 0.012), (0.606, 0.016), (0.606, 0.03), (0.594, 0.034)], "items_stand_rim", verts=32),
             lathe("ring", [(0.497, 0.073), (0.497, 0.08), (0.423, 0.08), (0.423, 0.073)], "glow_ring", verts=32),
             lathe("mat", [(0.42, 0.085), (0.4, 0.088)], "items_rubber", verts=32, cap_top=True)]
    for i in range(16):
        a = 2 * math.pi * i / 16
        rib = box(f"rib{i}", -0.008, 0.008, 0.06, 0.37, 0.088, 0.093, "items_rubber")
        rib.data.transform(Matrix.Rotation(a, 4, "Z"))
        parts.append(rib)
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        parts.append(cylinder(f"bolt{i}", 0.011, 0.008, (math.cos(a) * 0.523, math.sin(a) * 0.523, 0.089), "Z", "items_bolt", verts=6))
    return join(parts, "pickup_stand")


# ---------------------------------------------------------------------------
# magazines and cartridges


def cartridge(name, case_radius, case_length, neck_radius, bullet_length, case_mat, origin, rifle):
    """A loaded round lying along +Y with its base at `origin`: a case (bottlenecked for the
    rifle) and a pointed copper bullet."""
    if rifle:
        shoulder = case_length * 0.79
        profile = [(case_radius, 0.0), (case_radius * 0.9, case_length * 0.7), (case_radius * 0.88, shoulder),
                   (neck_radius, shoulder + case_length * 0.05), (neck_radius, case_length)]
    else:
        profile = [(case_radius, 0.0), (case_radius * 0.97, case_length)]
    case = lathe(f"{name}_case", profile, case_mat, verts=8, cap_bottom=True)
    tip = neck_radius * 0.92
    bullet = lathe(f"{name}_bullet", [(tip, case_length), (tip, case_length + bullet_length * 0.35), (tip * 0.55, case_length + bullet_length * 0.8),
                                      (tip * 0.12, case_length + bullet_length)], "items_copper", verts=8, cap_top=True)
    round_ = join([case, bullet], name)
    # Lathes turn about Z; lay it along +Y and move its base to `origin`.
    round_.data.transform(Matrix.Translation(origin) @ Matrix.Rotation(RAD(-90), 4, "X"))
    return round_


def magazine_pistol():
    """A double-stack 9 mm magazine: a steel body narrowing to the feed lips, witness holes up
    the back, a base plate and the top round showing."""
    parts = [hull("body", [(x * s, y, z) for x in (-1, 1) for s, y, z in
                           ((0.0115, -0.016, -0.118), (0.0115, 0.016, -0.118), (0.011, -0.016, -0.012), (0.011, 0.016, -0.012),
                            (0.0085, -0.014, 0.0), (0.0085, 0.012, 0.0))], "items_mag_steel", bev=0.0012),
             box("base", -0.013, 0.013, -0.018, 0.021, -0.126, -0.1175, "items_mag_plate", bev=0.0015)]
    for i, z in enumerate((-0.032, -0.052, -0.072, -0.092)):
        hole = [(math.cos(a) * 0.0018, z + math.sin(a) * 0.0018) for a in (2 * math.pi * k / 6 for k in range(6))]
        parts.append(paint(f"hole{i}", hole, -0.0162, "items_hole"))
    parts.append(cartridge("round", 0.0049, 0.0192, 0.0048, 0.0105, "items_brass", (0.0, -0.0125, 0.0038), False))
    obj = join(parts, "magazine_pistol")
    # The grip's rake: the base sits back from the lips.
    obj.data.transform(Matrix.Rotation(-0.18, 4, "X"))
    return obj


def magazine_rifle():
    """The carbine's curved 30-round steel magazine: an octagonal section swept along an arc
    that bows forward, stamped ribs round it, a base plate, the locking lug and rear catch, and
    the top round in the lips."""
    radius, sweep, segments = 0.42, 0.52, 22
    ribs = (0.16, 0.3, 0.44, 0.58, 0.72, 0.86)
    bm = bmesh.new()
    rings = []
    for k in range(segments + 1):
        t = k / segments
        a = sweep * t
        cy, cz = radius * (1 - math.cos(a)), -radius * math.sin(a)
        ny, nz = math.cos(a), math.sin(a)
        half = (0.056 + 0.016 * t) / 2
        # Ribs pressed into the sides only, as on a stamped steel magazine.
        w, d, c = 0.0145 + (0.0009 if any(abs(t - r) < 0.02 for r in ribs) else 0.0), half, 0.004
        section = [(w, d - c), (w - c, d), (-w + c, d), (-w, d - c), (-w, -d + c), (-w + c, -d), (w - c, -d), (w, -d + c)]
        rings.append([bm.verts.new((u, cy + ny * v, cz + nz * v)) for u, v in section])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(8):
            bm.faces.new((r0[i], r0[(i + 1) % 8], r1[(i + 1) % 8], r1[i]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = mesh_object("body", bm, "items_mag_steel")
    # The base plate follows the bottom's turn.
    a = sweep
    by, bz = radius * (1 - math.cos(a)), -radius * math.sin(a)
    plate = box("plate", -0.0165, 0.0165, -0.039, 0.039, -0.008, 0.0, "items_mag_plate", bev=0.0015)
    plate.data.transform(Matrix.Translation((0, by, bz)) @ Matrix.Rotation(a, 4, "X"))
    parts = [body, plate,
             box("lug", -0.008, 0.008, 0.026, 0.034, -0.016, -0.002, "items_mag_steel"),
             box("catch", -0.009, 0.009, -0.034, -0.026, -0.024, -0.01, "items_mag_steel"),
             cartridge("round", 0.0057, 0.0386, 0.0043, 0.0185, "items_lacquer", (0.0, -0.027, 0.0055), True)]
    return join(parts, "magazine_rifle")


def spent_case(name, profile, mat, length):
    """An empty case standing on its base, centred: rim, extractor groove, wall and an open
    mouth, the primer showing underneath."""
    outer = [(r, z - length / 2) for r, z in profile]
    mouth = profile[-1][0]
    inner = [(mouth * 0.88, length / 2), (mouth * 0.88, length / 2 - length * 0.18)]
    case = lathe("case", outer + inner, mat, verts=12, cap_bottom=True, cap_top=True)
    primer = cylinder("primer", profile[0][0] * 0.42, 0.0004, (0, 0, -length / 2 - 0.0001), "Z", "items_primer", verts=8)
    return join([case, primer], name)


def case_pistol():
    """A fired 9x19 mm brass case."""
    r, length = 0.00495, 0.0192
    return spent_case("case_pistol", [(r, 0.0), (r, 0.0012), (0.0042, 0.0016), (0.0042, 0.0024), (0.0049, 0.003), (0.0048, length)], "items_brass", length)


def case_rifle():
    """A fired 7.62x39 mm lacquered steel case, bottlenecked."""
    r, length = 0.0056, 0.0386
    return spent_case("case_rifle", [(r, 0.0), (r, 0.0015), (0.0047, 0.002), (0.0047, 0.0031), (0.0056, 0.0037), (0.0050, 0.0302),
                                     (0.0043, 0.0318), (0.0043, length)], "items_lacquer", length)


# ---------------------------------------------------------------------------
# grenades


def fuze(z0):
    """A grenade fuze from z0 up: its body, a chamfered cap and the striker housing on +X."""
    body = cylinder("fuze", 0.011, 0.02, (0, 0, z0 + 0.01), "Z", "items_fuze", verts=10)
    cap = cylinder("fuze_cap", 0.013, 0.006, (0, 0, z0 + 0.023), "Z", "items_fuze", verts=10, radius2=0.010)
    housing = box("striker", 0.008, 0.016, -0.006, 0.006, z0 + 0.004, z0 + 0.02, "items_fuze")
    return [body, cap, housing]


def lever(points, width=0.012, thickness=0.0018):
    """A spoon lever as a strip following (x, z) points down the outside of a grenade."""
    outer, inner = [], []
    for i, (x, z) in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, tz)
        nx, nz = tz / length, -tx / length
        outer.append((x + nx * thickness / 2, z + nz * thickness / 2))
        inner.append((x - nx * thickness / 2, z - nz * thickness / 2))
    return prism("lever", outer + inner[::-1], -width / 2, width / 2, "items_fuze")


def grenade_frag():
    """A fragmentation grenade: an olive steel egg with a yellow band, its fuze and lever."""
    profile = [(0.012, -0.055), (0.03, -0.05), (0.042, -0.035), (0.046, -0.01), (0.045, 0.015), (0.038, 0.035), (0.026, 0.048), (0.014, 0.053)]
    body = lathe("body", profile, "items_olive", verts=16, cap_bottom=True, cap_top=True)
    band = lathe("band", [(0.0423, 0.024), (0.0398, 0.031)], "items_yellow", verts=16)
    band.data.transform(Matrix.Diagonal((1.025, 1.025, 1, 1)))
    lever_path = [(0.006, 0.079), (0.016, 0.0795), (0.022, 0.072), (0.026, 0.058), (0.029, 0.048), (0.04, 0.035), (0.047, 0.015), (0.048, -0.01), (0.047, -0.02)]
    return join([body, band, *fuze(0.053), lever(lever_path)], "grenade_frag")


def wrap(obj, radius):
    """Bends a flat decal in the XZ plane at y = -radius round a cylinder of that radius about Z."""
    for v in obj.data.vertices:
        r = -v.co.y
        a = v.co.x / radius
        v.co.x, v.co.y = math.sin(a) * r, -math.cos(a) * r
    return obj


def grenade_smoke():
    """A smoke grenade: a grey-green can with rolled rims, a white band, SMOKE stencilled on
    it, emission holes in the top, and the fuze and lever."""
    r, h = 0.032, 0.13
    can = lathe("can", [(r * 0.94, -h / 2), (r, -h / 2 + 0.004), (r, h / 2 - 0.004), (r * 0.94, h / 2)], "items_smoke_can", verts=16, cap_bottom=True, cap_top=True)
    rims = [lathe(f"rim{i}", [(r + 0.0015, z - 0.002), (r + 0.0015, z + 0.002)], "items_smoke_can", verts=16) for i, z in enumerate((-h / 2 + 0.006, h / 2 - 0.006))]
    band = lathe("band", [(r + 0.0006, -0.015), (r + 0.0006, 0.015)], "items_band", verts=16)
    word = text_mesh("word", "SMOKE", 0.017, "items_band", resolution=1)
    move(word, (0, -(r + 0.0008), -0.035))
    wrap(word, r + 0.0008)
    holes = [cylinder(f"hole{i}", 0.0045, 0.0006, (math.cos(a) * 0.021, math.sin(a) * 0.021, h / 2 + 0.0002), "Z", "items_hole", verts=6)
             for i, a in enumerate((2 * math.pi * k / 4 + 0.785 for k in range(4)))]
    lever_path = [(0.006, h / 2 + 0.026), (0.02, h / 2 + 0.027), (0.031, h / 2 + 0.015), (0.0345, h / 2 - 0.005), (0.0345, -0.02)]
    return join([can, *rims, band, word, *holes, *fuze(h / 2), lever(lever_path)], "grenade_smoke")


PIECES = [
    Piece("pickup_stand", pickup_stand, 1600, (1.212, 1.212, 0.093), "base", "Under each gun pickup; the ring glows."),
    Piece("magazine_pistol", magazine_pistol, 500, None, None, "Spare and dropped 9 mm magazines."),
    Piece("magazine_rifle", magazine_rifle, 900, None, "top", "Spare and dropped carbine magazines.", 30),
    Piece("case_pistol", case_pistol, 250, (0.0099, 0.0099, 0.0194), "center", "Spent 9 mm cases.", 60),
    Piece("case_rifle", case_rifle, 300, (0.0112, 0.0112, 0.0388), "center", "Spent carbine cases.", 60),
    Piece("grenade_frag", grenade_frag, 800, None, "center", "A thrown frag grenade.", 50),
    Piece("grenade_smoke", grenade_smoke, 900, None, "center", "A thrown smoke grenade.", 50),
]
