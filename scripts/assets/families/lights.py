"""The market's lamps: paper lanterns, string-light bulbs and their cable, the service alley's
wall lamps, the restaurant's pendants, the stalls' work lamps, the pool-table lamp and the
breaker box. Built into public/models/lights.glb by scripts/assets/build.py.

Glass that lights up uses a glow_* material: the game draws it with its own lamp material,
and swaps in dark glass when the lamp is shot out. Hanging lamps have their origin at the
point placed by the game (see each piece); wall pieces back onto y = 0 and face -Y.
"""

import math

from lib import Piece, box, cylinder, join, jitter, lathe, material, move, ring, sphere, tear, tube


def materials():
    material("glow_paper", 0xffffff, 0.0, 0.8)
    material("glow_bulb", 0xfff2d8, 0.0, 0.2)
    material("glow_led", 0x4dff6a, 0.0, 0.3)
    material("paper_scorched", 0x3a1a14, 0.0, 0.95)
    material("lacquer_black", 0x16110e, 0.2, 0.35)
    material("lacquer_red", 0x8c1d14, 0.1, 0.4)
    material("tassel_red", 0xb8231c, 0.0, 0.85)
    material("bamboo", 0x2b1a10, 0.0, 0.7)
    material("rubber_black", 0x121212, 0.0, 0.7)
    material("cable_black", 0x15161a, 0.1, 0.55)
    material("enamel_green", 0x2f5d50, 0.15, 0.35)
    material("enamel_cream", 0xe8e0cc, 0.1, 0.3)
    material("enamel_white", 0xf3f0e8, 0.0, 0.25)
    material("lamp_brass", 0xb08a3e, 1.0, 0.32)
    material("cage_steel", 0x2b2e30, 0.8, 0.45)
    material("shade_green", 0x1f5a3a, 0.2, 0.18)
    material("panel_grey", 0x5c6266, 0.6, 0.5)
    material("panel_dark", 0x2c3134, 0.6, 0.55)
    material("label_yellow", 0xf2c230, 0.0, 0.5)
    material("label_black", 0x141414, 0.0, 0.6)
    material("conduit_grey", 0x8d9296, 0.8, 0.4)


# --- paper lanterns: origin at the middle of the paper, as the game swings it ---------------

LANTERN_PROFILE = [(0.06, -0.25), (0.11, -0.242), (0.155, -0.222), (0.19, -0.185), (0.211, -0.13), (0.22, -0.065), (0.222, 0.0), (0.22, 0.065), (0.211, 0.13), (0.19, 0.185), (0.155, 0.222), (0.11, 0.242), (0.06, 0.25)]
# The bamboo hoops the paper is stretched over, which stay dark against the glow.
HOOPS = [-0.16, -0.055, 0.055, 0.16]


def hoops():
    out = []
    for z in HOOPS:
        r = next(r0 + (r1 - r0) * (z - z0) / (z1 - z0) for (r0, z0), (r1, z1) in zip(LANTERN_PROFILE, LANTERN_PROFILE[1:]) if z0 <= z <= z1)
        out.append(ring(f"hoop{z}", r + 0.003, 0.0035, (0, 0, z), "Z", "bamboo", verts=16, minor_verts=4))
    return out


def lantern_fittings():
    return [
        cylinder("cap_top", 0.075, 0.035, (0, 0, 0.262), "Z", "lacquer_black", verts=16),
        cylinder("cap_bottom", 0.075, 0.035, (0, 0, -0.262), "Z", "lacquer_black", verts=16),
        ring("rim_top", 0.062, 0.006, (0, 0, 0.245), "Z", "lacquer_red", verts=16, minor_verts=4),
        ring("rim_bottom", 0.062, 0.006, (0, 0, -0.245), "Z", "lacquer_red", verts=16, minor_verts=4),
        cylinder("cord", 0.004, 0.16, (0, 0, 0.36), "Z", "cable_black", verts=6),
        sphere("knot", 0.016, (0, 0, -0.295), "tassel_red", segments=8, rings=5),
        cylinder("tassel", 0.028, 0.13, (0, 0, -0.375), "Z", "tassel_red", verts=10, radius2=0.012),
    ]


def lantern():
    """A ribbed paper lantern on a cord, lacquered caps top and bottom and a red tassel."""
    paper = lathe("paper", LANTERN_PROFILE, "glow_paper", verts=24)
    return join([paper] + hoops() + lantern_fittings(), "lantern")


def lantern_torn():
    """The same lantern shot through: its paper scorched, crumpled and torn open."""
    paper = lathe("paper", LANTERN_PROFILE, "paper_scorched", verts=24)
    tear(paper, 0.3, seed=7)
    jitter(paper, 0.012, seed=3)
    return join([paper] + hoops() + lantern_fittings(), "lantern_torn")


# --- string lights: origin where the socket clips onto the cable ------------------------------

def bulb():
    """A globe festoon bulb hanging from its rubber socket under the cable."""
    socket = cylinder("socket", 0.013, 0.028, (0, 0, -0.014), "Z", "rubber_black", verts=6)
    glass = lathe("glass", [(0.01, -0.028), (0.024, -0.042), (0.03, -0.06), (0.022, -0.08), (0.0, -0.092)], "glow_bulb", verts=8)
    return join([socket, glass], "bulb")


def cable():
    """One metre of cable along +X from the origin; the game stretches it between hang points
    and thickens it for the power lines."""
    return tube("cable", [(0, 0, 0), (1, 0, 0)], 0.005, "cable_black", verts=6, caps=False)


# --- the service alley's wall lamps: backs onto the wall, the shade 0.36 m out ----------------

def sconce():
    """A gooseneck barn lamp: a wall plate, an arm curving out and down, an enamel dish shade
    over a bare bulb."""
    plate = box("plate", -0.07, 0.07, -0.02, 0.0, -0.1, 0.1, "enamel_green", bev=0.006)
    arm = tube("arm", [(0, -0.02, 0.0), (0, -0.1, 0.03), (0, -0.2, 0.05), (0, -0.29, 0.04), (0, -0.345, 0.0), (0, -0.36, -0.07)], 0.016, "enamel_green", verts=8)
    shade_out = lathe("shade_out", [(0.17, -0.2), (0.15, -0.17), (0.09, -0.11), (0.035, -0.085), (0.03, -0.075)], "enamel_green", verts=20)
    shade_in = lathe("shade_in", [(0.165, -0.199), (0.145, -0.172), (0.088, -0.115), (0.034, -0.09)], "enamel_white", verts=20)
    for part in (shade_out, shade_in):
        move(part, (0, -0.36, 0))
    shade_in.data.flip_normals()
    rim = ring("rim", 0.17, 0.006, (0, -0.36, -0.2), "Z", "enamel_green", verts=20)
    glass = lathe("glass", [(0.012, -0.1), (0.03, -0.13), (0.035, -0.15), (0.028, -0.175), (0.0, -0.185)], "glow_bulb", verts=10)
    move(glass, (0, -0.36, 0))
    return join([plate, arm, shade_out, shade_in, rim, glass], "sconce")


# --- restaurant pendants: origin at the middle of the shade, the cord up to the ceiling --------

def pendant():
    """An enamel pendant shade on a cloth cord, cream outside and white within, its bulb low in
    the shade."""
    outside = lathe("outside", [(0.16, -0.11), (0.155, -0.095), (0.11, -0.04), (0.06, 0.04), (0.035, 0.1), (0.03, 0.11)], "enamel_cream", verts=24)
    inside = lathe("inside", [(0.155, -0.108), (0.15, -0.094), (0.106, -0.04), (0.057, 0.038), (0.032, 0.09)], "enamel_white", verts=24)
    inside.data.flip_normals()
    rim = ring("rim", 0.158, 0.005, (0, 0, -0.11), "Z", "lamp_brass", verts=24)
    cap = cylinder("cap", 0.034, 0.05, (0, 0, 0.135), "Z", "lamp_brass", verts=12)
    cord = cylinder("cord", 0.0035, 0.95, (0, 0, 0.635), "Z", "cable_black", verts=6)
    canopy = cylinder("canopy", 0.05, 0.03, (0, 0, 1.11), "Z", "lamp_brass", verts=12)
    glass = lathe("glass", [(0.012, 0.06), (0.034, 0.02), (0.04, -0.01), (0.032, -0.04), (0.0, -0.055)], "glow_bulb", verts=10)
    return join([outside, inside, rim, cap, cord, canopy, glass], "pendant")


# --- the stalls' work lamps: origin at the bulb ------------------------------------------------

def cage_lamp():
    """A caged work lamp hung from a hook under a stall's awning: a small reflector, a wire
    cage and the bulb inside."""
    hook = ring("hook", 0.02, 0.003, (0, 0, 0.14), "Y", "cage_steel", verts=10)
    holder = cylinder("holder", 0.02, 0.05, (0, 0, 0.1), "Z", "rubber_black", verts=10)
    reflector = lathe("reflector", [(0.07, 0.04), (0.05, 0.065), (0.022, 0.08)], "cage_steel", verts=12)
    cage = [ring(f"band{i}", r, 0.0025, (0, 0, z), "Z", "cage_steel", verts=10) for i, (r, z) in enumerate(((0.068, 0.035), (0.06, -0.03)))]
    for k in range(4):
        a = k * math.pi / 2
        cage.append(tube(f"bar{k}", [(math.cos(a) * 0.068, math.sin(a) * 0.068, 0.04), (math.cos(a) * 0.064, math.sin(a) * 0.064, -0.02),
                                       (math.cos(a) * 0.036, math.sin(a) * 0.036, -0.085), (0, 0, -0.1)], 0.0025, "cage_steel", verts=4, caps=False))
    glass = lathe("glass", [(0.012, 0.075), (0.03, 0.04), (0.036, 0.0), (0.03, -0.035), (0.0, -0.05)], "glow_bulb", verts=8)
    return join([hook, holder, reflector, glass] + cage, "cage_lamp")


# --- the pool table's lamp: origin at the middle of the shade ----------------------------------

def billiard_lamp():
    """A green glass dome on two brass chains, its bulb glowing under the rim."""
    dome = lathe("dome", [(0.25, -0.06), (0.245, -0.04), (0.21, 0.0), (0.14, 0.04), (0.06, 0.06), (0.03, 0.065)], "shade_green", verts=28)
    dome_in = lathe("dome_in", [(0.244, -0.058), (0.24, -0.04), (0.205, -0.002), (0.136, 0.036), (0.058, 0.055)], "enamel_white", verts=28)
    dome_in.data.flip_normals()
    rim = ring("rim", 0.25, 0.007, (0, 0, -0.06), "Z", "lamp_brass", verts=28)
    finial = cylinder("finial", 0.035, 0.05, (0, 0, 0.09), "Z", "lamp_brass", verts=12)
    # The chain reaches the bar's ceiling, a metre above the shade.
    chains = [tube("chain", [(0, 0, 0.11), (0, 0, 0.985)], 0.005, "lamp_brass", verts=4), cylinder("canopy", 0.06, 0.03, (0, 0, 0.99), "Z", "lamp_brass", verts=12)]
    glass = lathe("glass", [(0.014, 0.05), (0.04, 0.01), (0.045, -0.02), (0.035, -0.045), (0.0, -0.058)], "glow_bulb", verts=10)
    return join([dome, dome_in, rim, finial, glass] + chains, "billiard_lamp")


# --- the breaker box on the service alley wall: backs onto the wall, centred on the cabinet ---

def breaker_box():
    """A grey steel cabinet with a hinged door, a warning label and a green light, its conduit
    climbing the wall."""
    cabinet = box("cabinet", -0.25, 0.25, -0.17, 0.0, -0.35, 0.35, "panel_grey", bev=0.01)
    door = box("door", -0.235, 0.235, -0.185, -0.17, -0.335, 0.335, "panel_grey", bev=0.004)
    seam = box("seam", -0.237, 0.237, -0.182, -0.171, -0.337, -0.333, "panel_dark")
    hinges = [cylinder(f"hinge{z}", 0.009, 0.08, (-0.243, -0.178, z), "Z", "panel_dark", verts=8) for z in (-0.22, 0.22)]
    handle = box("handle", 0.17, 0.2, -0.2, -0.185, -0.06, 0.06, "panel_dark", bev=0.004)
    label = box("label", -0.08, 0.08, -0.187, -0.185, 0.12, 0.26, "label_yellow")
    bolt = box("bolt", -0.012, 0.012, -0.189, -0.186, 0.14, 0.24, "label_black")
    led = cylinder("led", 0.009, 0.012, (0.18, -0.191, 0.27), "Y", "glow_led", verts=10)
    conduit = tube("conduit", [(0.0, -0.06, 0.35), (0.0, -0.06, 2.55)], 0.026, "conduit_grey", verts=10)
    straps = [box(f"strap{z}", -0.04, 0.04, -0.095, -0.0, z - 0.012, z + 0.012, "conduit_grey") for z in (0.9, 1.6, 2.3)]
    gland = cylinder("gland", 0.034, 0.04, (0.0, -0.06, 0.37), "Z", "panel_dark", verts=10)
    return join([cabinet, door, seam, handle, label, bolt, led, conduit, gland] + hinges + straps, "breaker_box")


PIECES = [
    Piece("lantern", lantern, 1800, (0.45, 0.45, 0.88), "center", "Each of the 12 lanterns over the market alley; tinted orange or red by the game.", 60),
    Piece("lantern_torn", lantern_torn, 1800, None, None, "A lantern after it is shot.", 60),
    Piece("bulb", bulb, 100, (0.06, 0.06, 0.092), "top", "Every string-light bulb, hundreds of them: keep it cheap.", 60),
    Piece("cable", cable, 12, (1.0, 0.01, 0.01), None, "Stretched and thickened per span."),
    Piece("sconce", sconce, 900, (0.35, 0.54, 0.3), "wall", "The ten wall lamps in the service alley."),
    Piece("pendant", pendant, 1100, (0.33, 0.33, 1.24), None, "Restaurant pendants and, smaller, the pass lamps."),
    Piece("cage_lamp", cage_lamp, 800, (0.14, 0.14, 0.26), None, "The lamp under every stall's awning."),
    Piece("billiard_lamp", billiard_lamp, 1200, (0.51, 0.51, 1.07), None, "Over the bar's pool table."),
    Piece("breaker_box", breaker_box, 900, (0.5, 0.2, 2.9), "wall", "The service alley's breaker box: shoot it and the alley goes dark."),
]
