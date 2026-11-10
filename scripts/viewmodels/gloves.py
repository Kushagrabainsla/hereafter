"""Turn the arms of the source character into a gloved, sleeved pair built for close viewing.

The character's arms were made to be seen from metres away, so this keeps their skeleton and
skin weights and rebuilds what is on top of them:

  * the mesh gets more detail at the hands, a real step where the glove's cuff ends, and a
    thickness of fabric over the skin;
  * a much denser copy is modelled with panels, knuckle pads, seams, stitching, a wrist strap
    and sleeve folds, all placed from the bones, and baked down to colour, normal and
    roughness textures on new UVs with an even density.

The bake takes minutes and depends only on the arms, not on the weapon, so its result is kept
in assets-src/viewmodels/gloves and reused until a build asks for --rebake.
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

CACHE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets-src", "viewmodels", "gloves"))
SIZE = 2048
ROUGH_SIZE = 1024
# How far up the forearm the parts of the glove reach, in metres from the wrist joint.
BAND_END = 0.015
CUFF_END = 0.064
CUFF_STEP = 0.0008
# Finger thickness at the knuckle, for wrapping seams around each finger.
FINGER_RADIUS = 0.008
# The sleeve is seen far less than the glove, so it gets a fifth of the texture per area.
SLEEVE_DENSITY = 0.2
WEAVE_PERIOD = 0.0013
HIGH_LEVELS = 3

# Colours as sRGB values, taken from worn field gloves rather than any one product.
PALETTES = {
    "olive": {"fabric": (110, 102, 80), "pad": (88, 83, 68), "leather": (70, 65, 57), "strap": (60, 60, 54), "thread": (150, 140, 114), "sleeve": (92, 96, 78), "wear": (180, 165, 136)},
    "coyote": {"fabric": (176, 140, 98), "pad": (152, 118, 82), "leather": (96, 80, 64), "strap": (112, 94, 72), "thread": (204, 184, 142), "sleeve": (122, 120, 96), "wear": (216, 196, 158)},
}

_lattice = np.random.default_rng(7).random((64, 64, 64))


def log(*args):
    print("[gloves]", *args, flush=True)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def image_to_np(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def np_to_image(name, a, srgb=True):
    h, w = a.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    img.pixels.foreach_set(np.ascontiguousarray(a, dtype=np.float32).ravel())
    img.pack()
    return img


def resample(a, w, h):
    """Resize a float RGBA array with Blender's image scaler."""
    tmp = np_to_image("tmp_resample", a, srgb=False)
    tmp.scale(w, h)
    out = image_to_np(tmp)
    bpy.data.images.remove(tmp)
    return out


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss(x, width):
    return np.exp(-(x / width) ** 2)


def rbox(x, y, hx, hy, r):
    """Signed distance to a rounded rectangle: negative inside."""
    qx, qy = np.abs(x) - hx + r, np.abs(y) - hy + r
    return np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0)) + np.minimum(np.maximum(qx, qy), 0.0) - r


def noise(p, wavelength):
    """Smooth value noise in -1..1 at points p."""
    q = p / wavelength
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3.0 - 2.0 * f)

    def at(dx, dy, dz):
        return _lattice[(i[:, 0] + dx) & 63, (i[:, 1] + dy) & 63, (i[:, 2] + dz) & 63]

    x0 = at(0, 0, 0) * (1 - f[:, 0]) + at(1, 0, 0) * f[:, 0]
    x1 = at(0, 1, 0) * (1 - f[:, 0]) + at(1, 1, 0) * f[:, 0]
    x2 = at(0, 0, 1) * (1 - f[:, 0]) + at(1, 0, 1) * f[:, 0]
    x3 = at(0, 1, 1) * (1 - f[:, 0]) + at(1, 1, 1) * f[:, 0]
    y0 = x0 * (1 - f[:, 1]) + x1 * f[:, 1]
    y1 = x2 * (1 - f[:, 1]) + x3 * f[:, 1]
    return (y0 * (1 - f[:, 2]) + y1 * f[:, 2]) * 2.0 - 1.0


def fbm(p, wavelength, octaves=3):
    total, weight = 0.0, 1.0
    for k in range(octaves):
        total = total + noise(p + k * 3.7, wavelength) * weight
        wavelength, weight = wavelength * 0.5, weight * 0.5
    return total


def rig_for(arm, info, side):
    """The axes and joints the glove is laid out from, for one arm in its rest pose."""
    bones = arm.data.bones
    wrist = bones[f"Bip01 {side} Hand"].head_local.copy()
    elbow = bones[f"Bip01 {side} Forearm"].head_local.copy()
    axis = (elbow - wrist).normalized()
    f = info[side]["f"].normalized()
    n = (info[side]["n"] - f * info[side]["n"].dot(f)).normalized()
    thumb_tip = bones[f"Bip01 {side} Finger02"].tail_local
    s = f.cross(n).normalized()
    if s.dot(thumb_tip - wrist) < 0:
        s = -s
    fore_back = (-n - axis * (-n).dot(axis)).normalized()
    fingers = []
    for i in range(5):
        names = [f"Bip01 {side} Finger{i}", f"Bip01 {side} Finger{i}1", f"Bip01 {side} Finger{i}2"]
        points = [np.array(bones[name].head_local - wrist) for name in names] + [np.array(bones[names[2]].tail_local - wrist)]
        direction = Vector(points[3] - points[1]).normalized()
        back = (s * 0.8 - n * 0.6) if i == 0 else -n
        back = (back - direction * back.dot(direction)).normalized()
        fingers.append({"points": np.array(points), "back": np.array(back), "side": np.array(direction.cross(back))})
    return {
        "side": side, "wrist": np.array(wrist), "axis": np.array(axis), "f": np.array(f), "n": np.array(n), "s": np.array(s),
        "fore_back": np.array(fore_back), "fore_side": np.array(axis.cross(fore_back)), "palm": info[side]["d_palm"], "fingers": fingers,
    }


def nearest_on_chain(q, points):
    """For each point, the closest place on a finger's bones."""
    best = np.full(len(q), np.inf)
    along = np.zeros(len(q))
    seg = np.zeros(len(q), dtype=np.int64)
    foot = np.zeros_like(q)
    start = np.zeros(len(q))
    length = np.ones(len(q))
    first = None
    travelled = 0.0
    for k in range(3):
        a, d = points[k], points[k + 1] - points[k]
        square = float(d @ d)
        span = math.sqrt(square)
        t = ((q - a) @ d) / square
        if k == 0:
            first = t
        c = np.clip(t, 0.0, 1.0)
        at = a + c[:, None] * d
        dist = np.linalg.norm(q - at, axis=1)
        better = dist < best
        best[better], seg[better], foot[better] = dist[better], k, at[better]
        along[better], start[better], length[better] = travelled + c[better] * span, travelled, span
        travelled += span
    return best, along, seg, foot, start, length, first


def evaluate(p, nrm, rig, palette):
    """The glove at points p on one arm: thickness added to the mesh, finer relief, colour, and
    (roughness, cloth weave, leather grain)."""
    count = len(p)
    q = p - rig["wrist"]
    fa = q @ rig["axis"]
    ha = q @ rig["f"]
    ac = q @ rig["s"]
    colors = {k: np.array(v, dtype=np.float64) / 255.0 for k, v in palette.items()}

    # Which finger each point is on, if any.
    chains = [nearest_on_chain(q, finger["points"]) for finger in rig["fingers"]]
    radii = [0.017, 0.0145, 0.0145, 0.0145, 0.013]
    dists = np.stack([np.where((c[6] >= -0.03) & (c[0] < radii[i]), c[0], np.inf) for i, c in enumerate(chains)], axis=1)
    fid = np.argmin(dists, axis=1)
    on_finger = np.min(dists, axis=1) < np.inf
    index = np.arange(count)
    along = np.stack([c[1] for c in chains], axis=1)[index, fid]
    seg = np.stack([c[2] for c in chains], axis=1)[index, fid]
    foot = np.stack([c[3] for c in chains], axis=2)[index, :, fid]
    start = np.stack([c[4] for c in chains], axis=1)[index, fid]
    length = np.stack([c[5] for c in chains], axis=1)[index, fid]
    backs = np.array([finger["back"] for finger in rig["fingers"]])[fid]
    sides = np.array([finger["side"] for finger in rig["fingers"]])[fid]
    r = q - foot
    theta = np.arctan2(np.sum(r * sides, axis=1), np.sum(r * backs, axis=1))
    u = theta * FINGER_RADIUS
    centred = along - start - length * 0.5
    thumb = fid == 0
    # A soft edge where a finger grows out of the hand, so nothing steps at the boundary.
    soft = np.stack([ss(-0.03, 0.1, c[6]) * ss(radii[i], radii[i] - 0.0035, c[0]) for i, c in enumerate(chains)], axis=1)
    finger_share = soft[index, fid]
    # Real panels are cut and sewn by hand: no edge is perfectly straight.
    wobble_ac = ac + noise(p, 0.018) * 0.0007
    wobble_ha = ha + noise(p + 5.0, 0.018) * 0.0007

    # The regions along the arm.
    sleeve = ss(CUFF_END - CUFF_STEP * 0.6, CUFF_END + CUFF_STEP * 0.6, fa)
    past_band = ss(BAND_END - 0.002, BAND_END + 0.002, fa)
    past_hand = ss(-0.006, -0.001, fa)
    cuff = past_band * (1 - sleeve)
    band = past_hand * (1 - past_band)
    hand = 1 - past_hand

    facing = nrm @ rig["n"]
    back = ss(0.05, 0.4, -facing)
    palm = ss(0.05, 0.4, facing)

    # Thickness of material over the skin: this one changes the outline of the arm.
    knuckles = np.zeros(count)
    for finger in rig["fingers"][1:]:
        head = finger["points"][0]
        knuckles = np.maximum(knuckles, gauss(ha - float(head @ rig["f"]), 0.016) * gauss(ac - float(head @ rig["s"]), 0.012))
    coarse = sleeve * 0.0022 + cuff * 0.0042 + band * 0.0012 + hand * (0.0008 + 0.0005 * (1 - finger_share)) + hand * back * (1 - finger_share) * knuckles * 0.0016

    fine = np.zeros(count)
    color = np.tile(colors["fabric"], (count, 1))
    rough = np.full(count, 0.86)
    weave = np.ones(count)
    grain = np.zeros(count)
    edges = np.zeros(count)
    thread = np.zeros(count)
    stitches_along = lambda x: ss(-0.2, 0.25, np.sin(2 * np.pi * x / 0.0034))

    def paint(mask, name):
        nonlocal color
        color = color * (1 - mask[:, None]) + colors[name] * mask[:, None]

    def leather(mask):
        nonlocal rough, weave, grain
        paint(mask, "leather")
        rough = rough * (1 - mask) + 0.6 * mask
        weave = weave * (1 - mask)
        grain = grain * (1 - mask) + mask

    # --- fingers ---
    pad_height = np.where(thumb, np.array([0.0, 0.85, 0.4])[seg], np.array([0.85, 0.55, 0.0])[seg]) * 0.001
    use_pad = np.where(thumb, seg > 0, seg < 2)
    finger_mask = hand * finger_share
    pad_edge = rbox(u + noise(p, 0.009) * 0.0005, centred + noise(p + 3.0, 0.009) * 0.0006, 0.0056, length * 0.31, 0.0042)
    pad = (1 - ss(-0.0016, 0.0, pad_edge)) * use_pad
    fine += finger_mask * pad * pad_height
    fine -= finger_mask * use_pad * gauss(pad_edge - 0.0002, 0.0006) * 0.0003
    edges = np.maximum(edges, finger_mask * use_pad * gauss(pad_edge + 0.0007, 0.001))
    paint(finger_mask * pad, "pad")

    palm_u = (np.abs(theta) - np.pi) * FINGER_RADIUS
    palm_edge = rbox(palm_u, centred, 0.0062, length * 0.4, 0.003)
    palm_pad = (1 - ss(-0.0008, 0.0, palm_edge)) * use_pad
    fine += finger_mask * palm_pad * 0.0006
    fine -= finger_mask * use_pad * gauss(palm_edge - 0.0003, 0.0005) * 0.00035
    leather(finger_mask * ss(-0.1, -0.5, np.cos(theta)))

    for i, finger in enumerate(rig["fingers"]):
        points = finger["points"]
        spans = np.linalg.norm(points[1:] - points[:-1], axis=1)
        mine = finger_mask * (fid == i)
        for joint in (spans[0], spans[0] + spans[1]):
            distance = along - joint
            ragged = distance + noise(p, 0.006) * 0.0006
            fine -= mine * gauss(ragged, 0.0011) * 0.0009
            for offset, depth in ((-0.0033, 0.00032), (0.0034, 0.00032), (-0.006, 0.00016), (0.006, 0.00016)):
                fine -= mine * gauss(ragged - offset, 0.0006) * depth * ss(0.0, 0.5, np.abs(np.cos(theta)))
        tip = spans.sum() - 0.0115
        tip_seam = np.cos(theta) * 0.0045 + tip - along
        fine -= mine * gauss(tip_seam, 0.0005) * 0.0004
    side_seam = (np.abs(np.abs(theta) - np.pi / 2)) * FINGER_RADIUS
    fine -= finger_mask * gauss(side_seam, 0.0007) * 0.00045
    side_stitch = gauss(side_seam - 0.0015, 0.00035) * stitches_along(along)
    fine += finger_mask * side_stitch * 0.00016
    thread = np.maximum(thread, finger_mask * side_stitch)

    # --- back of the hand and palm ---
    palm_zone = hand * (1 - finger_share)
    pad_field = np.full(count, np.inf)
    for finger in rig["fingers"][1:]:
        head = finger["points"][0]
        pad_field = np.minimum(pad_field, rbox(wobble_ac - float(head @ rig["s"]), wobble_ha - float(head @ rig["f"]) + 0.006, 0.0102, 0.0105, 0.0048))
    knuckle_pad = (1 - ss(-0.002, 0.0, pad_field)) * back
    fine += hand * knuckle_pad * 0.0018
    fine -= hand * back * gauss(pad_field - 0.0002, 0.0007) * 0.0005
    fine += hand * knuckle_pad * fbm(p, 0.012, 2) * 0.00016
    knuckle_stitch = gauss(pad_field - 0.0017, 0.00032) * stitches_along(ha + ac) * back
    fine += hand * knuckle_stitch * 0.00016
    thread = np.maximum(thread, hand * knuckle_stitch)
    edges = np.maximum(edges, hand * back * gauss(pad_field + 0.001, 0.0013))
    paint(hand * knuckle_pad, "pad")

    mid_ha = rig["palm"] * 0.42
    mid_ac = float(np.mean([finger["points"][0] @ rig["s"] for finger in rig["fingers"][1:]]))
    panel_edge = rbox(wobble_ac - mid_ac, wobble_ha - mid_ha, 0.026 + (wobble_ha - mid_ha) * 0.12, 0.019, 0.012)
    panel = (1 - ss(-0.0015, 0.0, panel_edge)) * back
    ribs = np.sin(2 * np.pi * (ha - mid_ha + noise(p, 0.02) * 0.0009) / 0.0042)
    fine += palm_zone * panel * (0.0005 + ribs * 0.00026)
    fine -= palm_zone * back * gauss(panel_edge - 0.0002, 0.0006) * 0.00035

    # Creases across the back and the palm, where the hand keeps closing.
    stretched = np.stack([ha, ac * 0.22, (q @ rig["n"]) * 0.22], axis=1) + noise(p, 0.02)[:, None] * 0.002
    crease = (1 - np.abs(noise(stretched, 0.011))) ** 6
    fine -= palm_zone * (1 - panel) * crease * 0.0005

    palm_pad = rbox(ac - mid_ac, ha - rig["palm"] * 0.5, 0.03, 0.03, 0.01)
    fine += palm_zone * palm * (1 - ss(-0.001, 0.0, palm_pad)) * 0.0007
    fine -= palm_zone * palm * gauss(palm_pad - 0.0003, 0.0005) * 0.0005
    leather(palm_zone * palm)
    edge_seam = gauss(facing, 0.14)
    fine -= palm_zone * edge_seam * 0.0005

    # --- the elastic band at the wrist ---
    fine += band * np.sin(2 * np.pi * fa / 0.0031) * 0.00034
    weave = weave * (1 - band * 0.6)
    fine -= gauss(fa - BAND_END, 0.0007) * 0.0004 * (1 - sleeve)

    # --- the cuff, its strap and hem ---
    phi = np.arctan2(q @ rig["fore_side"], q @ rig["fore_back"])
    arc = phi * 0.036
    strap_edge = np.abs(fa - 0.038 + arc * 0.05 + noise(p, 0.02) * 0.0005) - 0.0105
    strap = (1 - ss(-0.0009, 0.0, strap_edge)) * cuff
    fine += strap * (0.0011 + np.sin(2 * np.pi * arc / 0.0017) * 0.0001)
    paint(strap, "strap")
    weave = weave * (1 - strap)
    grain = grain * (1 - strap) + strap * 0.5
    rough = rough * (1 - strap) + 0.92 * strap
    fine -= cuff * gauss(strap_edge - 0.0003, 0.0005) * 0.0004
    edges = np.maximum(edges, cuff * gauss(strap_edge + 0.0005, 0.0007))
    tab_edge = rbox(arc - 0.004, fa - 0.038, 0.016, 0.0125, 0.0032)
    tab = (1 - ss(-0.0009, 0.0, tab_edge)) * cuff
    fine += tab * (0.0008 + ss(-0.012, 0.02, arc) * 0.0006)
    paint(tab, "pad")
    weave = weave * (1 - tab * 0.5)
    rough = rough * (1 - tab) + 0.8 * tab
    fine -= cuff * gauss(tab_edge - 0.0002, 0.00045) * 0.0005
    tab_stitch = gauss(tab_edge + 0.0016, 0.0003) * stitches_along(arc + fa)
    fine += tab * tab_stitch * 0.00016
    thread = np.maximum(thread, tab * tab_stitch)
    edges = np.maximum(edges, cuff * gauss(tab_edge + 0.0005, 0.0008))
    hem_position = fa - (CUFF_END - 0.0032)
    fine += cuff * gauss(hem_position, 0.0026) * 0.0005
    hem_stitch = gauss(fa - (CUFF_END - 0.0072), 0.00035) * stitches_along(arc)
    fine += cuff * hem_stitch * 0.0002
    thread = np.maximum(thread, cuff * hem_stitch)
    edges = np.maximum(edges, cuff * gauss(hem_position, 0.0018))

    # --- the sleeve, bunched where it goes into the glove ---
    warped = fa + noise(p, 0.035) * 0.012 + arc * 0.25
    folds = np.abs(np.sin(2 * np.pi * warped / 0.034)) + 0.55 * np.abs(np.sin(2 * np.pi * (warped + arc * 0.5) / 0.019))
    bunching = 0.5 + ss(0.17, CUFF_END + 0.004, fa) * 1.1
    fine += sleeve * (folds * bunching * 0.0016 + noise(p, 0.05) * 0.0009)
    paint(sleeve, "sleeve")
    rough = rough * (1 - sleeve) + 0.9 * sleeve

    # Soft folds in the fabric of the hand, and use.
    fine += (1 - sleeve) * fbm(p, 0.016, 2) * 0.00018
    dust = ss(0.05, 0.9, fbm(p, 0.045, 3)) * 0.22
    wear = np.clip(edges * (0.5 + 0.5 * noise(p, 0.005)) + dust, 0, 1)
    dirt = 1.0 + fbm(p, 0.028, 3) * 0.24
    color = color * dirt[:, None]
    paint(wear * 0.6, "wear")
    paint(thread * 0.6, "thread")
    rough = rough * (1 - thread) + 0.75 * thread
    return coarse, fine, np.clip(color, 0, 1), np.stack([rough, weave, grain], axis=1)


def evaluate_both(p, nrm, rigs, palette):
    coarse, fine, color, data = np.zeros(len(p)), np.zeros(len(p)), np.zeros((len(p), 3)), np.zeros((len(p), 3))
    for side, mask in (("L", p[:, 0] < 0), ("R", p[:, 0] >= 0)):
        c, f, col, dat = evaluate(p[mask], nrm[mask], rigs[side], palette)
        coarse[mask], fine[mask], color[mask], data[mask] = c, f, col, dat
    return coarse, fine, color, data


def get_points(me):
    count = len(me.vertices)
    p = np.empty(count * 3)
    n = np.empty(count * 3)
    me.vertices.foreach_get("co", p)
    me.vertex_normals.foreach_get("vector", n)
    return p.reshape(-1, 3), n.reshape(-1, 3)


def rebuild_wrist(bm, rigs):
    """The source arm has its own strap folded over the back of the wrist, and few vertices past
    it. Replace that stretch with a clean tube running from the wrist to the forearm, and even out
    the vertices on it, which also unfolds the flap."""
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts])
    links = np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges])
    neighbours = np.zeros(len(co))
    np.add.at(neighbours, links[:, 0], 1)
    np.add.at(neighbours, links[:, 1], 1)
    for side, sign in (("L", -1.0), ("R", 1.0)):
        rig = rigs[side]
        mine = co[:, 0] * sign > 0

        def polar(points):
            q = points - rig["wrist"]
            fa = q @ rig["axis"]
            radial = q - fa[:, None] * rig["axis"]
            return fa, np.arctan2(radial @ rig["fore_side"], radial @ rig["fore_back"]), radial

        def ring(low, high):
            fa, phi, radial = polar(co[mine])
            radius = np.linalg.norm(radial, axis=1)
            inside = (fa >= low) & (fa <= high)
            edges = np.linspace(-np.pi, np.pi, 17)
            centres = (edges[:-1] + edges[1:]) * 0.5
            found, values = [], []
            for a, b, c in zip(edges[:-1], edges[1:], centres):
                pick = inside & (phi >= a) & (phi < b)
                if pick.any():
                    found.append(c)
                    values.append(float(np.median(radius[pick])))
            filled = np.interp(centres, found, values, period=2 * np.pi)
            smooth = (np.roll(filled, 1) + 2 * filled + np.roll(filled, -1)) * 0.25
            return centres, smooth

        wrist_angles, wrist_ring = ring(-0.012, -0.002)
        fore_angles, fore_ring = ring(0.04, 0.09)

        def tube(fa, phi):
            t = ss(-0.003, 0.05, fa)
            near = np.interp(phi, wrist_angles, wrist_ring, period=2 * np.pi)
            far = np.interp(phi, fore_angles, fore_ring, period=2 * np.pi)
            return near * (1 - t) + far * t

        fa_all, _, _ = polar(co)
        weight = ss(-0.01, -0.002, fa_all) * (1 - ss(0.075, 0.095, fa_all)) * mine
        moving = weight > 0
        for step in range(60):
            if step:
                total = np.zeros_like(co)
                np.add.at(total, links[:, 0], co[links[:, 1]])
                np.add.at(total, links[:, 1], co[links[:, 0]])
                co += (total / neighbours[:, None] - co) * 0.5 * weight[:, None]
            fa, phi, radial = polar(co[moving])
            target = tube(fa, phi)
            out = radial / (np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9)
            placed = rig["wrist"] + fa[:, None] * rig["axis"] + out * target[:, None]
            share = weight[moving][:, None]
            co[moving] = co[moving] * (1 - share) + placed * share
    for v, position in zip(bm.verts, co):
        v.co = position


def reshape_mesh(arm, mesh, info):
    """Strip the watch, add detail at the hands, cut the cuff's edge, and give the cloth thickness."""
    me = mesh.data
    rigs = {side: rig_for(arm, info, side) for side in "LR"}
    equipment = next(i for i, m in enumerate(me.materials) if m and m.name == "sm004_equipment")
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == equipment], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

    def along_arm(point):
        rig = rigs["L" if point.x < 0 else "R"]
        return float((np.array(point) - rig["wrist"]) @ rig["axis"])

    edges = [e for e in bm.edges if all(along_arm(v.co) < CUFF_END + 0.012 for v in e.verts)]
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, smooth=1.0, use_grid_fill=True, use_smooth_even=True)
    rebuild_wrist(bm, rigs)
    for side, sign in (("L", -1), ("R", 1)):
        rig = rigs[side]
        for cut in (CUFF_END - CUFF_STEP, CUFF_END + CUFF_STEP):
            faces = [f for f in bm.faces if all(v.co.x * sign > 0 and abs(along_arm(v.co) - cut) < 0.03 for v in f.verts)]
            geom = set(faces)
            for f in faces:
                geom.update(f.edges)
                geom.update(f.verts)
            bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-6, plane_co=rig["wrist"] + rig["axis"] * cut, plane_no=rig["axis"])
    bm.to_mesh(me)
    bm.free()
    me.validate()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    p, n = get_points(me)
    coarse = evaluate_both(p, n, rigs, PALETTES["olive"])[0]
    moved = p + n * coarse[:, None]
    me.vertices.foreach_set("co", moved.ravel())
    me.update()
    log("arms now", len(me.polygons), "faces,", sum(len(f.vertices) - 2 for f in me.polygons), "triangles")
    return rigs


def uv_density(me, uv, faces):
    uv_area, mesh_area = 0.0, 0.0
    for face in faces:
        pts = [uv[i].uv for i in face.loop_indices]
        uv_area += abs(sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y for i in range(len(pts)))) * 0.5
        mesh_area += face.area
    return uv_area / max(mesh_area, 1e-12)


def unwrap(mesh, rigs):
    """New UVs: small islands of even size, with most of the texture going to the glove."""
    me = mesh.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")

    def is_sleeve(face):
        centre = face.center
        rig = rigs["L" if centre.x < 0 else "R"]
        return float((np.array(centre) - rig["wrist"]) @ rig["axis"]) > CUFF_END

    flags = [is_sleeve(f) for f in me.polygons]
    select_only([mesh])
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    for wanted in (True, False):
        bpy.ops.object.mode_set(mode="OBJECT")
        for face, flag in zip(me.polygons, flags):
            face.select = flag == wanted
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = me.uv_layers.active.data
    glove_faces = [f for f, flag in zip(me.polygons, flags) if not flag]
    sleeve_faces = [f for f, flag in zip(me.polygons, flags) if flag]
    glove, sleeve = uv_density(me, uv, glove_faces), uv_density(me, uv, sleeve_faces)
    factor = math.sqrt(glove * SLEEVE_DENSITY / sleeve)
    for face in sleeve_faces:
        for i in face.loop_indices:
            uv[i].uv = uv[i].uv * factor
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="SCALED", margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    density = uv_density(me, me.uv_layers.active.data, list(f for f, flag in zip(me.polygons, flags) if not flag))
    metres_per_texel = math.sqrt(1.0 / density) / SIZE
    log("uv: one texel is", round(metres_per_texel * 1000, 3), "mm on the glove")
    return metres_per_texel


def make_target(name):
    image = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    return image


def bake_all(mesh, rigs, palette):
    scene = bpy.context.scene
    high = mesh.copy()
    high.data = mesh.data.copy()
    high.name = "glove_high"
    scene.collection.objects.link(high)
    high.parent = None
    high.matrix_world = mesh.matrix_world.copy()
    high.modifiers.clear()
    high.vertex_groups.clear()
    select_only([high])
    subsurf = high.modifiers.new("detail", "SUBSURF")
    subsurf.levels = subsurf.render_levels = HIGH_LEVELS
    subsurf.quality = 3
    bpy.ops.object.modifier_apply(modifier=subsurf.name)
    log("detail mesh", len(high.data.polygons), "faces")
    p, n = get_points(high.data)
    _, fine, color, data = evaluate_both(p, n, rigs, palette)
    high.data.vertices.foreach_set("co", (p + n * fine[:, None]).ravel())
    high.data.update()

    def attribute(name, values):
        layer = high.data.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        rgba = np.concatenate([values, np.ones((len(values), 1))], axis=1)
        layer.data.foreach_set("color", rgba.astype(np.float32).ravel())

    attribute("glove_color", color)
    attribute("glove_data", data)

    def emit(name):
        material = bpy.data.materials.new(f"emit_{name}")
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        emission = nodes.new("ShaderNodeEmission")
        source = nodes.new("ShaderNodeVertexColor")
        source.layer_name = name
        material.node_tree.links.new(source.outputs["Color"], emission.inputs["Color"])
        material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
        return material

    target_material = bpy.data.materials.new("bake_target")
    target_material.use_nodes = True
    image_node = target_material.node_tree.nodes.new("ShaderNodeTexImage")
    target_material.node_tree.nodes.active = image_node
    mesh.data.materials.clear()
    mesh.data.materials.append(target_material)
    for face in mesh.data.polygons:
        face.material_index = 0
    armature = [m for m in mesh.modifiers if m.type == "ARMATURE"]
    for m in armature:
        m.show_render = m.show_viewport = False

    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.bake_type = "COMBINED"

    def bake(kind, name, samples, material=None):
        log("baking", name)
        image = make_target(name)
        image_node.image = image
        high.data.materials.clear()
        if material is not None:
            high.data.materials.append(material)
        else:
            plain = bpy.data.materials.new("plain")
            plain.use_nodes = True
            high.data.materials.append(plain)
        scene.cycles.samples = samples
        select_only([high, mesh], active=mesh)
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.0035, max_ray_distance=0.009, margin=14, margin_type="EXTEND", normal_space="TANGENT", use_clear=True, target="IMAGE_TEXTURES")
        result = image_to_np(image)
        bpy.data.images.remove(image)
        return result[..., :3]

    bakes = {
        "normal": bake("NORMAL", "bake_normal", 4),
        "color": bake("EMIT", "bake_color", 4, emit("glove_color")),
        "data": bake("EMIT", "bake_data", 4, emit("glove_data")),
        "ao": bake("AO", "bake_ao", 32),
    }
    for m in armature:
        m.show_render = m.show_viewport = True
    scene.render.engine = previous_engine
    bpy.data.objects.remove(high)
    mesh.data.materials.clear()
    return bakes


def tile_noise(rng, size, cells):
    """Tiling noise from random cells, resized by repeating each cell and blurring by wrap-around."""
    field = rng.random((cells, cells))
    repeat = size // cells + 1
    big = np.repeat(np.repeat(field, repeat, axis=0), repeat, axis=1)[:size, :size]
    for axis in (0, 1):
        big = (big + np.roll(big, repeat // 2, axis=axis) + np.roll(big, -repeat // 2, axis=axis)) / 3.0
    return (big - big.mean()) / (big.std() + 1e-6)


def finish(bakes, metres_per_texel):
    """Add the weave and leather grain that are finer than the detail mesh, and shade the creases."""
    normal, color, data, ao = bakes["normal"], bakes["color"], bakes["data"], bakes["ao"]
    rough_map, weave_mask, grain_mask = data[..., 0], data[..., 1], data[..., 2]
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    period = max(WEAVE_PERIOD / metres_per_texel, 3.2)
    log("weave period", round(period, 2), "texels")
    weave = np.sin(2 * np.pi * x / period) * np.sin(2 * np.pi * y / period) * 0.5 + np.sin(4 * np.pi * x / period) * 0.15
    rng = np.random.default_rng(11)
    grain = tile_noise(rng, SIZE, SIZE // 5) * 0.65 + tile_noise(rng, SIZE, SIZE // 12) * 0.35
    height = weave * weave_mask * 0.42 + grain * grain_mask * 0.3
    dy, dx = np.gradient(height)
    xyz = normal * 2.0 - 1.0
    # The relief has to read from arm's length under dim lamps, so it is stronger than life.
    xyz[..., :2] *= 1.6
    xyz[..., 0] -= dx * 0.55
    xyz[..., 1] += dy * 0.55
    xyz /= np.linalg.norm(xyz, axis=2, keepdims=True) + 1e-8
    occlusion = 0.34 + 0.66 * np.clip(ao[..., :1], 0, 1) ** 1.25
    tone = 1.0 + (weave * weave_mask * 0.09 + grain * grain_mask * 0.07)[..., None]
    final_color = np.clip(color * occlusion * tone, 0, 1)
    final_rough = np.clip(rough_map, 0.35, 1.0)
    return final_color, xyz * 0.5 + 0.5, final_rough


def apply_materials(mesh, color, normal, rough):
    def rgba(a):
        return np.concatenate([a, np.ones(a.shape[:2] + (1,), a.dtype)], axis=2)

    images = {
        "color": np_to_image("arms_color", rgba(color), True),
        "normal": np_to_image("arms_normal", rgba(normal), False),
        "rough": np_to_image("arms_rough", resample(rgba(np.stack([rough] * 3, axis=2)), ROUGH_SIZE, ROUGH_SIZE), False),
    }
    material = bpy.data.materials.new("arms")
    material.use_nodes = True
    tree = material.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = images["color"]
    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    normal_tex = tree.nodes.new("ShaderNodeTexImage")
    normal_tex.image = images["normal"]
    normal_map = tree.nodes.new("ShaderNodeNormalMap")
    tree.links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
    tree.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    rough_tex = tree.nodes.new("ShaderNodeTexImage")
    rough_tex.image = images["rough"]
    tree.links.new(rough_tex.outputs["Color"], bsdf.inputs["Roughness"])
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    for face in mesh.data.polygons:
        face.material_index = 0


def build_gloves(arm, mesh, info, palette="olive", rebake=False):
    os.makedirs(CACHE, exist_ok=True)
    rigs = reshape_mesh(arm, mesh, info)
    uv_path = os.path.join(CACHE, f"uv_{palette}.npy")
    bake_path = os.path.join(CACHE, f"bake_{palette}.npz")
    fresh = rebake or not (os.path.exists(uv_path) and os.path.exists(bake_path))
    if fresh:
        metres_per_texel = unwrap(mesh, rigs)
        uv = np.empty(len(mesh.data.loops) * 2)
        mesh.data.uv_layers.active.data.foreach_get("uv", uv)
        np.save(uv_path, uv)
        bakes = bake_all(mesh, rigs, PALETTES[palette])
        np.savez_compressed(bake_path, metres_per_texel=metres_per_texel, **{k: (np.clip(v, 0, 1) * 65535).astype(np.uint16) for k, v in bakes.items()})
    else:
        while mesh.data.uv_layers:
            mesh.data.uv_layers.remove(mesh.data.uv_layers[0])
        mesh.data.uv_layers.new(name="UVMap")
        uv = np.load(uv_path)
        if len(uv) != len(mesh.data.loops) * 2:
            raise RuntimeError("glove cache does not match this mesh: build once with --rebake")
        mesh.data.uv_layers.active.data.foreach_set("uv", uv)
        stored = np.load(bake_path)
        metres_per_texel = float(stored["metres_per_texel"])
        bakes = {k: stored[k].astype(np.float64) / 65535.0 for k in ("normal", "color", "data", "ao")}
    apply_materials(mesh, *finish(bakes, metres_per_texel))
