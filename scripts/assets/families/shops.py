"""The walk-in shops of the middle block: the boba bar and its drinks fridge, the dumpling and
pho counters, what stands on the cooking lines behind them, the menu boards and the food a
player can take. Built into public/models/shops.glb by scripts/assets/build.py.

Counters stand on the floor with their origin under their middle, run along X and face -Y (the
game turns them to the room); the map gives them solid boxes for physics. Food stands on its
counter. Menus back onto a wall at y = 0, facing -Y, centred on their middle.
"""

import math
import random

from lib import Piece, box, cylinder, fit, join, lathe, material, move, sphere, text_mesh, tube


def materials():
    material("shop_laminate", 0xece6d6, 0.0, 0.35)
    material("shop_steel", 0xa8aeb1, 1.0, 0.32)
    material("shop_dark", 0x1b1c1e, 0.3, 0.5)
    material("shop_red", 0x98281f, 0.0, 0.42)
    material("shop_cream", 0xe8dcc0, 0.0, 0.4)
    material("shop_green", 0x35503a, 0.0, 0.45)
    material("shop_mustard", 0xc2922e, 0.0, 0.45)
    material("shop_teal", 0x2f8f94, 0.0, 0.38)
    material("shop_pink", 0xe89aa8, 0.0, 0.38)
    material("shop_white", 0xf1efe8, 0.0, 0.3)
    material("shop_bamboo", 0xbf9350, 0.0, 0.6)
    material("shop_bamboo_dark", 0x8a6530, 0.0, 0.65)
    material("shop_dough", 0xf3ead6, 0.0, 0.6)
    material("shop_ceramic", 0xf2f0ea, 0.0, 0.22)
    material("shop_ceramic_blue", 0x2c5a94, 0.0, 0.25)
    material("shop_broth", 0xb77a2a, 0.0, 0.12)
    material("shop_noodle", 0xeee0b2, 0.0, 0.5)
    material("shop_beef", 0x7a4630, 0.0, 0.55)
    material("shop_herb", 0x4f8f3c, 0.0, 0.6)
    material("shop_lime", 0x9dc23e, 0.0, 0.4)
    material("shop_chili", 0xc8301c, 0.0, 0.4)
    material("shop_wood", 0x6b4426, 0.0, 0.55)
    material("shop_milk_tea", 0xc49a68, 0.0, 0.3)
    material("shop_taro", 0xa98bc8, 0.0, 0.3)
    material("shop_matcha", 0x9ab864, 0.0, 0.3)
    material("shop_pearl", 0x1a1110, 0.0, 0.18)
    material("shop_cup_lid", 0xe6eef0, 0.1, 0.2)
    material("shop_straw", 0xe2483c, 0.0, 0.4)
    material("shop_can_a", 0xd8402f, 0.5, 0.3)
    material("shop_can_b", 0x2f7fc8, 0.5, 0.3)
    material("shop_can_c", 0xe0b030, 0.5, 0.3)
    material("shop_board", 0x20261f, 0.0, 0.85)
    material("shop_chalk", 0xeae6d8, 0.0, 0.8)
    material("shop_chalk_warm", 0xf2b860, 0.0, 0.8)
    material("glow_fridge", 0xcfe2f5, 0.0, 0.3, emit=0xcfe2f5, strength=0.5)


# --- counters ----------------------------------------------------------------------------------

def counter_body(length, depth, height, top, body, band):
    """A counter: a slab top overhanging the front, a recessed kick plate and a band of colour
    under the top."""
    half_l, half_d = length / 2, depth / 2
    return [
        box("top", -half_l, half_l, -half_d - 0.04, half_d, height - 0.05, height, top, bev=0.01),
        box("body", -half_l + 0.02, half_l - 0.02, -half_d + 0.02, half_d - 0.02, 0.1, height - 0.05, body, bev=0.005),
        box("kick", -half_l + 0.05, half_l - 0.05, -half_d + 0.06, half_d - 0.04, 0.0, 0.1, "shop_dark"),
        box("band", -half_l + 0.02, half_l - 0.02, -half_d + 0.008, -half_d + 0.02, height - 0.24, height - 0.11, band),
    ]


def tiles(length, depth, height, material_a, material_b, rows=3):
    """Two-colour tiles across a counter's front, under its band."""
    parts = []
    half_l, half_d = length / 2, depth / 2
    size = (height - 0.42) / rows
    columns = max(2, round(length / size))
    width = (length - 0.08) / columns
    for row in range(rows):
        for column in range(columns):
            x0 = -half_l + 0.04 + column * width
            z0 = 0.14 + row * size
            parts.append(box(f"t{row}_{column}", x0 + 0.004, x0 + width - 0.004, -half_d + 0.012, -half_d + 0.02, z0 + 0.004, z0 + size - 0.004, material_a if (row + column) % 2 else material_b))
    return parts


def steamer(name, radius, height, center):
    """One round bamboo steamer, its rim bound with darker strips."""
    x, y, z = center
    wall = lathe(f"{name}_wall", [(radius, z), (radius, z + height), (radius - 0.01, z + height), (radius - 0.01, z + 0.01), (0.0, z + 0.01)], "shop_bamboo", verts=12)
    rim = lathe(f"{name}_rim", [(radius + 0.004, z + height * 0.72), (radius + 0.004, z + height), (radius, z + height), (radius, z + height * 0.72)], "shop_bamboo_dark", verts=12)
    move(wall, (x, y, 0))
    move(rim, (x, y, 0))
    return [wall, rim]


def lid(name, radius, center):
    x, y, z = center
    top = lathe(f"{name}_lid", [(radius, z), (radius, z + 0.03), (radius * 0.75, z + 0.055), (0.0, z + 0.062)], "shop_bamboo", verts=12)
    move(top, (x, y, 0))
    return top


def dumpling(name, center, turn=0.0):
    """A pleated dumpling: a squashed bun with a ridge along its top."""
    x, y, z = center
    body = sphere(f"{name}_b", 0.026, (0, 0, 0), "shop_dough", segments=6, rings=4)
    body.data.transform(__import__("mathutils").Matrix.Diagonal((1.25, 0.95, 0.72, 1)))
    ridge = tube(f"{name}_r", [(-0.024, 0, 0.014), (0, 0, 0.024), (0.024, 0, 0.014)], 0.005, "shop_dough", verts=4)
    part = join([body, ridge], name)
    part.data.transform(__import__("mathutils").Matrix.Rotation(turn, 4, "Z"))
    move(part, (x, y, z + 0.016))
    return part


def dumpling_counter():
    """The dumpling shop's counter, 4 m of red and cream tile; steamers at its north end, a tray
    of folded dumplings at its south end and the middle clear for the plate a player takes."""
    length, depth, height = 4.0, 0.7, 1.05
    parts = counter_body(length, depth, height, "shop_laminate", "shop_cream", "shop_red") + tiles(length, depth, height, "shop_red", "shop_cream", rows=2)
    # Steamers stacked three and two high.
    for i, (x, y, levels) in enumerate(((1.45, 0.02, 3), (1.0, 0.04, 2))):
        for level in range(levels):
            parts += steamer(f"st{i}_{level}", 0.17, 0.075, (x, y, height + level * 0.075))
        parts.append(lid(f"st{i}", 0.17, (x, y, height + levels * 0.075)))
    # A tray of dumplings, rows of them on a steel sheet.
    parts.append(box("tray", -1.72, -1.18, -0.16, 0.16, height, height + 0.012, "shop_steel", bev=0.003))
    rng = random.Random(9)
    for row in range(2):
        for column in range(4):
            parts.append(dumpling(f"d{row}_{column}", (-1.62 + column * 0.12, -0.06 + row * 0.12, height), rng.uniform(-0.3, 0.3)))
    # Soy and chili bottles.
    for i, (x, mat) in enumerate(((0.45, "shop_dark"), (0.56, "shop_chili"))):
        bottle = lathe(f"bottle{i}", [(0.0, 0.0), (0.03, 0.0), (0.03, 0.11), (0.012, 0.15), (0.012, 0.18), (0.0, 0.18)], mat, verts=10)
        move(bottle, (x, -0.2, height))
        parts.append(bottle)
    return join(parts, "dumpling_counter")


def pho_counter():
    """The pho house's counter, 3.4 m of dark green panels; a tray of herbs and limes, a stack of
    bowls and a jar of chopsticks, and its middle clear for the bowl a player takes."""
    length, depth, height = 3.4, 0.7, 1.05
    parts = counter_body(length, depth, height, "shop_wood", "shop_green", "shop_mustard")
    for i, x in enumerate((-1.1, -0.55, 0.0, 0.55, 1.1)):
        parts.append(box(f"panel{i}", x - 0.22, x + 0.22, -0.37, -0.355, 0.2, 0.74, "shop_green", bev=0.004))
    # Herbs and limes on a board.
    parts.append(box("board", -1.42, -0.92, -0.17, 0.17, height, height + 0.02, "shop_bamboo", bev=0.004))
    rng = random.Random(4)
    for i in range(8):
        leaf = sphere(f"leaf{i}", 0.028, (-1.36 + rng.random() * 0.26, -0.12 + rng.random() * 0.24, height + 0.03), "shop_herb", segments=6, rings=4)
        parts.append(leaf)
    for i in range(4):
        parts.append(sphere(f"lime{i}", 0.025, (-1.04 + i % 2 * 0.06, -0.08 + i * 0.05, height + 0.045), "shop_lime", segments=8, rings=5))
    # A stack of bowls and a jar of chopsticks.
    for level in range(5):
        z = height + level * 0.028
        bowl = lathe(f"bowl{level}", [(0.0, z), (0.05, z), (0.105, z + 0.035), (0.11, z + 0.05), (0.102, z + 0.05), (0.045, z + 0.01), (0.0, z + 0.01)], "shop_ceramic_blue" if level % 2 else "shop_ceramic", verts=16)
        move(bowl, (1.05, -0.05, 0))
        parts.append(bowl)
    jar = lathe("jar", [(0.0, height), (0.05, height), (0.05, height + 0.13), (0.045, height + 0.13), (0.045, height + 0.01), (0.0, height + 0.01)], "shop_ceramic_blue", verts=12)
    move(jar, (0.62, -0.18, 0))
    parts.append(jar)
    for i in range(7):
        a = i * 2.4
        parts.append(cylinder(f"stick{i}", 0.004, 0.24, (0.62 + math.cos(a) * 0.022, -0.18 + math.sin(a) * 0.022, height + 0.14), "Z", "shop_wood", verts=4))
    return join(parts, "pho_counter")


def boba_bar():
    """The boba shop's bar, 4.6 m of teal and white: tea urns, a tower of cups, a cup sealer and
    jars of pearls. Its middle is clear for the drink a player takes."""
    length, depth, height = 4.6, 0.65, 1.05
    parts = counter_body(length, depth, height, "shop_white", "shop_teal", "shop_pink") + tiles(length, depth, height, "shop_teal", "shop_white", rows=2)
    # Three tea urns with their taps, in the teas' colours.
    for i, (x, mat) in enumerate(((-1.95, "shop_milk_tea"), (-1.55, "shop_taro"), (-1.15, "shop_matcha"))):
        urn = lathe(f"urn{i}", [(0.0, height), (0.13, height), (0.14, height + 0.03), (0.14, height + 0.42), (0.12, height + 0.46), (0.0, height + 0.47)], "shop_steel", verts=16)
        move(urn, (x, 0.08, 0))
        parts.append(urn)
        parts.append(box(f"label{i}", x - 0.07, x + 0.07, -0.062, -0.058, height + 0.2, height + 0.33, mat))
        parts.append(box(f"tap{i}", x - 0.018, x + 0.018, -0.1, -0.05, height + 0.1, height + 0.135, "shop_dark"))
    # Towers of empty cups.
    for i, x in enumerate((0.75, 0.9)):
        for level in range(9):
            z = height + level * 0.03
            ring_part = lathe(f"cup{i}_{level}", [(0.04, z), (0.052, z + 0.03), (0.0475, z + 0.03)], "shop_cup_lid", verts=10)
            move(ring_part, (x, 0.14, 0))
            parts.append(ring_part)
    # The cup sealer.
    parts.append(box("sealer", 1.32, 1.62, -0.1, 0.2, height, height + 0.1, "shop_dark", bev=0.01))
    parts.append(box("sealer_arm", 1.4, 1.54, -0.02, 0.2, height + 0.1, height + 0.4, "shop_white", bev=0.012))
    parts.append(cylinder("sealer_head", 0.055, 0.05, (1.47, 0.02, height + 0.28), "Z", "shop_steel", verts=12))
    # Jars of pearls.
    for i, x in enumerate((1.85, 2.03)):
        jar = lathe(f"pearlj{i}", [(0.0, height), (0.07, height), (0.075, height + 0.02), (0.075, height + 0.2), (0.05, height + 0.23), (0.0, height + 0.23)], "shop_cup_lid", verts=12)
        move(jar, (x, 0.08, 0))
        parts.append(jar)
        fill = lathe(f"pearlf{i}", [(0.077, height + 0.012), (0.077, height + 0.13), (0.0, height + 0.13)], "shop_pearl", verts=12)
        move(fill, (x, 0.08, 0))
        parts.append(fill)
    return join(parts, "boba_bar")


def drink_fridge():
    """A glass-fronted drinks fridge, lit inside, its shelves full of cans."""
    w, d, h = 0.6, 0.35, 2.0
    parts = [
        box("back", -w, w, 0.28, d, 0.0, h, "shop_dark"),
        box("left", -w, -w + 0.05, -d, d, 0.0, h, "shop_dark"),
        box("right", w - 0.05, w, -d, d, 0.0, h, "shop_dark"),
        box("bottom", -w, w, -d, d, 0.0, 0.2, "shop_dark"),
        box("head", -w, w, -d, d, h - 0.2, h, "shop_teal", bev=0.006),
        box("inner", -w + 0.05, w - 0.05, 0.26, 0.28, 0.2, h - 0.2, "glow_fridge"),
        box("frame_mid", -0.012, 0.012, -d - 0.002, -d + 0.02, 0.2, h - 0.2, "shop_dark"),
    ]
    mats = ("shop_can_a", "shop_can_b", "shop_can_c", "shop_white")
    for level, z in enumerate((0.3, 0.72, 1.14, 1.56)):
        parts.append(box(f"shelf{level}", -w + 0.05, w - 0.05, -0.28, 0.26, z - 0.012, z, "shop_steel"))
        for i in range(8):
            x = -0.46 + i * 0.13
            can = cylinder(f"can{level}_{i}", 0.033, 0.12, (x, -0.2, z + 0.06), "Z", mats[(i + level) % 4], verts=8)
            parts.append(can)
    return join(parts, "drink_fridge")


# --- on the cooking lines -----------------------------------------------------------------------

def steamer_stack():
    """Four tall bamboo steamers on a range burner."""
    parts = []
    for level in range(4):
        parts += steamer(f"s{level}", 0.2, 0.09, (0, 0, level * 0.09))
    parts.append(lid("top", 0.2, (0, 0, 0.36)))
    return join(parts, "steamer_stack")


def stock_pots():
    """Two big stockpots of pho broth with ladles, on a range."""
    parts = []
    for i, (y, radius, height) in enumerate(((-0.42, 0.22, 0.42), (0.42, 0.18, 0.34))):
        pot = lathe(f"pot{i}", [(0.0, 0.0), (radius, 0.0), (radius, height), (radius - 0.012, height), (radius - 0.012, 0.02), (0.0, 0.02)], "shop_steel", verts=20)
        broth = cylinder(f"broth{i}", radius - 0.013, 0.01, (0, 0, height - 0.05), "Z", "shop_broth", verts=20)
        rim = lathe(f"rim{i}", [(radius, height - 0.02), (radius + 0.008, height - 0.01), (radius + 0.008, height), (radius, height)], "shop_steel", verts=20)
        handles = [box(f"h{i}{side}", side * radius - 0.035, side * radius + 0.035, -0.03, 0.03, height - 0.09, height - 0.07, "shop_dark") for side in (-1, 1)]
        ladle = tube(f"ladle{i}", [(radius * 0.3, 0, height - 0.04), (radius * 0.75, 0.05, height + 0.2)], 0.008, "shop_dark", verts=5)
        for part in [pot, broth, rim, *handles, ladle]:
            move(part, (y, 0, 0))
            parts.append(part)
    return join(parts, "stock_pots")


# --- what a player takes ------------------------------------------------------------------------

def food_dumplings():
    """A small open steamer of dumplings on a saucer."""
    parts = [lathe("saucer", [(0.0, 0.0), (0.11, 0.0), (0.135, 0.018), (0.128, 0.022), (0.1, 0.008), (0.0, 0.008)], "shop_ceramic", verts=18)]
    parts += steamer("basket", 0.1, 0.05, (0, 0, 0.012))
    for i in range(6):
        a = i * math.tau / 5 if i else 0.0
        r = 0.058 if i else 0.0
        parts.append(dumpling(f"d{i}", (math.cos(a) * r, math.sin(a) * r, 0.028), a))
    return join(parts, "food_dumplings")


def food_pho():
    """A blue-and-white bowl of pho with noodles, beef, herbs and chopsticks across it."""
    parts = [
        lathe("bowl", [(0.0, 0.0), (0.055, 0.0), (0.125, 0.07), (0.135, 0.09), (0.127, 0.09), (0.05, 0.012), (0.0, 0.012)], "shop_ceramic", verts=20),
        lathe("band", [(0.128, 0.078), (0.1365, 0.09), (0.1335, 0.09), (0.125, 0.078)], "shop_ceramic_blue", verts=20),
        cylinder("broth", 0.122, 0.006, (0, 0, 0.07), "Z", "shop_broth", verts=20),
    ]
    # A mound of noodles with strands looping over it.
    mound = sphere("mound", 0.09, (0, 0, 0), "shop_noodle", segments=10, rings=5)
    mound.data.transform(__import__("mathutils").Matrix.Translation((0, 0, 0.074)) @ __import__("mathutils").Matrix.Diagonal((1, 1, 0.14, 1)))
    parts.append(mound)
    rng = random.Random(6)
    for i in range(3):
        a0, r = rng.uniform(0, math.tau), rng.uniform(0.03, 0.08)
        points = [(math.cos(a0 + t * 0.22) * (r + t * 0.002), math.sin(a0 + t * 0.22) * (r + t * 0.002), 0.086 - 0.0012 * abs(t - 7)) for t in range(14)]
        parts.append(tube(f"noodle{i}", points, 0.0026, "shop_noodle", verts=3, caps=False))
    for i, (x, y) in enumerate(((-0.045, 0.02), (0.02, -0.05), (0.05, 0.04))):
        parts.append(box(f"beef{i}", x - 0.024, x + 0.024, y - 0.017, y + 0.017, 0.075, 0.08, "shop_beef", bev=0.002))
    for i in range(4):
        a = rng.uniform(0, math.tau)
        parts.append(sphere(f"herb{i}", 0.01, (math.cos(a) * 0.06, math.sin(a) * 0.06, 0.082), "shop_herb", segments=5, rings=3))
    for i, dy in enumerate((-0.012, 0.012)):
        parts.append(tube(f"stick{i}", [(-0.16, dy, 0.095), (0.16, dy + 0.01, 0.105)], 0.004, "shop_wood", verts=4))
    return join(parts, "food_pho")


def food_boba():
    """A sealed cup of milk tea with its pearls in the bottom and a fat red straw."""
    height = 0.155
    parts = [
        lathe("cup", [(0.0, 0.0), (0.036, 0.0), (0.05, height), (0.0, height)], "shop_milk_tea", verts=16),
        lathe("lid", [(0.05, height), (0.054, height + 0.004), (0.054, height + 0.01), (0.0, height + 0.012)], "shop_cup_lid", verts=16),
        tube("straw", [(0.012, 0.0, height), (0.018, 0.004, height + 0.1)], 0.0065, "shop_straw", verts=8),
    ]
    rng = random.Random(12)
    for i in range(10):
        a = rng.uniform(0, math.tau)
        z = rng.uniform(0.006, 0.05)
        r = 0.036 + z * 0.09
        parts.append(sphere(f"pearl{i}", 0.0078, (math.cos(a) * r, math.sin(a) * r, z), "shop_pearl", segments=6, rings=4))
    return join(parts, "food_boba")


# --- menus --------------------------------------------------------------------------------------

def menu(name, title, lines):
    """A chalkboard menu in a wooden frame: a title and a few priced lines."""
    w, h = 1.3, 0.82
    parts = [
        box("board", -w / 2, w / 2, -0.015, 0.0, -h / 2, h / 2, "shop_board"),
        box("top", -w / 2 - 0.03, w / 2 + 0.03, -0.03, 0.0, h / 2, h / 2 + 0.03, "shop_wood"),
        box("bottom", -w / 2 - 0.03, w / 2 + 0.03, -0.03, 0.0, -h / 2 - 0.03, -h / 2, "shop_wood"),
        box("left", -w / 2 - 0.03, -w / 2, -0.03, 0.0, -h / 2, h / 2, "shop_wood"),
        box("right", w / 2, w / 2 + 0.03, -0.03, 0.0, -h / 2, h / 2, "shop_wood"),
    ]
    head = fit(text_mesh("head", title, 0.17, "shop_chalk_warm", resolution=2), w - 0.16)
    move(head, (0, -0.017, 0.27))
    parts.append(head)
    for i, (item, price) in enumerate(lines):
        z = 0.08 - i * 0.145
        left = fit(text_mesh(f"item{i}", item, 0.095, "shop_chalk", align="LEFT", resolution=1), 0.84)
        right = text_mesh(f"price{i}", price, 0.095, "shop_chalk_warm", align="RIGHT", resolution=1)
        # Each line is set on its own centre, so the prices sit level with their items.
        for text, x in ((left, -w / 2 + 0.09), (right, w / 2 - 0.09)):
            zs = [v.co.z for v in text.data.vertices]
            move(text, (x, -0.017, z - (min(zs) + max(zs)) / 2))
        parts += [left, right]
    return join(parts, name)


def menu_dumplings():
    return menu("menu_dumplings", "DUMPLINGS", [("PORK & CHIVE X8", "9"), ("SHRIMP X8", "11"), ("VEG X8", "8"), ("HOT CHILI OIL", "1")])


def menu_pho():
    return menu("menu_pho", "PHO", [("RARE BEEF", "14"), ("BRISKET", "15"), ("CHICKEN", "13"), ("EXTRA NOODLES", "3")])


def menu_boba():
    return menu("menu_boba", "BOBA", [("MILK TEA", "6"), ("TARO", "7"), ("MATCHA", "7"), ("EXTRA PEARLS", "1")])


PIECES = [
    Piece("dumpling_counter", dumpling_counter, 9000, (4.0, 0.74, 1.3), "base", "The dumpling shop's counter and what stands on it.", 60),
    Piece("pho_counter", pho_counter, 6000, (3.4, 0.74, 1.35), "base", "The pho house's counter and what stands on it.", 60),
    Piece("boba_bar", boba_bar, 7000, (4.6, 0.69, 1.52), "base", "The boba shop's bar and what stands on it.", 60),
    Piece("drink_fridge", drink_fridge, 2600, (1.2, 0.7, 2.0), "base", "The boba shop's lit drinks fridge."),
    Piece("steamer_stack", steamer_stack, 1200, None, "base", "Stands on the dumpling shop's range.", 60),
    Piece("stock_pots", stock_pots, 1600, None, "base", "Stands on the pho house's range.", 60),
    Piece("food_dumplings", food_dumplings, 1400, None, "base", "Taken from the dumpling counter for health.", 60),
    Piece("food_pho", food_pho, 1500, None, "base", "Taken from the pho counter for health.", 60),
    Piece("food_boba", food_boba, 1100, None, "base", "Taken from the boba bar for speed.", 60),
    Piece("menu_dumplings", menu_dumplings, 5000, None, None, "Above the dumpling counter."),
    Piece("menu_pho", menu_pho, 5000, None, None, "Above the pho counter."),
    Piece("menu_boba", menu_boba, 5000, None, None, "On the boba shop's wall."),
]
