"""Building dressing: the window units on every upper floor, the cornices and string courses
along the facades, the roller shutters closing the alleys' ends, the pilasters and ledges framing
the shopfronts, railings, the steel ladders and the bar's stair, and the cards that carry
pictures: window glass, shop glass and the storefront photographs. Built into
public/models/buildings.glb by scripts/assets/build.py.

The walls and the ground themselves stay as the map's own surfaces, with their photographed
textures and baked light; these pieces are what stands on them.

Frames:
  window_unit, cornice, string_course, shutter, shop_pilaster, shop_ledge
                 back onto a wall at y = 0, facing -Y. A window is centred on its glass; the
                 rest stand on z = 0. Cornices, string courses and ledges are 1 m long and the
                 game stretches them along the wall.
  rail_bar, stair_stringer
                 1 m along X, centred; stretched to length.
  rail_post, ladder_rail
                 1 m tall from z = 0; stretched to height.
  ladder_rung, stair_tread
                 centred, the rung along X, the tread 1.3 m across X and its run along Y.
  card_*         a flat face toward -Y with texture coordinates from 0 to 1: the game draws
                 it with its own picture (a room behind a window, a storefront) or as glass.
"""

import math

import bmesh
from mathutils import Matrix

from lib import RAD, Piece, box, cylinder, hull, join, material, mesh_object, prism, ring, tube


def materials():
    material("bld_frame", 0xcfc6b4, 0.0, 0.7)
    material("bld_sash", 0x2a2622, 0.2, 0.6)
    material("bld_stone", 0xd8d0c0, 0.0, 0.85)
    material("bld_trim", 0xcfc8ba, 0.0, 0.85)
    material("bld_recess", 0x07090c, 0.0, 1.0)
    material("bld_shutter", 0x7d8287, 0.5, 0.5)
    material("bld_shutter_dark", 0x4a4e52, 0.6, 0.45)
    material("bld_rust", 0x5e3420, 0.2, 0.85)
    material("bld_lock", 0xb08a3c, 0.9, 0.35)
    material("bld_shop", 0x23282a, 0.2, 0.55)
    material("bld_steel", 0x3d4447, 0.75, 0.55)
    material("bld_rail", 0x22262a, 0.5, 0.6)
    material("bld_grating", 0x4b5254, 0.6, 0.7)
    material("bld_checker", 0x6a7174, 0.8, 0.45)
    material("card_window", 0xffffff, 0.0, 0.1)
    material("card_unit", 0xffffff, 0.0, 0.1)


def moulding(name, profile, mat, length=1.0):
    """A moulding: (out, z) points of its section, out <= 0 away from the wall, run along X
    for `length`, centred."""
    obj = prism(name, profile, -length / 2, length / 2, mat)
    # The section was drawn in XZ and run along Y; turn it so it runs along X with out along Y.
    obj.data.transform(Matrix.Rotation(RAD(90), 4, "Z"))
    return obj


# ---------------------------------------------------------------------------
# windows


def window_unit():
    """A sash window set in the wall: a painted frame with an inner casing, a dark reveal behind
    the glass, sash bars crossing in front of it, a stone sill on corbels and a lintel with a
    keystone over it. The glass is the card_window card, set 6 cm out."""
    W, H, w, h = 1.62, 2.0, 1.38, 1.76
    parts = []
    # The frame: four boards round the opening, and a narrower casing inside them.
    for i, (x0, x1, z0, z1) in enumerate(((-W / 2, W / 2, h / 2, H / 2), (-W / 2, W / 2, -H / 2, -h / 2), (-W / 2, -w / 2, -h / 2, h / 2), (w / 2, W / 2, -h / 2, h / 2))):
        parts.append(box(f"frame{i}", x0, x1, -0.045, 0.0, z0, z1, "bld_frame"))
    c = 0.035
    for i, (x0, x1, z0, z1) in enumerate(((-w / 2, w / 2, h / 2 - c, h / 2), (-w / 2, w / 2, -h / 2, -h / 2 + c), (-w / 2, -w / 2 + c, -h / 2 + c, h / 2 - c), (w / 2 - c, w / 2, -h / 2 + c, h / 2 - c))):
        parts.append(box(f"casing{i}", x0, x1, -0.07, -0.045, z0, z1, "bld_frame"))
    parts.append(box("reveal", -w / 2, w / 2, -0.032, -0.03, -h / 2, h / 2, "bld_recess"))
    # Sash bars in front of the glass: a muntin up the middle and the meeting rail.
    parts.append(box("muntin", -0.025, 0.025, -0.105, -0.065, -h / 2 + c, h / 2 - c, "bld_sash"))
    parts.append(box("rail", -w / 2 + c, w / 2 - c, -0.105, -0.065, 0.275, 0.325, "bld_sash"))
    parts.append(box("sash_bottom", -w / 2 + c, w / 2 - c, -0.09, -0.065, -h / 2 + c, -h / 2 + c + 0.04, "bld_sash"))
    # Stone sill sloping out to shed rain, on two small corbels.
    parts.append(hull("sill", [(x, y, z) for x in (-0.9, 0.9) for y, z in ((0.0, -1.095), (0.0, -1.005), (-0.2, -1.095), (-0.2, -1.03))], "bld_stone"))
    for i, x in enumerate((-0.72, 0.72)):
        parts.append(hull(f"corbel{i}", [(x + dx, y, z) for dx in (-0.06, 0.06) for y, z in ((0.0, -1.095), (-0.15, -1.095), (0.0, -1.24))], "bld_stone"))
    # Lintel and keystone.
    parts.append(box("lintel", -0.9, 0.9, -0.08, 0.0, 1.0, 1.16, "bld_trim"))
    parts.append(hull("keystone", [(x, y, z) for y in (0.0, -0.11) for x, z in ((-0.09, 0.98), (0.09, 0.98), (-0.12, 1.22), (0.12, 1.22))], "bld_trim"))
    return join(parts, "window_unit")


def card(name, width, height, mat):
    """A flat face toward -Y, centred, with texture coordinates from 0 to 1 across it."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    face = bm.faces.new([bm.verts.new((x, 0.0, z)) for x, z in ((-width / 2, -height / 2), (width / 2, -height / 2), (width / 2, height / 2), (-width / 2, height / 2))])
    for loop in face.loops:
        loop[uv].uv = (loop.vert.co.x / width + 0.5, loop.vert.co.z / height + 0.5)
    return mesh_object(name, bm, mat)


def card_window():
    """The window glass: the game shows a dark pane or a lit room on it."""
    return card("card_window", 1.38, 1.76, "card_window")


def card_unit():
    """A 1 m square card, stretched by the game for shop glass and storefront photographs."""
    return card("card_unit", 1.0, 1.0, "card_unit")


# ---------------------------------------------------------------------------
# facade mouldings and shopfronts


CORNICE = [(0.0, 0.0), (-0.045, 0.0), (-0.045, 0.035), (-0.08, 0.05), (-0.13, 0.1), (-0.18, 0.17), (-0.23, 0.23), (-0.29, 0.265),
           (-0.29, 0.39), (-0.27, 0.405), (-0.27, 0.43), (-0.2, 0.45), (0.0, 0.45)]
STRING = [(0.0, 0.0), (-0.06, 0.0), (-0.09, 0.03), (-0.09, 0.135), (-0.075, 0.15), (-0.06, 0.18), (0.0, 0.18)]


def cornice():
    """The roofline cornice: a cove rising to a deep corona and a sloped cap."""
    return moulding("cornice", CORNICE, "bld_trim")


def string_course():
    """The band under the first row of windows: a chamfered stone course."""
    return moulding("string_course", STRING, "bld_trim")


def shop_pilaster():
    """A painted pilaster at the side of a shopfront: a plinth, a fluted shaft and a capital."""
    parts = [box("plinth", -0.15, 0.15, -0.12, 0.0, 0.0, 0.5, "bld_shop"),
             box("shaft", -0.12, 0.12, -0.09, 0.0, 0.5, 3.0, "bld_shop"),
             hull("capital", [(x, y, z) for x in (-0.15, 0.15) for y, z in ((0.0, 3.0), (-0.09, 3.0), (0.0, 3.32), (-0.13, 3.22), (-0.13, 3.32))], "bld_shop")]
    for i, x in enumerate((-0.06, 0.0, 0.06)):
        parts.append(box(f"flute{i}", x - 0.012, x + 0.012, -0.1, -0.09, 0.62, 2.88, "bld_recess"))
    return join(parts, "shop_pilaster")


def shop_ledge():
    """A moulded ledge between a shopfront and its sign."""
    return moulding("shop_ledge", [(0.0, 0.0), (-0.06, 0.0), (-0.1, 0.03), (-0.1, 0.07), (-0.08, 0.09), (0.0, 0.09)], "bld_shop")


def shutter():
    """A roller shutter 6 m wide closing a passage: a ribbed steel curtain between guide
    channels, a bottom bar with lifting handles and a padlock, and the roll housing above,
    rust bleeding from its seams."""
    parts = []
    # The curtain's ribs: a wave in section, from the bottom bar to the housing.
    section, z, k = [], 0.12, 0
    while z < 3.52:
        section.append((-0.035 if k % 2 == 0 else -0.015, z))
        z += 0.045
        k += 1
    curtain = [(0.0, 0.12), *section, (0.0, section[-1][1])]
    parts.append(moulding("curtain", curtain, "bld_shutter", 5.9))
    parts.append(box("bar", -2.95, 2.95, -0.06, 0.0, 0.03, 0.12, "bld_shutter_dark"))
    for i, x in enumerate((-1.6, 1.6)):
        parts.append(box(f"handle{i}", x - 0.08, x + 0.08, -0.09, -0.06, 0.06, 0.08, "bld_shutter_dark"))
    parts.append(box("hasp", -0.03, 0.03, -0.075, -0.06, 0.03, 0.12, "bld_shutter_dark"))
    parts.append(box("lock", -0.035, 0.035, -0.105, -0.075, 0.0, 0.07, "bld_lock"))
    parts.append(ring("shackle", 0.022, 0.005, (0.0, -0.09, 0.075), "Y", "bld_steel", verts=10, minor_verts=4))
    for i, x in enumerate((-3.0, 3.0)):
        parts.append(box(f"guide{i}", x - 0.07, x + 0.07, -0.08, 0.0, 0.0, 3.6, "bld_shutter_dark"))
    parts.append(hull("housing", [(x, y, z) for x in (-3.3, 3.3) for y, z in ((0.0, 3.55), (0.0, 4.0), (-0.24, 3.55), (-0.3, 3.65), (-0.3, 3.92), (-0.25, 4.0))], "bld_shutter_dark"))
    for i, x in enumerate((-2.2, -0.4, 1.9)):
        parts.append(box(f"rust{i}", x - 0.04, x + 0.04, -0.303, -0.301, 3.6, 3.85, "bld_rust"))
    return join(parts, "shutter")


# ---------------------------------------------------------------------------
# railings, ladders and stairs


def rail_bar():
    """A round handrail tube, 1 m long."""
    return cylinder("rail_bar", 0.022, 1.0, (0, 0, 0), "X", "bld_rail", verts=8)


def rail_post():
    """A square railing post, 1 m tall, with a foot plate and a cap."""
    return join([box("foot", -0.05, 0.05, -0.05, 0.05, 0.0, 0.01, "bld_rail"),
                 box("post", -0.02, 0.02, -0.02, 0.02, 0.0, 0.98, "bld_rail"),
                 box("cap", -0.026, 0.026, -0.026, 0.026, 0.98, 1.0, "bld_rail")], "rail_post")


def ladder_rail():
    """A ladder stile: a flat steel bar on edge, 1 m tall."""
    return box("ladder_rail", -0.008, 0.008, -0.03, 0.03, 0.0, 1.0, "bld_steel")


def ladder_rung():
    """A round rung, welded at both ends."""
    return join([cylinder("bar", 0.016, 0.46, (0, 0, 0), "X", "bld_steel", verts=6),
                 *[cylinder(f"weld{i}", 0.022, 0.012, (x, 0, 0), "X", "bld_steel", verts=6) for i, x in enumerate((-0.222, 0.222))]], "ladder_rung")


def stair_tread():
    """An open grating tread: an angle frame, bearing bars along the run, a cross rod and a
    checker-plate nosing."""
    w, d, t = 1.3, 0.3, 0.05
    parts = [box("front", -w / 2, w / 2, -d / 2, -d / 2 + 0.03, -t / 2, t / 2, "bld_steel"),
             box("back", -w / 2, w / 2, d / 2 - 0.03, d / 2, -t / 2, t / 2, "bld_steel"),
             box("left", -w / 2, -w / 2 + 0.03, -d / 2, d / 2, -t / 2, t / 2, "bld_steel"),
             box("right", w / 2 - 0.03, w / 2, -d / 2, d / 2, -t / 2, t / 2, "bld_steel"),
             box("nosing", -w / 2, w / 2, -d / 2 - 0.005, -d / 2 + 0.06, t / 2 - 0.004, t / 2 + 0.003, "bld_checker"),
             box("rod", -w / 2 + 0.03, w / 2 - 0.03, -0.005, 0.005, -t / 2 + 0.005, t / 2 - 0.02, "bld_grating")]
    for i in range(11):
        x = -w / 2 + 0.03 + (w - 0.06) * (i + 0.5) / 11
        parts.append(box(f"bearing{i}", x - 0.004, x + 0.004, -d / 2 + 0.03, d / 2 - 0.03, -t / 2 + 0.004, t / 2 - 0.004, "bld_grating"))
    return join(parts, "stair_tread")


def stair_stringer():
    """A stair stringer: a steel channel on edge, 1 m along X."""
    return join([box("web", -0.5, 0.5, -0.005, 0.005, -0.12, 0.12, "bld_steel"),
                 box("top", -0.5, 0.5, -0.035, 0.035, 0.11, 0.12, "bld_steel"),
                 box("bottom", -0.5, 0.5, -0.035, 0.035, -0.12, -0.11, "bld_steel")], "stair_stringer")


def grating_deck():
    """A metre of the fire escape's walkway: steel bearing bars between channel sides, on cross
    members at its ends. The game lays them along the platform, stretched to its width."""
    parts = [box("sideA", -0.5, 0.5, -0.5, -0.47, -0.09, 0.09, "bld_steel"),
             box("sideB", -0.5, 0.5, 0.47, 0.5, -0.09, 0.09, "bld_steel"),
             box("endA", -0.5, -0.47, -0.47, 0.47, -0.05, 0.09, "bld_steel"),
             box("endB", 0.47, 0.5, -0.47, 0.47, -0.05, 0.09, "bld_steel")]
    for i in range(12):
        y = -0.47 + 0.94 * (i + 0.5) / 12
        parts.append(box(f"bar{i}", -0.47, 0.47, y - 0.005, y + 0.005, 0.04, 0.09, "bld_grating"))
    for i, x in enumerate((-0.25, 0.0, 0.25)):
        parts.append(box(f"rod{i}", x - 0.006, x + 0.006, -0.47, 0.47, 0.06, 0.075, "bld_grating"))
    return join(parts, "grating_deck")


PIECES = [
    Piece("window_unit", window_unit, 260, (1.8, 0.2, 2.465), None, "Every upper-floor window, centred on its glass, set on the wall face."),
    Piece("card_window", card_window, 2, (1.38, 0.0, 1.76), "center", "Window glass, drawn by the game as a dark pane or a lit room."),
    Piece("card_unit", card_unit, 2, (1.0, 0.0, 1.0), "center", "Shop glass and storefront photographs, stretched."),
    Piece("cornice", cornice, 60, (1.0, 0.29, 0.45), "wall", "The roofline cornice, stretched along each facade."),
    Piece("string_course", string_course, 40, (1.0, 0.09, 0.18), "wall", "The band under the windows, stretched."),
    Piece("shop_pilaster", shop_pilaster, 120, (0.3, 0.13, 3.32), "wall", "Either side of each shopfront."),
    Piece("shop_ledge", shop_ledge, 40, (1.0, 0.1, 0.09), "wall", "Over each shopfront, stretched."),
    Piece("shutter", shutter, 900, (6.6, 0.3, 4.0), "wall", "Closing the passages at the ends of the alleys."),
    Piece("rail_bar", rail_bar, 40, (1.0, 0.044, 0.044), "center", "Rails of the fire escape, balcony and stair, stretched."),
    Piece("rail_post", rail_post, 40, (0.1, 0.1, 1.0), "base", "Railing posts, stretched to height."),
    Piece("ladder_rail", ladder_rail, 12, (0.016, 0.06, 1.0), "base", "Ladder stiles, stretched to height."),
    Piece("ladder_rung", ladder_rung, 80, (0.468, 0.044, 0.044), "center", "Ladder rungs."),
    Piece("stair_tread", stair_tread, 220, (1.3, 0.31, 0.053), "center", "The bar stair's open treads."),
    Piece("stair_stringer", stair_stringer, 40, (1.0, 0.07, 0.24), "center", "The bar stair's stringers, stretched along its slope."),
    Piece("grating_deck", grating_deck, 260, (1.0, 1.0, 0.18), "center", "The market fire escape's walkway, a metre at a time."),
]
