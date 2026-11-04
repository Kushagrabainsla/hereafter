"""Furniture and interiors: the restaurant's tables, chairs, pass counter and pantry shelves
with their goods; the bar's counter, stools, back bar with its bottles, pool table and the sofa
upstairs; the record shop's counter; and the market alley's folding tables and plastic stools.
Built into public/models/furniture.glb by scripts/assets/build.py.

Each piece stands on the floor with its origin under its middle, its front toward -Y (the game
turns it to face where it should), except the pantry shelf and the back bar, which back onto a
wall at y = 0. Counters run along X. The tables, counters, pool table and sofa keep the solid
boxes the map gives them for physics; these are what is drawn.
"""

import math

from mathutils import Matrix

from lib import Piece, box, cylinder, join, lathe, material, move, ring, sphere, tube


def materials():
    material("furn_oak", 0x8a5a35, 0.0, 0.55)
    material("furn_walnut", 0x4a2c1a, 0.0, 0.5)
    material("furn_walnut_dark", 0x2e1a10, 0.0, 0.6)
    material("furn_butcher", 0xb98a58, 0.0, 0.45)
    material("furn_panel", 0x5a3a24, 0.0, 0.6)
    material("furn_steel", 0x9da3a6, 1.0, 0.3)
    material("furn_black", 0x1a1a1c, 0.3, 0.5)
    material("furn_brass", 0xb58b3c, 1.0, 0.28)
    material("furn_chrome", 0xd4d8db, 1.0, 0.15)
    material("furn_leather_red", 0x7a1c18, 0.0, 0.42)
    material("furn_felt", 0x1f5c3a, 0.0, 0.9)
    material("furn_cushion", 0x5e1f2a, 0.0, 0.85)
    material("furn_fabric", 0x3d2a30, 0.0, 0.9)
    material("furn_laminate", 0xe9e2d0, 0.0, 0.4)
    material("furn_alu", 0xb4b9bc, 0.9, 0.35)
    material("paint_plastic", 0xf2f2f2, 0.0, 0.35)
    material("furn_mirror", 0x6d7b84, 1.0, 0.06)
    material("furn_jar_glass", 0xcfe3e0, 0.1, 0.1)
    material("furn_jar_lid", 0xc23a2c, 0.3, 0.4)
    material("furn_chili", 0xa8201a, 0.0, 0.7)
    material("furn_rice", 0xeee6cf, 0.0, 0.9)
    material("furn_beans", 0x5b3a1e, 0.0, 0.8)
    material("furn_tin_red", 0xb32a22, 0.6, 0.4)
    material("furn_tin_gold", 0xc9a548, 0.8, 0.35)
    material("furn_tin_green", 0x2f6b4a, 0.6, 0.4)
    material("furn_sack", 0xc8b48c, 0.0, 0.95)
    material("furn_sack_print", 0x8c2a22, 0.0, 0.9)
    material("furn_ceramic", 0xf2eee4, 0.0, 0.25)
    material("furn_ceramic_blue", 0x3c64a0, 0.0, 0.25)
    material("furn_ball_white", 0xf4f1e8, 0.0, 0.15)
    material("furn_ball_red", 0xb3201a, 0.0, 0.15)
    material("furn_ball_yellow", 0xe8b52a, 0.0, 0.15)
    material("furn_ball_black", 0x101010, 0.0, 0.15)
    material("furn_ball_blue", 0x1f3f9a, 0.0, 0.15)
    material("furn_cue", 0xc9a46a, 0.0, 0.4)
    # Bottles on the back bar, lit from behind: they keep a faint glow of their own.
    material("furn_bottle_amber", 0x8a4a12, 0.1, 0.08, emit=0xc06a1a, strength=0.5)
    material("furn_bottle_green", 0x1e5a32, 0.1, 0.08, emit=0x2f8a4a, strength=0.45)
    material("furn_bottle_clear", 0x9fc4c8, 0.1, 0.05, emit=0x6fd0c0, strength=0.55)


# --- tables and seats ---------------------------------------------------------------------------

def dining_table():
    """A four-legged wooden table, its top on an apron."""
    top = box("top", -0.4, 0.4, -0.4, 0.4, 0.725, 0.76, "furn_oak", bev=0.008)
    apron = [box("apron_x0", -0.34, 0.34, -0.35, -0.33, 0.64, 0.725, "furn_walnut"), box("apron_x1", -0.34, 0.34, 0.33, 0.35, 0.64, 0.725, "furn_walnut"),
             box("apron_y0", -0.35, -0.33, -0.34, 0.34, 0.64, 0.725, "furn_walnut"), box("apron_y1", 0.33, 0.35, -0.34, 0.34, 0.64, 0.725, "furn_walnut")]
    legs = [box(f"leg{i}", x - 0.024, x + 0.024, y - 0.024, y + 0.024, 0.0, 0.725, "furn_walnut", bev=0.004) for i, (x, y) in enumerate(((-0.33, -0.33), (0.33, -0.33), (-0.33, 0.33), (0.33, 0.33)))]
    return join([top] + apron + legs, "dining_table")


def dining_chair():
    """A bentwood cafe chair: a round seat on splayed legs, a hooped back."""
    seat = cylinder("seat", 0.205, 0.035, (0, 0, 0.45), "Z", "furn_walnut", verts=20, bev=0.008)
    legs = [tube(f"leg{k}", [(math.cos(a) * 0.15, math.sin(a) * 0.15, 0.435), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.0)], 0.014, "furn_walnut_dark", verts=6)
            for k, a in enumerate(math.radians(d) for d in (45, 135, 225, 315))]
    hoop = ring("hoop", 0.15, 0.011, (0, 0, 0.18), "Z", "furn_walnut_dark", verts=16, minor_verts=5)
    # The back is one bent rod, up from the seat, round the top and down again.
    back = tube("back", [(-0.15, 0.13, 0.45), (-0.158, 0.15, 0.6), (-0.162, 0.168, 0.72), (-0.145, 0.182, 0.79), (-0.1, 0.194, 0.832), (-0.05, 0.2, 0.846), (0.0, 0.202, 0.85),
                         (0.05, 0.2, 0.846), (0.1, 0.194, 0.832), (0.145, 0.182, 0.79), (0.162, 0.168, 0.72), (0.158, 0.15, 0.6), (0.15, 0.13, 0.45)], 0.014, "furn_walnut_dark", verts=6)
    rail = tube("rail", [(-0.158, 0.16, 0.66), (-0.08, 0.18, 0.672), (0.0, 0.184, 0.675), (0.08, 0.18, 0.672), (0.158, 0.16, 0.66)], 0.01, "furn_walnut_dark", verts=6)
    return join([seat, hoop, back, rail] + legs, "dining_chair")


def bar_stool():
    """A red leather stool on a chrome pedestal with a footring."""
    seat = lathe("seat", [(0.0, 0.67), (0.19, 0.67), (0.205, 0.69), (0.2, 0.73), (0.17, 0.75), (0.0, 0.752)], "furn_leather_red", verts=20)
    post = cylinder("post", 0.028, 0.62, (0, 0, 0.36), "Z", "furn_chrome", verts=10)
    base = lathe("base", [(0.0, 0.0), (0.21, 0.0), (0.21, 0.012), (0.08, 0.035), (0.03, 0.05)], "furn_chrome", verts=20)
    footring = ring("footring", 0.16, 0.009, (0, 0, 0.28), "Z", "furn_chrome", verts=16, minor_verts=5)
    spokes = [tube(f"spoke{k}", [(0, 0, 0.28), (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.28)], 0.007, "furn_chrome", verts=4) for k, a in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2))]
    return join([seat, post, base, footring] + spokes, "bar_stool")


def cafe_table():
    """A street-food folding table: a cream laminate top on an aluminium frame."""
    top = box("top", -0.55, 0.55, -0.55, 0.55, 0.73, 0.76, "furn_laminate", bev=0.01)
    edge = [box(f"edge{s}", -0.55, 0.55, s * 0.55 - 0.012, s * 0.55 + 0.012, 0.7, 0.73, "furn_alu") for s in (-1, 1)]
    edge += [box(f"edge_y{s}", s * 0.55 - 0.012, s * 0.55 + 0.012, -0.55, 0.55, 0.7, 0.73, "furn_alu") for s in (-1, 1)]
    legs = [tube(f"leg{i}", [(x, y, 0.7), (x * 1.04, y * 1.04, 0.0)], 0.014, "furn_alu", verts=6) for i, (x, y) in enumerate(((-0.48, -0.48), (0.48, -0.48), (-0.48, 0.48), (0.48, 0.48)))]
    braces = [tube(f"brace{s}", [(s * 0.49, -0.49, 0.18), (s * 0.49, 0.49, 0.18)], 0.009, "furn_alu", verts=4) for s in (-1, 1)]
    return join([top] + edge + legs + braces, "cafe_table")


def plastic_stool():
    """The low plastic stool of every night market, tinted per copy by the game."""
    seat = lathe("seat", [(0.0, 0.42), (0.15, 0.42), (0.165, 0.435), (0.16, 0.455), (0.0, 0.455)], "paint_plastic", verts=16)
    # Four legs flaring out from under the seat, tied by a hoop near the floor.
    legs = [tube(f"leg{k}", [(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.425), (math.cos(a) * 0.165, math.sin(a) * 0.165, 0.2), (math.cos(a) * 0.19, math.sin(a) * 0.19, 0.0)],
                 0.03, "paint_plastic", verts=6) for k, a in enumerate(math.radians(d) for d in (45, 135, 225, 315))]
    hoop = ring("hoop", 0.18, 0.01, (0, 0, 0.07), "Z", "paint_plastic", verts=16, minor_verts=4)
    return join([seat, hoop] + legs, "plastic_stool")


# --- counters: run along X, front toward -Y ------------------------------------------------------

def counter(name, length, depth, height, top_mat, body_mat, panel_mat, foot_rail=False, kick=True, panels=1.0):
    """A counter with a slab top overhanging the front, panelled front with raised mouldings
    every `panels` metres, a recessed kick plate, and optionally a brass foot rail."""
    half_l, half_d = length / 2, depth / 2
    top = box("top", -half_l, half_l, -half_d - 0.05, half_d, height - 0.05, height, top_mat, bev=0.012)
    body = box("body", -half_l + 0.02, half_l - 0.02, -half_d + 0.03, half_d - 0.02, 0.1 if kick else 0.0, height - 0.05, body_mat, bev=0.006)
    parts = [top, body]
    if kick:
        parts.append(box("kick", -half_l + 0.04, half_l - 0.04, -half_d + 0.06, half_d - 0.04, 0.0, 0.1, "furn_black"))
    count = max(1, round(length / panels))
    for i in range(count):
        x0 = -half_l + 0.06 + i * (length - 0.12) / count
        x1 = x0 + (length - 0.12) / count - 0.06
        z0, z1 = (0.16 if kick else 0.08), height - 0.14
        parts += [box(f"rail_b{i}", x0, x1, -half_d + 0.015, -half_d + 0.03, z0, z0 + 0.03, panel_mat), box(f"rail_t{i}", x0, x1, -half_d + 0.015, -half_d + 0.03, z1 - 0.03, z1, panel_mat),
                  box(f"stile_l{i}", x0, x0 + 0.03, -half_d + 0.015, -half_d + 0.03, z0, z1, panel_mat), box(f"stile_r{i}", x1 - 0.03, x1, -half_d + 0.015, -half_d + 0.03, z0, z1, panel_mat)]
    if foot_rail:
        y = -half_d - 0.14
        parts.append(tube("foot_rail", [(-half_l + 0.1, y, 0.22), (half_l - 0.1, y, 0.22)], 0.025, "furn_brass", verts=10))
        for k in range(int(length // 1.2) + 1):
            x = -half_l + 0.15 + k * (length - 0.3) / max(1, int(length // 1.2))
            parts.append(tube(f"bracket{k}", [(x, -half_d + 0.03, 0.3), (x, y, 0.22)], 0.012, "furn_brass", verts=6))
    return join(parts, name)


def pass_counter():
    """The restaurant's pass: an eight-metre butcher-block counter with stacked bowls and a bell."""
    obj = counter("pass_counter", 8.0, 0.8, 1.05, "furn_butcher", "furn_panel", "furn_walnut")
    extras = []
    for k, x in enumerate((-2.9, -0.6, 1.8, 3.4)):
        for level in range(3):
            extras.append(lathe(f"bowl{k}_{level}", [(0.04, 1.05 + level * 0.045), (0.085, 1.075 + level * 0.045), (0.09, 1.09 + level * 0.045)], "furn_ceramic" if k % 2 else "furn_ceramic_blue", verts=14))
    bell = lathe("bell", [(0.0, 1.05), (0.05, 1.05), (0.045, 1.07), (0.03, 1.1), (0.006, 1.115), (0.006, 1.13)], "furn_brass", verts=12)
    move(bell, (0.6, 0.1, 0))
    return join([obj] + extras + [bell], "pass_counter")


def bar_counter():
    """The bar: six metres of dark panelled front, a walnut top and a brass foot rail."""
    return counter("bar_counter", 6.0, 0.8, 1.1, "furn_walnut", "furn_walnut_dark", "furn_panel", foot_rail=True)


def record_counter():
    """The record shop's counter, where the turntable sits."""
    return counter("record_counter", 2.3, 0.7, 1.0, "furn_oak", "furn_panel", "furn_walnut", panels=0.8)


# --- shelves and what is on them -------------------------------------------------------------------

def pantry_shelf():
    """One 1.875 m length of the kitchen's twin shelves on steel brackets, backing onto the wall."""
    parts = []
    for z in (1.675, 2.225):
        parts.append(box(f"plank{z}", -0.9375, 0.9375, -0.35, -0.005, z, z + 0.05, "furn_oak", bev=0.004))
        for x in (-0.7, 0.7):
            parts.append(box(f"arm{z}{x}", x - 0.012, x + 0.012, -0.3, 0.0, z - 0.03, z, "furn_black"))
            parts.append(box(f"stem{z}{x}", x - 0.012, x + 0.012, -0.02, 0.0, z - 0.25, z, "furn_black"))
    return join(parts, "pantry_shelf")


def jar(name, x, height, fill, lid="furn_jar_lid"):
    glass = lathe(f"{name}_glass", [(0.0, 0.0), (0.05, 0.0), (0.055, 0.02), (0.055, height - 0.03), (0.045, height - 0.01)], "furn_jar_glass", verts=12)
    contents = lathe(f"{name}_fill", [(0.0, 0.004), (0.05, 0.004), (0.05, height * 0.7)], fill, verts=12)
    cap = cylinder(f"{name}_lid", 0.048, 0.02, (0, 0, height), "Z", lid, verts=12)
    parts = [glass, contents, cap]
    for part in parts:
        move(part, (x, -0.15, 0))
    return parts


def goods_jars():
    """Three glass jars of chilli, rice and beans with red lids."""
    return join(jar("a", -0.12, 0.2, "furn_chili") + jar("b", 0.0, 0.24, "furn_rice") + jar("c", 0.12, 0.18, "furn_beans"), "goods_jars")


def goods_tins():
    """A stack of printed tins, two and one."""
    tins = []
    for i, (x, z, mat) in enumerate(((-0.06, 0.0, "furn_tin_red"), (0.06, 0.0, "furn_tin_green"), (0.0, 0.13, "furn_tin_gold"))):
        tins.append(cylinder(f"tin{i}", 0.055, 0.13, (x, -0.15, z + 0.065), "Z", mat, verts=14))
        tins.append(ring(f"rim{i}", 0.055, 0.004, (x, -0.15, z + 0.13), "Z", "furn_steel", verts=14, minor_verts=4))
    return join(tins, "goods_tins")


def goods_sacks():
    """Two small rice sacks, tied at the neck and slumped against each other."""
    sacks = []
    for i, (x, lean) in enumerate(((-0.08, 0.06), (0.09, -0.05))):
        body = lathe(f"sack{i}", [(0.0, 0.0), (0.085, 0.0), (0.1, 0.06), (0.095, 0.16), (0.06, 0.22), (0.03, 0.24), (0.04, 0.27), (0.0, 0.27)], "furn_sack", verts=12)
        band = cylinder(f"band{i}", 0.097, 0.04, (0, 0, 0.1), "Z", "furn_sack_print", verts=12)
        for part in (body, band):
            part.data.transform(Matrix.Rotation(lean, 4, "X"))
            move(part, (x, -0.15, 0))
        sacks += [body, band]
    return join(sacks, "goods_sacks")


def goods_bowls():
    """A stack of blue-and-white bowls and a teapot."""
    parts = []
    for level in range(4):
        z = level * 0.035
        b = lathe(f"bowl{level}", [(0.0, z), (0.04, z), (0.09, z + 0.03), (0.095, z + 0.045), (0.087, z + 0.045), (0.036, z + 0.009), (0.0, z + 0.009)], "furn_ceramic_blue" if level % 2 else "furn_ceramic", verts=14)
        move(b, (-0.08, -0.15, 0))
        parts.append(b)
    pot = lathe("pot", [(0.0, 0.0), (0.05, 0.0), (0.075, 0.05), (0.07, 0.1), (0.04, 0.12), (0.045, 0.13), (0.0, 0.14)], "furn_ceramic", verts=14)
    spout = tube("spout", [(0.06, 0, 0.05), (0.11, 0, 0.09), (0.125, 0, 0.11)], 0.01, "furn_ceramic", verts=5)
    for part in (pot, spout):
        move(part, (0.1, -0.15, 0))
    return join(parts + [pot, spout], "goods_bowls")


def back_bar():
    """The bar's back wall: a mirror, a walnut shelf on brass brackets at 2 m and a row of eleven
    bottles lit from behind. Backs onto the wall at y = 0; the shelf is 3.6 m long."""
    mirror = box("mirror", -1.8, 1.8, -0.012, -0.002, 1.25, 2.65, "furn_mirror")
    frame = [box("frame_t", -1.84, 1.84, -0.03, 0.0, 2.65, 2.7, "furn_walnut"), box("frame_b", -1.84, 1.84, -0.03, 0.0, 1.2, 1.25, "furn_walnut"),
             box("frame_l", -1.84, -1.8, -0.03, 0.0, 1.2, 2.7, "furn_walnut"), box("frame_r", 1.8, 1.84, -0.03, 0.0, 1.2, 2.7, "furn_walnut")]
    shelf = box("shelf", -1.8, 1.8, -0.3, -0.005, 2.0, 2.05, "furn_walnut", bev=0.006)
    brackets = [tube(f"bracket{x}", [(x, -0.01, 1.8), (x, -0.25, 2.0)], 0.01, "furn_brass", verts=5) for x in (-1.5, 0.0, 1.5)]
    bottles = []
    shapes = [  # profile, glass
        ([(0.0, 0.0), (0.035, 0.0), (0.036, 0.19), (0.012, 0.25), (0.011, 0.3)], "furn_bottle_green"),
        ([(0.0, 0.0), (0.04, 0.0), (0.042, 0.16), (0.03, 0.2), (0.013, 0.22), (0.012, 0.27)], "furn_bottle_amber"),
        ([(0.0, 0.0), (0.033, 0.0), (0.034, 0.21), (0.014, 0.25), (0.012, 0.29)], "furn_bottle_clear"),
    ]
    for i, z in enumerate(6.2 + 0.35 * k for k in range(11)):
        profile, glass = shapes[(i * 7) % 3]
        b = lathe(f"bottle{i}", [(r, h) for r, h in profile], glass, verts=10)
        cap = cylinder(f"cap{i}", 0.013, 0.02, (0, 0, profile[-1][1] + 0.01), "Z", "furn_black", verts=8)
        for part in (b, cap):
            move(part, (z - 8.0, -0.15, 2.05))
        bottles += [b, cap]
    return join([mirror, shelf] + frame + brackets + bottles, "back_bar")


# --- the pool table and the sofa -------------------------------------------------------------------

def pool_table():
    """A pool table, 1.4 by 2.2 m: green felt inside cushioned rails, six pockets, turned legs,
    a few balls and a cue lying across."""
    w, l, h = 0.7, 1.1, 0.85
    bed = box("bed", -w + 0.12, w - 0.12, -l + 0.12, l - 0.12, 0.72, 0.79, "furn_felt")
    cushions = [box("cush_l", -w + 0.08, -w + 0.12, -l + 0.16, l - 0.16, 0.79, 0.82, "furn_felt"), box("cush_r", w - 0.12, w - 0.08, -l + 0.16, l - 0.16, 0.79, 0.82, "furn_felt"),
                box("cush_b", -w + 0.16, w - 0.16, -l + 0.08, -l + 0.12, 0.79, 0.82, "furn_felt"), box("cush_t", -w + 0.16, w - 0.16, l - 0.12, l - 0.08, 0.79, 0.82, "furn_felt")]
    rails = [box("rail_l", -w, -w + 0.08, -l, l, 0.66, h, "furn_walnut", bev=0.015), box("rail_r", w - 0.08, w, -l, l, 0.66, h, "furn_walnut", bev=0.015),
             box("rail_b", -w, w, -l, -l + 0.08, 0.66, h, "furn_walnut", bev=0.015), box("rail_t", -w, w, l - 0.08, l, 0.66, h, "furn_walnut", bev=0.015)]
    apron = box("apron", -w + 0.04, w - 0.04, -l + 0.04, l - 0.04, 0.58, 0.72, "furn_walnut_dark", bev=0.01)
    pockets = [cylinder(f"pocket{i}", 0.05, 0.06, (x, y, 0.82), "Z", "furn_black", verts=12) for i, (x, y) in enumerate(((-w + 0.1, -l + 0.1), (w - 0.1, -l + 0.1), (-w + 0.09, 0.0), (w - 0.09, 0.0), (-w + 0.1, l - 0.1), (w - 0.1, l - 0.1)))]
    legs = []
    for i, (x, y) in enumerate(((-w + 0.12, -l + 0.14), (w - 0.12, -l + 0.14), (-w + 0.12, l - 0.14), (w - 0.12, l - 0.14))):
        leg = lathe(f"leg{i}", [(0.06, 0.0), (0.07, 0.04), (0.05, 0.12), (0.075, 0.3), (0.05, 0.5), (0.065, 0.58)], "furn_walnut_dark", verts=12)
        move(leg, (x, y, 0))
        legs.append(leg)
    balls = [sphere(f"ball{i}", 0.028, (x, y, 0.818), mat, segments=10, rings=7) for i, (x, y, mat) in enumerate(((0.0, -0.55, "furn_ball_white"), (0.1, 0.35, "furn_ball_red"), (-0.15, 0.42, "furn_ball_yellow"),
                                                                                                            (0.02, 0.5, "furn_ball_black"), (0.25, 0.1, "furn_ball_blue"), (-0.3, -0.2, "furn_ball_red")))]
    cue = tube("cue", [(-0.45, -0.85, 0.83), (0.35, 0.3, 0.84)], 0.009, "furn_cue", verts=6)
    return join([bed, apron] + cushions + rails + pockets + legs + balls + [cue], "pool_table")


def sofa():
    """A worn three-seat sofa: a fabric frame, three seat and three back cushions, rolled arms."""
    parts = [box("base", -1.2, 1.2, -0.48, 0.5, 0.08, 0.38, "furn_fabric", bev=0.03), box("back", -1.2, 1.2, 0.25, 0.5, 0.38, 0.8, "furn_fabric", bev=0.04)]
    for s in (-1, 1):
        parts.append(box(f"arm{s}", s * 1.2 - (0.18 if s > 0 else 0), s * 1.2 + (0.0 if s > 0 else 0.18), -0.5, 0.5, 0.08, 0.62, "furn_fabric", bev=0.05))
    for i in range(3):
        x = -0.68 + i * 0.68
        parts.append(box(f"seat{i}", x - 0.33, x + 0.33, -0.46, 0.22, 0.38, 0.5, "furn_cushion", bev=0.04))
        parts.append(box(f"pillow{i}", x - 0.32, x + 0.32, 0.1, 0.26, 0.5, 0.78, "furn_cushion", bev=0.05))
    parts += [cylinder(f"foot{i}", 0.025, 0.08, (x, y, 0.04), "Z", "furn_walnut_dark", verts=8) for i, (x, y) in enumerate(((-1.12, -0.42), (1.12, -0.42), (-1.12, 0.42), (1.12, 0.42)))]
    return join(parts, "sofa")


PIECES = [
    Piece("dining_table", dining_table, 650, (0.8, 0.8, 0.76), "base", "The restaurant's three tables."),
    Piece("dining_chair", dining_chair, 900, (0.42, 0.42, 0.85), "base", "Four round each restaurant table, facing it."),
    Piece("bar_stool", bar_stool, 800, (0.43, 0.43, 0.75), "base", "Six along the bar.", 60),
    Piece("cafe_table", cafe_table, 500, (1.13, 1.13, 0.76), "base", "The market alley's folding tables, with magazines on top."),
    Piece("plastic_stool", plastic_stool, 400, (0.42, 0.42, 0.46), "base", "Three round each market table, tinted.", 60),
    Piece("pass_counter", pass_counter, 2600, (8.0, 0.85, 1.18), "base", "The restaurant's pass, along the kitchen."),
    Piece("bar_counter", bar_counter, 1200, (6.0, 0.97, 1.1), "base", "The bar."),
    Piece("record_counter", record_counter, 700, (2.3, 0.75, 1.0), "base", "The record shop's counter, under the turntable."),
    Piece("pantry_shelf", pantry_shelf, 350, (1.875, 0.35, 0.83), None, "Eight lengths make the kitchen's 15 m of shelving."),
    Piece("goods_jars", goods_jars, 700, (0.35, 0.11, 0.25), "base", "On the pantry shelves.", 60),
    Piece("goods_tins", goods_tins, 500, (0.23, 0.11, 0.26), "base", "On the pantry shelves.", 60),
    Piece("goods_sacks", goods_sacks, 500, (0.38, 0.22, 0.28), "base", "On the pantry shelves.", 60),
    Piece("goods_bowls", goods_bowls, 900, (0.41, 0.19, 0.15), "base", "On the pantry shelves.", 60),
    Piece("back_bar", back_bar, 2400, (3.68, 0.3, 1.5), "wall", "The mirror, shelf and bottles behind the bar.", 60),
    Piece("pool_table", pool_table, 2400, (1.4, 2.2, 0.85), "base", "Under the billiard lamp."),
    Piece("sofa", sofa, 1300, (2.4, 1.0, 0.8), "base", "Upstairs in the bar."),
]
