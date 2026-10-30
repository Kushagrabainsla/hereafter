"""Build Hereafter's first-person view models (arms plus weapon) as GLB files.

Run inside Blender 4.4 or newer, from the repository root:

  blender -b --python scripts/viewmodels/build.py -- --weapon pistol --out public/models/pistol.glb
  blender -b --python scripts/viewmodels/build.py -- --weapon pistol --preview /tmp/preview

Sources are read from assets-src/viewmodels (see scripts/viewmodels/fetch.sh).
The output is authored in camera-local metres: the camera sits at the origin,
+Y forward and +Z up in Blender, which the glTF exporter turns into the
-Z forward, +Y up frame that src/game/authoredViewModel.ts attaches to the
first-person camera. Clips are named idle, walk, run and fire (slash and stab for
the knife); attack clips start on the neutral pose so the game can play them
additively. The knife's strokes are authored ATTACK_SLOW times slower than real
time so their fast arcs get more keyframes; the game plays them that much faster.
"""

import argparse
import math
import os
import re
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "assets-src", "viewmodels")
FPS = 24
ATTACK_SLOW = 2.5
# Catmull-Clark levels applied to the arms: the source avatar's hands are low-poly.
SUBDIVISIONS = 1
# Side of the packed arm texture: each arm gets half its width at the atlas's own detail.
ARM_TEXTURE = 1200
ARM_BONE_KEYS = (" UpperArm", " Forearm", " Hand", " Finger")
KEEP_BONES = {"Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 Neck", "Bip01 L Clavicle", "Bip01 R Clavicle"}
FINGERS = {"thumb": 0, "index": 1, "middle": 2, "ring": 3, "pinky": 4}

# Sleeve insignia in the 2048 px body atlas (x, y from top, width, height, source dx):
# the rectangle is replaced by the fabric dx pixels to its side.
ERASE_PATCHES = [(275, 1020, 158, 190, -158), (1590, 1053, 152, 158, 152)]

RAD = math.radians


def hand(palm, normal, fingers, curl, thumb, pole, spread=0.0, depth=0.012, fraction=0.55, space="weapon", chain=2):
    return {"palm": palm, "normal": normal, "fingers": fingers, "curl": curl, "thumb": thumb, "pole": pole, "spread": spread, "depth": depth, "fraction": fraction, "space": space, "chain": chain}


GUN_CURL = {"index": (18, 30, 22), "middle": (58, 72, 48), "ring": (64, 78, 52), "pinky": (70, 82, 56)}
FIST_CURL = {"index": (62, 80, 55), "middle": (66, 84, 58), "ring": (68, 86, 60), "pinky": (72, 88, 62)}

WEAPONS = {
    "pistol": {
        "source": ("gltf", os.path.join(SRC, "polyhaven", "service_pistol", "service_pistol_1k.gltf")),
        "parts": r"service_pistol_(pistol_a|slide_a|hammer_a|trigger_a|magazine_empty)$",
        "moves": {"service_pistol_magazine_empty": (0.080, 0.0, -0.149)},
        "canonical": Euler((0, 0, RAD(90))),
        "grip_origin": (0.0, -0.022, -0.012),
        "muzzle": (0.0, 0.196, 0.042),
        "flash_scale": 1.0,
        "pose": {"location": (0.13, 0.33, -0.17), "rotation": (0.1, -0.1, 0.22)},
        "run": {"location": (0.02, -0.02, -0.05), "rotation": (-0.35, -0.25, 0.35)},
        "fire": {"frames": 9, "kick": (0.0, -0.035, 0.012), "pitch": 0.13, "roll": -0.02},
        "torso_yaw": 0.0,
        "hands": {
            "R": hand((0.017, -0.012, -0.011), (-1, 0, 0), (0, 0.92, 0.40), GUN_CURL, ((10, 0, 85), (30, 0, 0), (20, 0, 0)), (0.42, 0.08, -0.52)),
            "L": hand((-0.036, 0.0, -0.018), (1, 0, 0), (0, 0.90, 0.44), {"index": (52, 70, 45), "middle": (58, 74, 48), "ring": (62, 78, 50), "pinky": (66, 82, 54)}, ((8, 0, -80), (28, 0, 0), (18, 0, 0)), (-0.40, 0.10, -0.52)),
        },
    },
    "rifle": {
        "source": ("blend", os.path.join(SRC, "opengameart", "akm54.blend"), "AKM"),
        "canonical": Euler((0, 0, 0)),
        "grip_origin": (0.0, -0.21, -0.085),
        "muzzle": (0.0, 0.70, 0.08),
        "flash_scale": 1.3,
        "pose": {"location": (0.13, 0.10, -0.24), "rotation": (0.0, -0.12, 0.26)},
        "run": {"location": (0.0, -0.03, -0.06), "rotation": (-0.35, -0.2, 0.4)},
        "fire": {"frames": 8, "kick": (0.0, -0.028, 0.008), "pitch": 0.07, "roll": -0.015},
        "torso_yaw": -0.45,
        "shoulder_shift": (0.0, 0.08, 0.0),
        "arm_scale": 1.1,
        "hands": {
            "R": hand((0.016, -0.004, 0.015), (-1, 0, 0), (0, 0.92, 0.40), GUN_CURL, ((10, 0, 85), (30, 0, 0), (20, 0, 0)), (0.36, 0.0, -0.5)),
            "L": hand((0.0, 0.40, 0.058), (0, 0, 1), (1.0, 0.0, 0.0), {"index": (40, 60, 40), "middle": (48, 66, 44), "ring": (52, 70, 46), "pinky": (56, 74, 50)}, ((25, 0, -40), (45, 0, 0), (30, 0, 0)), (-0.45, 0.15, -0.5)),
        },
    },
    "knife": {
        "source": ("gltf", os.path.join(SRC, "polyhaven", "fish_knife", "fish_knife_1k.gltf")),
        "parts": r"fish_knife_(blade|handle)$",
        "canonical": Euler((RAD(-90), 0, 0)),
        "edge_down": True,
        "grip_origin": (0.0, -0.05, 0.0),
        "muzzle": None,
        "pose": {"location": (0.17, 0.26, -0.16), "rotation": (0.55, 0.3, 0.35)},
        "run": {"location": (0.03, -0.04, -0.06), "rotation": (-0.7, -0.2, 0.3)},
        # Keys in real seconds: (time, location delta, rotation delta) of the weapon root,
        # joined by a Catmull-Rom curve. The slash cocks the blade up and right, sweeps it
        # down and across through the middle of the view at 0.13 s and follows through to
        # the lower left; the stab draws back, drives the point out at 0.24 s, twists and
        # pulls free. The game lands each stroke at those moments (KNIFE in combatRules.ts).
        "attacks": {
            "slash": [(0.0, (0, 0, 0), (0, 0, 0)), (0.07, (0.06, -0.03, 0.08), (0.35, 0.5, -0.5)), (0.13, (-0.13, 0.08, 0.05), (-0.4, 1.1, 0.5)),
                      (0.2, (-0.32, 0.02, -0.03), (-0.65, 1.25, 0.95)), (0.3, (-0.24, -0.03, -0.08), (-0.45, 0.8, 0.6)), (0.52, (0, 0, 0), (0, 0, 0))],
            "stab": [(0.0, (0, 0, 0), (0, 0, 0)), (0.16, (0.02, -0.03, 0.01), (-0.2, 0.0, -0.05)), (0.24, (-0.08, 0.15, 0.05), (-0.38, 0.05, -0.22)),
                     (0.33, (-0.08, 0.14, 0.045), (-0.38, 0.6, -0.22)), (0.5, (-0.02, 0.05, 0.0), (-0.15, 0.2, -0.08)), (0.9, (0, 0, 0), (0, 0, 0))],
        },
        "torso_yaw": 0.0,
        "hands": {
            # the shoulder joins in so a stroke can reach across and out
            "R": hand((0.012, 0.0, 0.0), (-1, 0, 0), (0, 0.0, -1.0), FIST_CURL, ((10, 0, 60), (25, 0, 0), (25, 0, 0)), (0.42, 0.08, -0.5), chain=3),
            # the off hand rests low and out of view, clear of the strokes
            "L": hand((-0.24, 0.17, -0.36), (0.7, 0.4, -0.3), (0.2, 0.8, 0.5), FIST_CURL, ((15, 0, 55), (35, 0, 0), (35, 0, 0)), (-0.40, 0.05, -0.5), space="camera"),
        },
    },
}


# ---------------------------------------------------------------------------
# helpers

def log(*args):
    print("[viewmodel]", *args, flush=True)


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


def load_tga(path):
    img = bpy.data.images.load(path)
    a = image_to_np(img)
    bpy.data.images.remove(img)
    return a


def erase_patches(a):
    H = a.shape[0]
    for x, y, w, h, dx in ERASE_PATCHES:
        r0, r1 = H - (y + h), H - y
        a[r0:r1, x:x + w] = a[r0:r1, x + dx:x + dx + w]
    return a


def frame_from_axes(y_axis, z_axis):
    z = Vector(z_axis).normalized()
    y = Vector(y_axis)
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    m = Matrix.Identity(4)
    m.col[0][:3], m.col[1][:3], m.col[2][:3] = x, y, z
    return m


def set_keys(obj, frame, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_euler = rotation
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def assign_action(obj, act):
    ad = obj.animation_data or obj.animation_data_create()
    ad.action = act
    if hasattr(act, "slots"):
        slot = act.slots[0] if len(act.slots) else act.slots.new("OBJECT", obj.name)
        ad.action_slot = slot


def push_to_nla(obj, name):
    ad = obj.animation_data
    act = ad.action
    if act is None:
        return
    ad.action = None
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    if hasattr(strip, "action_slot") and hasattr(act, "slots") and len(act.slots):
        strip.action_slot = act.slots[0]
    strip.name = name


def solo_track(objs, name):
    for o in objs:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != name


def ease_out(t):
    return 1 - (1 - t) ** 3


# ---------------------------------------------------------------------------
# arms

def load_arms():
    fbx = os.path.join(SRC, "rocketbox", "Military_Male_03.fbx")
    bpy.ops.import_scene.fbx(filepath=fbx, use_anim=False)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.animation_data_clear()
    arm.name = "Arms"
    mesh.name = "arms"

    # bake object transforms so bones and vertices share one metric frame
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.data.transform(mw)
    mesh.matrix_world = Matrix.Identity(4)
    aw = arm.matrix_world.copy()
    arm.data.transform(aw)
    arm.matrix_world = Matrix.Identity(4)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)

    # face +Y with the eyes at the origin
    eye = (arm.data.bones["Bip01 LEye"].head_local + arm.data.bones["Bip01 REye"].head_local) / 2
    fix = Matrix.Translation(-(Matrix.Rotation(math.pi, 4, "Z") @ eye)) @ Matrix.Rotation(math.pi, 4, "Z")
    mesh.data.transform(fix)
    arm.data.transform(fix)
    return arm, mesh


def cut_arms(arm, mesh):
    me = mesh.data
    arm_groups = {vg.index for vg in mesh.vertex_groups if any(k in vg.name for k in ARM_BONE_KEYS)}
    weight = np.zeros(len(me.vertices))
    for v in me.vertices:
        weight[v.index] = sum(g.weight for g in v.groups if g.group in arm_groups)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    doomed = [f for f in bm.faces if min(weight[v.index] for v in f.verts) < 0.5]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.validate()
    me.update()
    # vertex groups of removed bones
    for vg in list(mesh.vertex_groups):
        if not (vg.name in KEEP_BONES or any(k in vg.name for k in ARM_BONE_KEYS)):
            mesh.vertex_groups.remove(vg)
    select_only([mesh])
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def subdivide(mesh):
    """Smooth the low-poly arms with Catmull-Clark subdivision, interpolating the skin weights."""
    if SUBDIVISIONS <= 0:
        return
    select_only([mesh])
    mod = mesh.modifiers.new("Subdivision", "SUBSURF")
    mod.levels = mod.render_levels = SUBDIVISIONS
    mod.uv_smooth = "PRESERVE_BOUNDARIES"
    mod.quality = 3
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in mesh.data.polygons:
        p.use_smooth = True
    log("arms subdivided to", len(mesh.data.polygons), "faces")


def left_weights(mesh):
    left_groups = {vg.index for vg in mesh.vertex_groups if " L " in vg.name}
    left = np.zeros(len(mesh.data.vertices))
    for v in mesh.data.vertices:
        left[v.index] = sum(g.weight for g in v.groups if g.group in left_groups)
    return left


def hand_info(arm, mesh, side):
    bones = arm.data.bones
    wrist = bones[f"Bip01 {side} Hand"].head_local.copy()
    knuckles = sum((bones[f"Bip01 {side} Finger{i}"].head_local for i in range(1, 5)), Vector()) / 4
    f = (knuckles - wrist).normalized()
    group = mesh.vertex_groups[f"Bip01 {side} Hand"].index
    pts = np.array([v.co[:] for v in mesh.data.vertices if any(g.group == group and g.weight > 0.5 for g in v.groups)])
    centred = pts - pts.mean(0)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    n = Vector(vt[2])
    if n.dot(Vector((-math.copysign(1, wrist.x), 0, 0))) < 0:
        n = -n
    n = (n - f * n.dot(f)).normalized()
    return {"wrist": wrist, "knuckles": knuckles, "f": f, "n": n, "d_palm": (knuckles - wrist).length}


def rebuild_bones(arm, info):
    select_only([arm])
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        if not (b.name in KEEP_BONES or any(k in b.name for k in ARM_BONE_KEYS)):
            eb.remove(b)
    for side in "LR":
        n = info[side]["n"]
        chain = [f"Bip01 {side} UpperArm", f"Bip01 {side} Forearm", f"Bip01 {side} Hand"]
        for parent, child in zip(chain, chain[1:]):
            eb[parent].tail = eb[child].head
        eb[f"Bip01 {side} Hand"].tail = info[side]["knuckles"]
        for name in chain:
            eb[name].align_roll(n if name.endswith("Hand") else Vector((0, 0, -1)))
        for finger in range(5):
            names = [f"Bip01 {side} Finger{finger}", f"Bip01 {side} Finger{finger}1", f"Bip01 {side} Finger{finger}2"]
            for parent, child in zip(names, names[1:]):
                eb[parent].tail = eb[child].head
            last, mid = eb[names[2]], eb[names[1]]
            last.tail = last.head + (last.head - mid.head) * 0.85
            for name in names:
                eb[name].align_roll(n)
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"


def build_arm_textures(mesh):
    """Pack both arms' atlas islands into one 1024 px texture and the watch into its own."""
    me = mesh.data
    left = left_weights(mesh)
    uv = me.uv_layers.active.data
    body_index = next(i for i, m in enumerate(me.materials) if m and m.name == "sm004_body")
    equip_index = next(i for i, m in enumerate(me.materials) if m and m.name == "sm004_equipment")
    boxes = {"L": [[1, 1], [0, 0]], "R": [[1, 1], [0, 0]]}
    watch = [[1, 1], [0, 0]]
    for p in me.polygons:
        if p.material_index == body_index:
            side = "L" if np.mean([left[i] for i in p.vertices]) > 0.5 else "R"
            box = boxes[side]
        elif p.material_index == equip_index:
            box = watch
        else:
            continue
        for li in p.loop_indices:
            u, v = uv[li].uv
            box[0][0], box[0][1] = min(box[0][0], u), min(box[0][1], v)
            box[1][0], box[1][1] = max(box[1][0], u), max(box[1][1], v)
    log("uv boxes", {k: [[round(x, 3) for x in b] for b in v] for k, v in boxes.items()}, "watch", watch)
    rb = os.path.join(SRC, "rocketbox")
    color = erase_patches(load_tga(os.path.join(rb, "sm004_body_color_acu.tga")))
    normal = erase_patches(load_tga(os.path.join(rb, "sm004_body_normal.tga")))
    spec = erase_patches(load_tga(os.path.join(rb, "sm004_body_specular.tga")))
    H, W = color.shape[:2]
    margin = 3.0 / W
    v0 = max(0.0, min(boxes["L"][0][1], boxes["R"][0][1]) - margin)
    v1 = min(1.0, max(boxes["L"][1][1], boxes["R"][1][1]) + margin)
    cols = {}
    for side in ("R", "L"):
        u0 = max(0.0, boxes[side][0][0] - margin)
        u1 = min(1.0, boxes[side][1][0] + margin)
        cols[side] = (u0, u1)
    size = ARM_TEXTURE
    log("arm crops in source pixels", {side: (round((cols[side][1] - cols[side][0]) * W), round((v1 - v0) * H)) for side in cols})
    packed = {}
    for name, src in (("color", color), ("normal", normal), ("spec", spec)):
        out = np.zeros((size, size, 4), np.float32)
        for k, side in enumerate(("R", "L")):
            u0, u1 = cols[side]
            crop = src[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)]
            out[:, k * size // 2:(k + 1) * size // 2] = resample(crop, size // 2, size)
        packed[name] = out
    rough = packed["spec"].copy()
    rough[..., :3] = np.clip(0.92 - 0.55 * packed["spec"][..., :1], 0.35, 0.95)
    rough[..., 3] = 1
    images = {
        "color": np_to_image("arms_color", packed["color"], True),
        "normal": np_to_image("arms_normal", packed["normal"], False),
        "rough": np_to_image("arms_rough", resample(rough, size // 2, size // 2), False),
    }
    # watch crop from the equipment atlas at source resolution
    eq_color = load_tga(os.path.join(rb, "sm004_equipment_color_acu.tga"))
    eq_normal = load_tga(os.path.join(rb, "sm004_equipment_normal.tga"))
    eh, ew = eq_color.shape[:2]
    wm = 2.0 / ew
    wu0, wv0 = max(0.0, watch[0][0] - wm), max(0.0, watch[0][1] - wm)
    wu1, wv1 = min(1.0, watch[1][0] + wm), min(1.0, watch[1][1] + wm)
    wsl = (slice(int(wv0 * eh), int(wv1 * eh)), slice(int(wu0 * ew), int(wu1 * ew)))
    wimages = {
        "color": np_to_image("watch_color", np.ascontiguousarray(eq_color[wsl]), True),
        "normal": np_to_image("watch_normal", np.ascontiguousarray(eq_normal[wsl]), False),
    }
    # remap UVs
    for p in me.polygons:
        if p.material_index == body_index:
            side = "L" if np.mean([left[i] for i in p.vertices]) > 0.5 else "R"
            u0, u1 = cols[side]
            base = 0.0 if side == "R" else 0.5
            for li in p.loop_indices:
                u, v = uv[li].uv
                uv[li].uv = (base + (u - u0) / (u1 - u0) * 0.5, (v - v0) / (v1 - v0))
        elif p.material_index == equip_index:
            for li in p.loop_indices:
                u, v = uv[li].uv
                uv[li].uv = ((u - wu0) / (wu1 - wu0), (v - wv0) / (wv1 - wv0))
    # materials
    def make_material(name, imgs, roughness=0.5):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = roughness
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = imgs["color"]
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = imgs["normal"]
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        if "rough" in imgs:
            rtex = nt.nodes.new("ShaderNodeTexImage")
            rtex.image = imgs["rough"]
            nt.links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])
        return mat
    arms_mat = make_material("arms", images)
    watch_mat = make_material("watch", wimages, 0.45)
    new_index = {}
    for p in me.polygons:
        new_index[p.index] = 0 if p.material_index == body_index else 1
    me.materials.clear()
    me.materials.append(arms_mat)
    me.materials.append(watch_mat)
    for p in me.polygons:
        p.material_index = new_index[p.index]
    for m in list(bpy.data.materials):
        if m.name.startswith("sm004"):
            bpy.data.materials.remove(m)
    for img in list(bpy.data.images):
        if img.name.startswith(("Map #", "Bitmaptexture")):
            bpy.data.images.remove(img)


# ---------------------------------------------------------------------------
# weapons

def load_weapon(cfg):
    kind, path = cfg["source"][0], cfg["source"][1]
    before = set(bpy.data.objects)
    if kind == "gltf":
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        keep = [o for o in new if re.match(cfg["parts"], o.name)]
        for o in new:
            if o not in keep:
                bpy.data.objects.remove(o)
        for name, offset in cfg.get("moves", {}).items():
            o = bpy.data.objects[name]
            o.location = o.location + Vector(offset)
        bpy.context.view_layer.update()
    else:
        name = cfg["source"][2]
        bpy.ops.wm.append(filepath=os.path.join(path, "Object", name), directory=os.path.join(path, "Object") + os.sep, filename=name)
        keep = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for o in keep:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    select_only(keep)
    if len(keep) > 1:
        bpy.ops.object.join()
    weapon = bpy.context.view_layer.objects.active
    weapon.name = "weapon"
    me = weapon.data
    me.transform(cfg["canonical"].to_matrix().to_4x4())
    if cfg.get("edge_down"):
        # the straight spine keeps a constant x along the blade; the edge tapers
        co = np.array([v.co[:] for v in me.vertices])
        blade = co[co[:, 1] > 0.02]
        order = np.argsort(blade[:, 1])
        slices = np.array_split(blade[order], 8)
        xmin = np.array([s[:, 0].min() for s in slices if len(s)])
        xmax = np.array([s[:, 0].max() for s in slices if len(s)])
        edge_positive = xmax.std() > xmin.std()
        log("knife edge on", "+x" if edge_positive else "-x")
        me.transform(Matrix.Rotation(RAD(90 if edge_positive else -90), 4, "Y"))
    me.transform(Matrix.Translation(-Vector(cfg["grip_origin"])))
    me.validate()
    me.update()
    for mat in me.materials:
        nt = mat.node_tree
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and max(node.image.size) > 1024:
                node.image.scale(1024, 1024)
                node.image.pack()
        # drop occlusion groups and extra nodes the exporter would turn into textures
        for node in list(nt.nodes):
            if node.type == "GROUP":
                nt.nodes.remove(node)
    co = np.array([v.co[:] for v in me.vertices])
    log("weapon bbox", co.min(0).round(3).tolist(), co.max(0).round(3).tolist())
    return weapon


def make_flash(cfg, parent):
    if not cfg.get("muzzle"):
        return None
    s = 0.03 * cfg.get("flash_scale", 1.0)
    bm = bmesh.new()
    for angle in (0, 60, 120):
        rot = Matrix.Rotation(RAD(angle), 4, "Y")
        quad = [rot @ Vector(p) for p in ((-s, 0, -0.2 * s), (s, 0, -0.2 * s), (s * 0.7, 3.2 * s, 0), (-s * 0.7, 3.2 * s, 0))]
        verts = [bm.verts.new(v) for v in quad]
        bm.faces.new(verts)
    me = bpy.data.meshes.new("muzzle")
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new("muzzle_flash")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.72, 0.32, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 6.0
    bsdf.inputs["Roughness"].default_value = 1.0
    mat.use_backface_culling = False
    me.materials.append(mat)
    flash = bpy.data.objects.new("muzzle", me)
    bpy.context.scene.collection.objects.link(flash)
    flash.parent = parent
    flash.location = Vector(cfg["muzzle"])
    flash.scale = (0.001, 0.001, 0.001)
    return flash


# ---------------------------------------------------------------------------
# posing

def add_empty(name, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.03
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.matrix_parent_inverse = Matrix.Identity(4)
    return e


def place_hands(arm, info, cfg, root, body):
    targets = {}
    for side in "LR":
        hc = cfg["hands"][side]
        frame = frame_from_axes(hc["fingers"], hc["normal"])
        palm = Vector(hc["palm"])
        wrist = palm - Vector(frame.col[1][:3]) * (info[side]["d_palm"] * hc["fraction"]) - Vector(frame.col[2][:3]) * hc["depth"]
        frame.translation = wrist
        parent = root if hc["space"] == "weapon" else body
        target = add_empty(f"target_{side}", parent)
        target.matrix_basis = frame
        pole = add_empty(f"pole_{side}", body)
        pole.location = Vector(hc["pole"])
        fore = arm.pose.bones[f"Bip01 {side} Forearm"]
        ik = fore.constraints.new("IK")
        ik.target, ik.pole_target = target, pole
        ik.chain_count = hc["chain"]
        ik.iterations = 500
        ik.use_tail = True
        hb = arm.pose.bones[f"Bip01 {side} Hand"]
        cr = hb.constraints.new("COPY_ROTATION")
        cr.target = target
        cr.target_space = cr.owner_space = "WORLD"
        cr.mix_mode = "REPLACE"
        # finger curl in each bone's own frame (X = flexion axis, Z = palm normal)
        for finger, idx in FINGERS.items():
            names = [f"Bip01 {side} Finger{idx}", f"Bip01 {side} Finger{idx}1", f"Bip01 {side} Finger{idx}2"]
            if finger == "thumb":
                for name, rot in zip(names, hc["thumb"]):
                    pb = arm.pose.bones[name]
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler = Euler((RAD(rot[0]), RAD(rot[1]), RAD(rot[2] * (1 if side == "R" else -1))))
            else:
                spread = hc["spread"] * {"index": 1.0, "middle": 0.3, "ring": -0.3, "pinky": -1.0}[finger]
                for k, (name, angle) in enumerate(zip(names, hc["curl"][finger])):
                    pb = arm.pose.bones[name]
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler = Euler((RAD(angle), 0, RAD(spread if k == 0 else 0) * (1 if side == "R" else -1)))
        targets[side] = (target, pole, ik)
    bpy.context.view_layer.update()
    # pick the pole angle that brings the elbow nearest the pole target
    for side, (target, pole, ik) in targets.items():
        fore = arm.pose.bones[f"Bip01 {side} Forearm"]
        best = (1e9, 0.0)
        for step in (np.linspace(-math.pi, math.pi, 36, endpoint=False), None):
            if step is None:
                step = np.linspace(best[1] - 0.18, best[1] + 0.18, 19)
            for angle in step:
                ik.pole_angle = float(angle)
                bpy.context.view_layer.update()
                elbow = arm.matrix_world @ fore.head
                d = (elbow - pole.matrix_world.translation).length
                if d < best[0]:
                    best = (d, float(angle))
        ik.pole_angle = best[1]
        log(f"{side} pole angle {math.degrees(best[1]):.0f} deg, elbow-pole distance {best[0]:.3f}")
    bpy.context.view_layer.update()
    for side in "LR":
        fore = arm.pose.bones[f"Bip01 {side} Forearm"]
        hb = arm.pose.bones[f"Bip01 {side} Hand"]
        wrist = arm.matrix_world @ hb.head
        want = targets[side][0].matrix_world.translation
        bone_world = (arm.matrix_world @ hb.matrix).to_3x3()
        target_world = targets[side][0].matrix_world.to_3x3()
        dots = [round(bone_world.col[i].normalized().dot(target_world.col[i].normalized()), 2) for i in range(3)]
        log(f"{side} wrist reach error {(wrist - want).length * 100:.1f} cm, axis agreement xyz {dots}")


# ---------------------------------------------------------------------------
# animation

def author_clips(cfg, root, body, flash):
    pose = cfg["pose"]
    base_loc, base_rot = Vector(pose["location"]), Vector(pose["rotation"])
    run = cfg["run"]
    clips = {}

    def loop(name, seconds, fn):
        n = int(round(seconds * FPS))
        act = bpy.data.actions.new(f"{name}.root")
        assign_action(root, act)
        bact = bpy.data.actions.new(f"{name}.body")
        assign_action(body, bact)
        for f in range(n + 1):
            t = f / n
            dloc, drot, bloc = fn(t)
            set_keys(root, f, base_loc + Vector(dloc), Euler(base_rot + Vector(drot)))
            set_keys(body, f, Vector(bloc))
        clips[name] = (0, n)

    def idle(t):
        w = 2 * math.pi * t
        return (0.0025 * math.sin(w + 1.2), 0.0, 0.004 * math.sin(w)), (0.006 * math.sin(w), 0.004 * math.sin(w + 0.8), 0.0), (0, 0, 0.002 * math.sin(w))

    def walk(t):
        w = 2 * math.pi * t
        return (0.011 * math.sin(w), 0.004 * math.sin(2 * w + 0.5), 0.007 * math.sin(2 * w) - 0.003), (0.012 * math.sin(2 * w), 0.0, 0.02 * math.sin(w)), (0.004 * math.sin(w), 0, 0.004 * math.sin(2 * w))

    def runf(t):
        w = 2 * math.pi * t
        carry = Vector(run["location"]) + Vector((0.016 * math.sin(w), 0.006 * math.sin(2 * w), 0.016 * math.sin(2 * w)))
        rot = Vector(run["rotation"]) + Vector((0.035 * math.sin(2 * w), 0.03 * math.sin(w), 0.04 * math.sin(w)))
        return tuple(carry), tuple(rot), (0.008 * math.sin(w), 0.0, 0.01 * math.sin(2 * w))

    loop("idle", 3.0, idle)
    loop("walk", 0.9, walk)
    loop("run", 0.58, runf)

    for name, keys in cfg.get("attacks", {}).items():
        n = int(round(keys[-1][0] * ATTACK_SLOW * FPS))
        act = bpy.data.actions.new(f"{name}.root")
        assign_action(root, act)
        bact = bpy.data.actions.new(f"{name}.body")
        assign_action(body, bact)
        for f in range(n + 1):
            dloc, drot = stroke_at(keys, f / (ATTACK_SLOW * FPS))
            set_keys(root, f, base_loc + Vector(dloc), Euler(base_rot + Vector(drot)))
            # the shoulders lean into the stroke a little
            set_keys(body, f, Vector(dloc) * 0.25)
        clips[name] = (0, n)
    if "fire" not in cfg:
        return clips

    fire = cfg["fire"]
    n = fire["frames"]
    act = bpy.data.actions.new("fire.root")
    assign_action(root, act)
    bact = bpy.data.actions.new("fire.body")
    assign_action(body, bact)
    if flash is not None:
        fact = bpy.data.actions.new("fire.flash")
        assign_action(flash, fact)
    for f in range(n + 1):
        if "stab" in fire:
            # knife thrust: out fast, back slower
            t = f / n
            amount = math.sin(math.pi * min(1.0, t * 1.25)) if t < 0.8 else 0.0
            amount = amount ** 1.3
            dloc = Vector(fire["stab"]) * amount
            drot = Vector((fire["pitch"] * amount, fire["roll"] * amount, -0.1 * amount))
        else:
            k = 0.0 if f == 0 else (1.0 if f == 1 else max(0.0, 1 - ease_out((f - 1) / (n - 1))))
            dloc = Vector(fire["kick"]) * k
            drot = Vector((fire["pitch"] * k, fire["roll"] * k, 0.0))
        set_keys(root, f, base_loc + dloc, Euler(base_rot + drot))
        set_keys(body, f, Vector((0, 0, 0)))
        if flash is not None:
            visible = f in (1, 2)
            s = 1.0 if visible else 0.001
            set_keys(flash, f, scale=(s, s * (0.75 if f == 2 else 1.0), s))
    clips["fire"] = (0, n)
    for obj in (root, body, flash):
        if obj is not None and obj.animation_data and obj.animation_data.action:
            for fc in obj.animation_data.action.fcurves if hasattr(obj.animation_data.action, "fcurves") else []:
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
    return clips


def stroke_at(keys, t):
    """Location and rotation deltas at time t on a Catmull-Rom curve through the keys."""
    t = min(max(t, keys[0][0]), keys[-1][0])
    i = max(k for k in range(len(keys) - 1) if keys[k][0] <= t)
    t0, t1 = keys[i][0], keys[i + 1][0]
    u = (t - t0) / (t1 - t0)
    out = []
    for part in (1, 2):
        p0, p1, p2, p3 = (Vector(keys[max(0, min(len(keys) - 1, j))][part]) for j in (i - 1, i, i + 1, i + 2))
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return tuple(out[0]), tuple(out[1])


def bake_arms(arm, root, body, flash, clips):
    scene = bpy.context.scene
    objs = [o for o in (root, body, flash) if o is not None]
    # keep each clip's root/body/flash action on an NLA track named after the clip
    per_clip_actions = {}
    for name in clips:
        per_clip_actions[name] = {o: bpy.data.actions.get(f"{name}.{suffix}") for o, suffix in ((root, "root"), (body, "body"), (flash, "flash")) if o is not None}
    samples = {}
    for name, (start, end) in clips.items():
        for o, act in per_clip_actions[name].items():
            if act is not None:
                assign_action(o, act)
        frames = {}
        worst = 0.0
        target = bpy.data.objects.get("target_R")
        for f in range(start, end + 1):
            scene.frame_set(f)
            frames[f] = {pb.name: arm.convert_space(pose_bone=pb, matrix=pb.matrix, from_space="POSE", to_space="LOCAL") for pb in arm.pose.bones}
            if target is not None:
                wrist = arm.matrix_world @ arm.pose.bones["Bip01 R Hand"].head
                worst = max(worst, (wrist - target.matrix_world.translation).length)
        log(f"{name}: {end - start + 1} frames, worst right-wrist reach error {worst * 100:.1f} cm")
        samples[name] = frames
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.rotation_mode = "QUATERNION"
    for name, frames in samples.items():
        act = bpy.data.actions.new(f"{name}.arms")
        assign_action(arm, act)
        for f, bones in frames.items():
            for bone_name, m in bones.items():
                pb = arm.pose.bones[bone_name]
                pb.matrix_basis = m
                pb.keyframe_insert("location", frame=f)
                pb.keyframe_insert("rotation_quaternion", frame=f)
                pb.keyframe_insert("scale", frame=f)
        push_to_nla(arm, name)
        for o, a in per_clip_actions[name].items():
            if a is not None:
                assign_action(o, a)
                push_to_nla(o, name)
    scene.frame_set(0)


# ---------------------------------------------------------------------------
# output

def setup_preview_scene():
    scene = bpy.context.scene
    cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
    scene.collection.objects.link(cam)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = RAD(75)
    cam.data.clip_start = 0.01
    cam.location = (0, 0, 0)
    cam.rotation_euler = (RAD(90), 0, 0)
    scene.camera = cam
    sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (RAD(55), RAD(-20), RAD(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.film_transparent = False
    return [cam, sun]


def render_previews(weapon, outdir, objs, clips):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    helpers = setup_preview_scene()
    shots = {"idle": [0], "walk": [5, 16], "run": [0, 7], "fire": [0, 1, 3, 6],
             "slash": [round(t * ATTACK_SLOW * FPS) for t in (0.07, 0.13, 0.2, 0.3)], "stab": [round(t * ATTACK_SLOW * FPS) for t in (0.16, 0.24, 0.33)]}
    for name, (start, end) in clips.items():
        solo_track(objs, name)
        for f in shots.get(name, [0]):
            scene.frame_set(min(end, start + f))
            scene.render.filepath = os.path.join(outdir, f"{weapon}_{name}_{f:02d}.png")
            bpy.ops.render.render(write_still=True)
    solo_track(objs, "idle")
    scene.frame_set(0)
    cam = helpers[0]
    root = next(o for o in objs if o.name == "weapon_root")
    centre = root.matrix_world.translation
    cam.data.angle_y = RAD(40)
    for label, offset in (("right", (0.45, -0.05, 0.05)), ("left", (-0.45, -0.05, 0.05)), ("top", (0.0, -0.08, 0.5)), ("front", (0.0, 0.5, 0.05)), ("iso", (0.3, 0.3, 0.25))):
        cam.location = centre + Vector(offset)
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"{weapon}_detail_{label}.png")
        bpy.ops.render.render(write_still=True)
    for o in helpers:
        bpy.data.objects.remove(o)


def export_glb(path, objs):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="NONE",
        export_image_format="WEBP",
        export_image_quality=82,
        export_skins=True,
        export_influence_nb=4,
        export_morph=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_merge_animation="NLA_TRACK",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_optimize_animation_keep_anim_object=True,
        export_rest_position_armature=True,
        export_lights=False,
        export_cameras=False,
        export_extras=False,
    )


# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--weapon", required=True, choices=sorted(WEAPONS))
    ap.add_argument("--out")
    ap.add_argument("--preview")
    ap.add_argument("--blend", help="also save the authored scene for inspection")
    args = ap.parse_args(argv)
    cfg = WEAPONS[args.weapon]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"

    arm, mesh = load_arms()
    scene.render.fps = FPS  # the FBX importer resets the scene frame rate to the file's 30 fps
    cut_arms(arm, mesh)
    subdivide(mesh)
    info = {side: hand_info(arm, mesh, side) for side in "LR"}
    for side in "LR":
        log(side, "wrist", tuple(round(v, 3) for v in info[side]["wrist"]), "palm normal", tuple(round(v, 2) for v in info[side]["n"]), "d_palm", round(info[side]["d_palm"], 3))
    rebuild_bones(arm, info)
    build_arm_textures(mesh)
    arm.rotation_euler = Euler((0, 0, cfg.get("torso_yaw", 0.0)))
    arm.scale = (cfg.get("arm_scale", 1.0),) * 3
    arm.location = Vector(cfg.get("shoulder_shift", (0, 0, 0)))

    body = add_empty("body")
    root = add_empty("weapon_root", body)
    weapon = load_weapon(cfg)
    weapon.parent = root
    weapon.matrix_parent_inverse = Matrix.Identity(4)
    root.location = Vector(cfg["pose"]["location"])
    root.rotation_euler = Euler(cfg["pose"]["rotation"])
    flash = make_flash(cfg, weapon)
    bpy.context.view_layer.update()
    place_hands(arm, info, cfg, root, body)
    clips = author_clips(cfg, root, body, flash)
    bake_arms(arm, root, body, flash, clips)
    for name in ("target_L", "target_R", "pole_L", "pole_R"):
        bpy.data.objects.remove(bpy.data.objects[name])
    objs = [o for o in (arm, mesh, body, root, weapon, flash) if o is not None]
    if args.preview:
        render_previews(args.weapon, args.preview, objs, clips)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    if args.out:
        export_glb(os.path.abspath(args.out), objs)
        log("wrote", args.out, os.path.getsize(os.path.abspath(args.out)), "bytes")


if __name__ == "__main__":
    main()
