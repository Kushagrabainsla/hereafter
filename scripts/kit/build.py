"""Build public/models/market-kit.glb: the pieces that dress the Night Market's walls.

Run inside Blender 4.4 or newer, from the repository root:

  blender -b --python scripts/kit/build.py -- --out public/models/market-kit.glb [--preview DIR]

Every piece is modelled at real size, with flat materials (no textures), against a wall in
the XZ plane at y = 0: X runs along the wall, -Y points out of it and Z is up. The glTF
exporter turns -Y into three.js +Z, so src/world/facades.ts and src/world/doors.ts turn each
piece to face out of its wall. All pieces sit at the origin; their origins are:

  door_glass, door_panel, door_french   door leaves for the restaurant, the bar and the balcony,
  door_steel                            and a steel back door: at the hinge, on the floor, in
                                        the middle of the leaf's thickness; the leaf runs +X
  frame_steel        a back door's frame and canopy: bottom centre of the opening
  boards             planks nailed over a window: centre of the opening
  ac_window          a through-wall air conditioner: bottom centre of the unit
  condenser          a split air conditioner's outdoor unit: bottom centre
  pipe_seg, pipe_shoe, pipe_head   a downpipe's 1 m length, foot and rain hopper: at the bottom
  meter_box          an electricity meter cabinet: bottom centre
  vent               a louvred vent: its centre
  steam_run          1 m of lagged steam pipe along +X: its start, on the pipe's axis height
  steam_valve        the valve between two runs: its centre
  steam_end_l, steam_end_r   elbows where a run turns into the wall, coming from +X or -X
  escape_platform, escape_stair, escape_ladder   a fire escape's landing, the flight up to
                     the next landing and the drop ladder under the lowest: at the landing's
                     deck, centred along the wall
  record_bin, record_shelf, turntable   the record shop's fittings: bottom centre
  extinguisher       a wall-mounted fire extinguisher: bottom centre at the wall
  fuel_drum          a red fuel drum: bottom centre

The market stalls are modelled in the stall's own frame instead: the counter faces +X, the
stall runs 3 m along Y and its origin is on the ground under the middle of the counter:

  stall_body         counter, posts, back rack and shelves, price board
  stall_awning, stall_awning_torn   the striped awning, whole and shot to rags
  stall_wreck        the stall collapsed into a low pile
  goods_noodles, goods_fruit, goods_grill, goods_tea, goods_trinkets   what each kind sells

Materials named paint_* are pale so the game can tint each copy.
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

RAD = math.radians


def log(*args):
    print("[kit]", *args, flush=True)


def srgb(hex_value):
    c = [((hex_value >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


MATERIALS = {}


def material(name, color, metal=0.0, rough=0.5, alpha=1.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(color)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = srgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    MATERIALS[name] = m
    return m


SLEEVES = [0xd94f3d, 0x2f6fb5, 0xf2c14e, 0x3c9d6b, 0x1d1d1f, 0xe8e1d0, 0x8e44ad, 0xef8a3a]


def make_materials():
    material("wood_door", 0x6b4226, 0.0, 0.45)
    material("wood_bar", 0x3b1f14, 0.0, 0.5)
    material("brass", 0xc9a04a, 1.0, 0.28)
    material("glass", 0x1a2a30, 0.2, 0.03, alpha=0.3)
    material("glass_dark", 0x0b1013, 0.5, 0.1)
    material("paint_door", 0xe6e6e6, 0.35, 0.55)
    material("paint_ac", 0xe2ded4, 0.1, 0.5)
    material("paint_pipe", 0xd8d8d8, 0.6, 0.45)
    material("steel", 0xa9adb0, 1.0, 0.35)
    material("dark_steel", 0x2a2e31, 0.7, 0.5)
    material("grille", 0x1f2224, 0.5, 0.6)
    material("galvanized", 0xa7acae, 0.9, 0.42)
    material("insulation", 0xd9d2c2, 0.0, 0.85)
    material("valve_red", 0xa3261b, 0.3, 0.45)
    material("gauge_face", 0xf1ede2, 0.0, 0.4)
    material("tag", 0xf2c230, 0.0, 0.6)
    material("black", 0x101010, 0.0, 0.6)
    material("copper", 0xb5683a, 1.0, 0.35)
    material("plywood", 0xb58d5c, 0.0, 0.85)
    material("plywood_dark", 0x86653f, 0.0, 0.9)
    material("old_wood", 0x6e5a44, 0.0, 0.9)
    material("escape_iron", 0x1e2225, 0.55, 0.62)
    material("wood_bin", 0x7a5230, 0.0, 0.7)
    material("wood_shelf", 0x5b3b22, 0.0, 0.7)
    material("card", 0xece6d6, 0.0, 0.8)
    material("wood_stall", 0x8a5a35, 0.0, 0.8)
    material("wood_stall2", 0x76492a, 0.0, 0.85)
    material("wood_top", 0xa8774a, 0.0, 0.55)
    material("wood_post", 0x5e3b22, 0.0, 0.8)
    material("chalkboard", 0x1d2420, 0.0, 0.9)
    material("chalk", 0xe9e4d6, 0.0, 0.9)
    material("fabric_cream", 0xf1e7cf, 0.0, 0.9)
    material("paint_awning", 0xf2f2f2, 0.0, 0.9)
    material("fruit_orange", 0xf08a1c, 0.0, 0.45)
    material("fruit_red", 0xb8231c, 0.0, 0.4)
    material("fruit_green", 0x7fb03a, 0.0, 0.45)
    material("fruit_yellow", 0xf2cf3a, 0.0, 0.5)
    material("noodle", 0xf0d48a, 0.0, 0.7)
    material("ceramic", 0xf4f0e6, 0.0, 0.25)
    material("ceramic_blue", 0x3e6fa8, 0.0, 0.25)
    material("sauce_red", 0x9a1f15, 0.1, 0.15)
    material("sauce_dark", 0x2a1408, 0.1, 0.15)
    material("coals", 0x2a0d05, 0.0, 0.9, emit=0xff5a1a, strength=3.0)
    material("meat", 0x7a3a1c, 0.0, 0.6)
    material("paper_red", 0xc8281e, 0.0, 0.7, emit=0xff5a2a, strength=0.6)
    material("paper_yellow", 0xe8b84a, 0.0, 0.7, emit=0xffb04a, strength=0.6)
    material("wicker", 0xb08850, 0.0, 0.85)
    material("extinguisher_red", 0xb3140f, 0.3, 0.35)
    material("fuel_red", 0x9e1b14, 0.4, 0.45)
    material("hazard", 0xf2c230, 0.0, 0.5)
    for i, color in enumerate(SLEEVES):
        material(f"sleeve{i}", color, 0.0, 0.5)


# ---------------------------------------------------------------------------
# geometry helpers

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    if mat:
        obj.data.materials.append(MATERIALS[mat])
    return obj


def apply_modifiers(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel(obj, width, segments=2, angle=35):
    if width <= 0:
        return obj
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = RAD(angle)
    mod.harden_normals = False
    apply_modifiers(obj)
    return obj


def box(name, x0, x1, y0, y1, z0, z1, mat, bev=0.0, segments=2):
    (x0, x1), (y0, y1), (z0, z1) = sorted((x0, x1)), sorted((y0, y1)), sorted((z0, z1))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((v.co.x + 0.5) * (x1 - x0) + x0, (v.co.y + 0.5) * (y1 - y0) + y0, (v.co.z + 0.5) * (z1 - z0) + z0))
    return bevel(mesh_object(name, bm, mat), bev, segments)


def turned_box(name, size, center, rotation, mat, bev=0.0):
    """A box of a size, turned by Euler angles (radians) about its centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(Vector(center)) @ Euler(rotation).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bevel(mesh_object(name, bm, mat), bev)


def cylinder(name, radius, depth, center, axis, mat, verts=20, bev=0.0, radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    rot = {"X": Matrix.Rotation(RAD(90), 4, "Y"), "Y": Matrix.Rotation(RAD(90), 4, "X"), "Z": Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=bm.verts)
    return bevel(mesh_object(name, bm, mat), bev)


def tube(name, points, radius, mat, verts=12, caps=True):
    """A round tube swept along a polyline, its rings carried along without twisting."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    t = (pts[1] - pts[0]).normalized()
    helper = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    n = t.cross(helper).normalized()
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radius) for a in (2 * math.pi * k / verts for k in range(verts))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(verts):
            bm.faces.new((r0[k], r0[(k + 1) % verts], r1[(k + 1) % verts], r1[k]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, mat)


def arc(center, radius, a0, a1, steps, plane="XY"):
    """Points on a circular arc from angle a0 to a1 (degrees) in a plane through a centre."""
    out = []
    for i in range(steps + 1):
        a = RAD(a0 + (a1 - a0) * i / steps)
        u, v = math.cos(a) * radius, math.sin(a) * radius
        x, y, z = center
        out.append({"XY": (x + u, y + v, z), "XZ": (x + u, y, z + v), "YZ": (x, y + u, z + v)}[plane])
    return out


def ring(name, radius, minor, center, axis, mat, verts=32):
    pts = arc((0, 0, 0), radius, 0, 360, verts, {"X": "YZ", "Y": "XZ", "Z": "XY"}[axis])
    obj = tube(name, pts, minor, mat, verts=8, caps=False)
    obj.data.transform(Matrix.Translation(Vector(center)))
    return obj


def prism(name, profile, y0, y1, mat, bev=0.0):
    """A shape drawn in the XZ plane as (x, z) points and extruded from y0 to y1."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y0, z)) for x, z in profile]
    back = [bm.verts.new((x, y1, z)) for x, z in profile]
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bevel(mesh_object(name, bm, mat), bev)


def cut(obj, cutter, mat=None, op="DIFFERENCE"):
    """Boolean with a cutter, whose material (if given) dresses the cut faces."""
    if mat:
        cutter.data.materials.clear()
        cutter.data.materials.append(MATERIALS[mat])
        if MATERIALS[mat].name not in [m.name for m in obj.data.materials]:
            obj.data.materials.append(MATERIALS[mat])
    mod = obj.modifiers.new("Bool", "BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    mod.material_mode = "TRANSFER"
    apply_modifiers(obj)
    bpy.data.objects.remove(cutter)
    return obj


def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def smooth(obj, angle=40):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=RAD(angle))
    return obj


def mirror_x(obj):
    obj.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
    obj.data.flip_normals()
    return obj


# ---------------------------------------------------------------------------
# doors

def hinges(x, height, radius=0.014):
    return [cylinder("hinge", radius, 0.1, (x, 0, z), "Z", "dark_steel", verts=12) for z in (0.25, height / 2 + 0.1, height - 0.3)]


def push_bar(x0, x1, z, side, half_t, mat="brass", stand=0.055):
    y = side * (half_t + stand)
    bar = cylinder("bar", 0.016, x1 - x0, ((x0 + x1) / 2, y, z), "X", mat, verts=14)
    posts = [cylinder("post", 0.011, stand, (x, side * (half_t + stand / 2), z), "Y", mat, verts=10) for x in (x0 + 0.03, x1 - 0.03)]
    return [bar] + posts


def glass_leaf(name, width, height, muntins=False):
    t = 0.05
    stile, top, bottom = 0.11, 0.11, 0.4 if not muntins else 0.32
    leaf = box(name + "_wood", 0, width, -t / 2, t / 2, 0.01, height, "wood_door", bev=0.006)
    gx0, gx1, gz0, gz1 = stile, width - stile, bottom, height - top
    cut(leaf, box("c", gx0, gx1, -0.1, 0.1, gz0, gz1, None), "wood_door")
    parts = [leaf, box(name + "_glass", gx0, gx1, -0.005, 0.005, gz0, gz1, "glass")]
    for side in (-1, 1):
        y0, y1 = side * t / 2, side * (t / 2 + 0.012)
        parts += [
            box("bead", gx0 - 0.02, gx1 + 0.02, y0, y1, gz0 - 0.02, gz0, "wood_door"),
            box("bead", gx0 - 0.02, gx1 + 0.02, y0, y1, gz1, gz1 + 0.02, "wood_door"),
            box("bead", gx0 - 0.02, gx0, y0, y1, gz0, gz1, "wood_door"),
            box("bead", gx1, gx1 + 0.02, y0, y1, gz0, gz1, "wood_door"),
            box("kick", 0.03, width - 0.03, y0, side * (t / 2 + 0.002), 0.03, bottom - 0.06, "brass"),
        ]
        if muntins:
            for k in (1, 2):
                z = gz0 + (gz1 - gz0) * k / 3
                parts.append(box("muntin", gx0, gx1, -t / 2 * 0.6, t / 2 * 0.6, z - 0.015, z + 0.015, "wood_door"))
            parts.append(box("muntin", (gx0 + gx1) / 2 - 0.015, (gx0 + gx1) / 2 + 0.015, -t / 2 * 0.6, t / 2 * 0.6, gz0, gz1, "wood_door"))
        parts += push_bar(0.16, width - 0.08, 1.05, side, t / 2) if not muntins else [
            cylinder("knob", 0.028, 0.05, (width - 0.08, side * (t / 2 + 0.025), 1.05), "Y", "brass", verts=14)]
    return join(parts + hinges(-0.004, height), name)


def door_glass():
    return glass_leaf("door_glass", 0.79, 2.58)


def door_french():
    return glass_leaf("door_french", 0.79, 2.38, muntins=True)


def door_panel():
    w, h, t = 0.79, 2.58, 0.05
    leaf = box("door_panel_wood", 0, w, -t / 2, t / 2, 0.01, h, "wood_bar", bev=0.006)
    for side in (-1, 1):
        for z0, z1 in ((0.18, 1.0), (1.12, h - 0.14)):
            y = side * t / 2
            cut(leaf, box("recess", 0.12, w - 0.12, y - 0.012, y + 0.012, z0, z1, None, bev=0.004), "wood_bar")
    cut(leaf, cylinder("port", 0.15, 0.2, (w / 2, 0, 1.62), "Y", None, verts=32), "brass")
    parts = [leaf, cylinder("door_panel_glass", 0.15, 0.01, (w / 2, 0, 1.62), "Y", "glass", verts=32)]
    for side in (-1, 1):
        parts.append(ring("porthole", 0.162, 0.016, (w / 2, side * t / 2, 1.62), "Y", "brass"))
        parts.append(cylinder("rose", 0.03, 0.012, (w - 0.09, side * (t / 2 + 0.006), 1.05), "Y", "brass", verts=16))
        parts.append(box("lever", w - 0.2, w - 0.09, side * (t / 2 + 0.03), side * (t / 2 + 0.045), 1.04, 1.06, "brass", bev=0.004))
        parts.append(cylinder("stem", 0.008, 0.04, (w - 0.09, side * (t / 2 + 0.03), 1.05), "Y", "brass", verts=8))
        parts.append(box("kick", 0.03, w - 0.03, side * t / 2, side * (t / 2 + 0.002), 0.03, 0.16, "brass"))
    return join(parts + hinges(-0.004, h), "door_panel")


def door_steel():
    w, h, t = 0.98, 2.12, 0.05
    leaf = box("door_steel_leaf", 0, w, -t / 2, t / 2, 0.01, h, "paint_door", bev=0.004)
    cut(leaf, box("window", 0.36, 0.62, -0.1, 0.1, 1.45, 1.9, None), "dark_steel")
    parts = [leaf, box("door_steel_glass", 0.36, 0.62, -0.006, 0.006, 1.45, 1.9, "glass_dark")]
    # Outside: a kick plate, a lever and a lock.
    parts.append(box("kick", 0.03, w - 0.03, -t / 2 - 0.002, -t / 2, 0.03, 0.32, "steel"))
    parts.append(box("plate", w - 0.13, w - 0.05, -t / 2 - 0.008, -t / 2, 0.88, 1.18, "steel", bev=0.003))
    parts.append(box("lever", w - 0.24, w - 0.09, -t / 2 - 0.05, -t / 2 - 0.032, 0.98, 1.0, "steel", bev=0.004))
    parts.append(cylinder("stem", 0.01, 0.04, (w - 0.09, -t / 2 - 0.025, 0.99), "Y", "steel", verts=10))
    parts.append(cylinder("lock", 0.016, 0.012, (w - 0.09, -t / 2 - 0.012, 1.11), "Y", "brass", verts=12))
    # Inside: a push bar.
    parts += push_bar(0.15, w - 0.2, 1.0, 1, t / 2, "steel", 0.06)
    parts.append(box("latch", w - 0.22, w - 0.06, t / 2, t / 2 + 0.075, 0.95, 1.05, "dark_steel", bev=0.008))
    return join(parts + hinges(-0.004, h, 0.016), "door_steel")


def frame_steel():
    w, h = 1.0, 2.15
    parts = [
        box("jamb", -w / 2 - 0.07, -w / 2, -0.05, 0.3, 0, h + 0.07, "dark_steel", bev=0.004),
        box("jamb", w / 2, w / 2 + 0.07, -0.05, 0.3, 0, h + 0.07, "dark_steel", bev=0.004),
        box("head", -w / 2 - 0.07, w / 2 + 0.07, -0.05, 0.3, h, h + 0.07, "dark_steel", bev=0.004),
        box("sill", -w / 2 - 0.05, w / 2 + 0.05, -0.12, 0.0, 0, 0.025, "steel", bev=0.004),
    ]
    # A sheet-steel canopy on two tie rods.
    z = h + 0.42
    parts.append(prism("canopy", [(-0.75, z), (0.75, z), (0.75, z + 0.05), (-0.75, z + 0.05)], -0.62, 0.0, "paint_door", bev=0.004))
    canopy = parts[-1]
    for v in canopy.data.vertices:
        v.co.z += (v.co.y) * 0.25
    parts.append(box("lip", -0.76, 0.76, -0.64, -0.6, z - 0.2, z - 0.105, "paint_door"))
    for x in (-0.68, 0.68):
        parts.append(tube("rod", [(x, -0.01, z + 0.55), (x, -0.6, z - 0.1)], 0.008, "dark_steel", verts=8))
        parts.append(box("plate", x - 0.04, x + 0.04, -0.012, 0, z + 0.5, z + 0.6, "dark_steel"))
    return join(parts, "frame_steel")


def boards():
    random.seed(7)
    parts = []
    z = -0.93
    mats = ["plywood", "old_wood", "plywood_dark"]
    for i in range(7):
        hgt = 0.22 + random.uniform(-0.02, 0.02)
        x0, x1 = -1.08 - random.uniform(0, 0.06), 1.08 + random.uniform(0, 0.06)
        tilt = RAD(random.uniform(-2.2, 2.2))
        parts.append(turned_box("plank", ((x1 - x0), 0.025, hgt), ((x0 + x1) / 2, -0.035, z + hgt / 2), (0, tilt, 0), mats[i % 3], bev=0.004))
        for x in (x0 + 0.05, x1 - 0.05):
            for dz in (0.06, hgt - 0.06):
                parts.append(cylinder("nail", 0.006, 0.006, (x, -0.05, z + dz), "Y", "dark_steel", verts=6))
        z += hgt + 0.045
    parts.append(turned_box("brace", (2.5, 0.025, 0.2), (0, -0.062, 0.0), (0, RAD(-36), 0), "plywood_dark", bev=0.004))
    for x in (-0.85, 0.85):
        parts.append(box("batten", x - 0.06, x + 0.06, -0.09, -0.074, -0.95, 0.95, "old_wood", bev=0.003))
    return join(parts, "boards")


# ---------------------------------------------------------------------------
# wall services

def ac_window():
    body = box("ac_body", -0.33, 0.33, -0.52, 0.02, 0, 0.42, "paint_ac", bev=0.02, segments=3)
    cut(body, box("grille", -0.29, 0.29, -0.6, -0.5, 0.05, 0.37, None), "grille")
    for side in (-1, 1):
        for k in range(7):
            y = -0.45 + k * 0.055
            cut(body, box("fin", side * 0.36, side * 0.32, y, y + 0.014, 0.1, 0.34, None), "grille")
    parts = [body]
    for k in range(9):
        z = 0.07 + k * 0.034
        parts.append(turned_box("louvre", (0.57, 0.005, 0.03), (0, -0.505, z), (RAD(-35), 0, 0), "paint_ac"))
    parts.append(box("panel", 0.19, 0.29, -0.523, -0.518, 0.25, 0.36, "dark_steel"))
    for x in (-0.22, 0.22):
        parts.append(box("rail", x - 0.015, x + 0.015, -0.48, 0.0, -0.03, 0.0, "dark_steel"))
        parts.append(tube("strut", [(x, -0.005, -0.36), (x, -0.44, -0.02)], 0.011, "dark_steel", verts=8))
    parts.append(tube("drain", [(0.25, -0.1, 0.0), (0.25, -0.1, -0.12), (0.25, -0.2, -0.2)], 0.008, "black", verts=6))
    return join(parts, "ac_window")


def condenser():
    body = box("cond_body", -0.41, 0.41, -0.34, -0.03, 0, 0.6, "paint_ac", bev=0.015)
    cut(body, cylinder("fan", 0.24, 0.1, (-0.08, -0.34, 0.3), "Y", None, verts=40), "grille")
    for k in range(9):
        x = 0.2 + k * 0.018
        cut(body, box("slot", x, x + 0.009, -0.4, -0.3, 0.08, 0.52, None), "grille")
    parts = [body]
    for r in (0.08, 0.16, 0.235):
        parts.append(ring("guard", r, 0.004, (-0.08, -0.35, 0.3), "Y", "dark_steel", verts=36))
    for a in (0, 45, 90, 135):
        parts.append(turned_box("spoke", (0.47, 0.006, 0.006), (-0.08, -0.35, 0.3), (0, RAD(a), 0), "dark_steel"))
    for a in (10, 130, 250):
        parts.append(turned_box("blade", (0.2, 0.01, 0.07), (-0.08 + math.cos(RAD(a)) * 0.11, -0.3, 0.3 + math.sin(RAD(a)) * 0.11), (RAD(20), -RAD(a), 0), "grille"))
    parts.append(cylinder("hub", 0.035, 0.03, (-0.08, -0.31, 0.3), "Y", "dark_steel", verts=14))
    for x in (-0.3, 0.3):
        parts.append(box("rail", x - 0.02, x + 0.02, -0.38, 0.0, -0.04, 0.0, "dark_steel"))
        parts.append(tube("strut", [(x, -0.005, -0.38), (x, -0.36, -0.03)], 0.012, "dark_steel", verts=8))
    for dz, r, mat in ((0.12, 0.022, "black"), (0.2, 0.012, "copper")):
        parts.append(tube("line", [(0.41, -0.15, dz), (0.47, -0.15, dz), (0.5, -0.12, dz), (0.5, 0.02, dz)], r, mat, verts=8))
    return join(parts, "condenser")


def pipe_seg():
    parts = [cylinder("pipe", 0.05, 1.0, (0, -0.085, 0.5), "Z", "paint_pipe", verts=12)]
    parts.append(cylinder("band", 0.056, 0.035, (0, -0.085, 0.5), "Z", "paint_pipe", verts=12))
    parts.append(box("ear", -0.085, 0.085, -0.045, 0.0, 0.49, 0.51, "paint_pipe"))
    for x in (-0.07, 0.07):
        parts.append(cylinder("bolt", 0.008, 0.008, (x, -0.045, 0.5), "Y", "dark_steel", verts=6))
    return join(parts, "pipe_seg")


def pipe_shoe():
    # Straight down, then a 40 degree bend out from the wall.
    pts = [(0, -0.085, 0.4)] + [(0, -0.195 + math.cos(RAD(a)) * 0.11, 0.17 - math.sin(RAD(a)) * 0.11) for a in range(0, 50, 10)]
    shoe = tube("shoe", pts, 0.05, "paint_pipe", verts=16)
    lip = cylinder("lip", 0.058, 0.03, pts[-1], "Z", "paint_pipe", verts=16)
    lip.data.transform(Matrix.Translation(Vector(pts[-1])) @ Matrix.Rotation(RAD(-40), 4, "X") @ Matrix.Translation(-Vector(pts[-1])))
    return join([shoe, lip], "pipe_shoe")


def pipe_head():
    parts = [cylinder("neck", 0.05, 0.08, (0, -0.085, 0.04), "Z", "paint_pipe", verts=16)]
    hopper = prism("hopper", [(-0.08, 0.06), (0.08, 0.06), (0.17, 0.32), (-0.17, 0.32)], -0.21, -0.01, "paint_pipe", bev=0.004)
    for v in hopper.data.vertices:
        if v.co.z < 0.1:
            v.co.y = -0.085 + (v.co.y + 0.11) * 0.6
    parts.append(hopper)
    parts.append(box("rim", -0.18, 0.18, -0.22, -0.0, 0.31, 0.34, "paint_pipe"))
    parts.append(box("spout", -0.05, 0.05, -0.08, 0.0, 0.34, 0.42, "paint_pipe"))
    return join(parts, "pipe_head")


def meter_box():
    parts = [box("cabinet", -0.2, 0.2, -0.18, 0.0, 0.0, 0.55, "paint_pipe", bev=0.01)]
    parts.append(box("door_seam", -0.17, 0.17, -0.183, -0.179, 0.03, 0.52, "steel"))
    parts.append(cylinder("meter", 0.085, 0.03, (0, -0.19, 0.36), "Y", "glass_dark", verts=24))
    parts.append(ring("meter_rim", 0.088, 0.008, (0, -0.205, 0.36), "Y", "steel", verts=24))
    parts.append(box("label", -0.08, 0.08, -0.185, -0.18, 0.12, 0.17, "tag"))
    parts.append(tube("conduit_up", [(0.1, -0.05, 0.55), (0.1, -0.05, 1.5), (0.1, -0.03, 1.6), (0.1, 0.02, 1.62)], 0.018, "dark_steel", verts=10))
    parts.append(tube("conduit_down", [(-0.1, -0.05, 0.0), (-0.1, -0.05, -1.2)], 0.018, "dark_steel", verts=10))
    for z in (0.95, 1.3, -0.5):
        x = 0.1 if z > 0 else -0.1
        parts.append(box("strap", x - 0.03, x + 0.03, -0.075, 0.0, z - 0.012, z + 0.012, "steel"))
    return join(parts, "meter_box")


def vent():
    frame = box("vent_frame", -0.24, 0.24, -0.045, 0.0, -0.16, 0.16, "galvanized", bev=0.006)
    cut(frame, box("c", -0.2, 0.2, -0.1, 0.1, -0.12, 0.12, None), "grille")
    parts = [frame, box("back", -0.2, 0.2, -0.006, 0.0, -0.12, 0.12, "grille")]
    for k in range(6):
        z = -0.1 + k * 0.04
        parts.append(turned_box("slat", (0.4, 0.004, 0.045), (0, -0.025, z), (RAD(-40), 0, 0), "galvanized"))
    return join(parts, "vent")


STEAM_Y = -0.2


def steam_run():
    parts = [cylinder("lagging", 0.085, 1.0, (0.5, STEAM_Y, 0), "X", "insulation", verts=18)]
    for x in (0.08, 0.36, 0.64, 0.92):
        parts.append(cylinder("band", 0.088, 0.025, (x, STEAM_Y, 0), "X", "galvanized", verts=18))
    parts.append(box("arm", 0.48, 0.52, STEAM_Y, 0.0, -0.11, -0.085, "dark_steel"))
    parts.append(box("plate", 0.44, 0.56, -0.012, 0.0, -0.16, -0.04, "dark_steel"))
    parts.append(ring("clamp", 0.09, 0.008, (0.5, STEAM_Y, 0), "X", "dark_steel", verts=20))
    return join(parts, "steam_run")


def steam_valve():
    parts = [cylinder("core", 0.07, 0.44, (0, STEAM_Y, 0), "X", "galvanized", verts=18)]
    parts.append(box("body", -0.1, 0.1, STEAM_Y - 0.09, STEAM_Y + 0.09, -0.1, 0.1, "dark_steel", bev=0.02))
    for x in (-0.16, 0.16):
        parts.append(cylinder("flange", 0.12, 0.03, (x, STEAM_Y, 0), "X", "galvanized", verts=24))
        for k in range(8):
            a = 2 * math.pi * k / 8
            parts.append(cylinder("bolt", 0.012, 0.06, (x, STEAM_Y + math.cos(a) * 0.095, math.sin(a) * 0.095), "X", "dark_steel", verts=6))
    parts.append(cylinder("stem", 0.015, 0.16, (0, STEAM_Y - 0.17, 0), "Y", "steel", verts=10))
    parts.append(ring("wheel", 0.1, 0.012, (0, STEAM_Y - 0.25, 0), "Y", "valve_red", verts=28))
    for a in (0, 60, 120):
        parts.append(turned_box("spoke", (0.2, 0.012, 0.012), (0, STEAM_Y - 0.25, 0), (0, RAD(a), 0), "valve_red"))
    parts.append(cylinder("boss", 0.022, 0.03, (0, STEAM_Y - 0.25, 0), "Y", "valve_red", verts=12))
    parts.append(cylinder("gauge_stem", 0.01, 0.1, (0, STEAM_Y, 0.15), "Z", "steel", verts=8))
    parts.append(cylinder("gauge", 0.06, 0.035, (0, STEAM_Y - 0.01, 0.24), "Y", "steel", verts=24))
    parts.append(cylinder("dial", 0.05, 0.004, (0, STEAM_Y - 0.03, 0.24), "Y", "gauge_face", verts=24))
    parts.append(turned_box("needle", (0.04, 0.003, 0.004), (0.008, STEAM_Y - 0.034, 0.245), (0, RAD(-30), 0), "valve_red"))
    parts.append(box("tag", 0.07, 0.15, STEAM_Y - 0.1, STEAM_Y - 0.096, -0.18, -0.1, "tag"))
    parts.append(tube("tag_wire", [(0.06, STEAM_Y - 0.098, -0.05), (0.08, STEAM_Y - 0.098, -0.1)], 0.002, "steel", verts=4, caps=False))
    return join(parts, "steam_valve")


def steam_end(name, sign):
    """The run arrives along the wall from +X (sign 1) or -X (sign -1) and bends into it."""
    pts = [(sign * 0.2 * math.cos(RAD(a)), 0.2 * math.sin(RAD(a)), 0) for a in range(-90, -181, -10)]
    end = pts[-1]
    parts = [tube("elbow", [(sign * 0.02, STEAM_Y, 0)] + pts + [(end[0], 0.03, 0)], 0.085, "insulation", verts=18)]
    parts.append(cylinder("collar", 0.13, 0.02, (end[0], -0.01, 0), "Y", "galvanized", verts=24))
    parts.append(cylinder("band", 0.088, 0.025, (end[0], -0.06, 0), "Y", "galvanized", verts=18))
    return join(parts, name)


# ---------------------------------------------------------------------------
# fire escape

ESC_W, ESC_D, HATCH = 1.6, 1.12, (-1.6, -0.95, -1.1, -0.56)


def escape_platform():
    parts = []
    w, d = ESC_W, ESC_D
    parts.append(box("edge", -w, w, -d - 0.04, -d, -0.1, 0.0, "escape_iron"))
    for x in (-w, w - 0.04):
        parts.append(box("edge", x, x + 0.04, -d, -0.02, -0.1, 0.0, "escape_iron"))
    parts.append(box("ledger", -w, w, -0.06, 0.0, -0.1, 0.0, "escape_iron"))
    hx0, hx1, hy0, hy1 = HATCH
    x = -w + 0.04
    while x < w - 0.04:
        if hx0 <= x <= hx1:
            parts.append(box("slat", x, x + 0.012, hy1, -0.06, -0.03, 0.0, "escape_iron"))
        else:
            parts.append(box("slat", x, x + 0.012, -d, -0.06, -0.03, 0.0, "escape_iron"))
        x += 0.055
    for y in (-d * 0.33, -d * 0.66):
        parts.append(box("joist", -w, w, y - 0.015, y + 0.015, -0.07, -0.03, "escape_iron"))
    parts.append(box("hatch_edge", hx0, hx1, hy1 - 0.02, hy1, -0.1, 0.0, "escape_iron"))
    parts.append(box("hatch_edge", hx1, hx1 + 0.02, hy0 - 0.02, hy1, -0.1, 0.0, "escape_iron"))
    # Railing: posts, a top and a middle rail and close balusters.
    top, mid = 1.0, 0.5
    corners = [(-w + 0.02, -0.04), (-w + 0.02, -d - 0.02), (w - 0.02, -d - 0.02), (w - 0.02, -0.04)]
    for z in (top, mid):
        parts.append(tube("rail", [(cx, cy, z) for cx, cy in corners], 0.017 if z == top else 0.011, "escape_iron", verts=8))
    for (ax, ay), (bx, by) in zip(corners, corners[1:]):
        length = math.hypot(bx - ax, by - ay)
        n = max(2, int(length / 0.11))
        for k in range(n + 1):
            t = k / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            post = k in (0, n) or k % 7 == 0
            parts.append(box("post", px - 0.018, px + 0.018, py - 0.018, py + 0.018, 0.0, top, "escape_iron") if post else
                         cylinder("baluster", 0.007, top, (px, py, top / 2), "Z", "escape_iron", verts=6))
    for x in (-1.15, 1.15):
        parts.append(tube("brace", [(x, -0.01, -0.95), (x, -d + 0.05, -0.08)], 0.02, "escape_iron", verts=8))
        parts.append(box("wall_plate", x - 0.06, x + 0.06, -0.012, 0.0, -1.05, -0.85, "escape_iron"))
    return join(parts, "escape_platform")


def escape_stair():
    parts = []
    x_bottom, x_top, rise = 1.3, -0.95, 3.3
    y0, y1 = -1.08, -0.6
    steps = 15
    length = math.hypot(x_top - x_bottom, rise)
    slope = math.atan2(rise, x_bottom - x_top)
    for y in (y0, y1):
        parts.append(turned_box("stringer", (length, 0.012, 0.2), ((x_bottom + x_top) / 2, y, rise / 2), (0, slope, 0), "escape_iron"))
    for k in range(1, steps):
        t = k / steps
        x, z = x_bottom + (x_top - x_bottom) * t, rise * t
        for j in range(5):
            yy = y0 + 0.03 + j * 0.1
            parts.append(box("tread", x - 0.075, x + 0.075, yy, yy + 0.07, z - 0.025, z, "escape_iron"))
        parts.append(box("nosing", x - 0.08, x - 0.07, y0, y1, z - 0.05, z, "escape_iron"))
    for y in (y0 - 0.01, y1 + 0.01):
        parts.append(tube("handrail", [(x_bottom + 0.1, y, 0.95), (x_top + 0.05, y, rise + 0.95)], 0.016, "escape_iron", verts=8))
        for t in (0.05, 0.5, 0.95):
            x, z = x_bottom + (x_top - x_bottom) * t, rise * t
            parts.append(cylinder("stanchion", 0.012, 0.95, (x, y, z + 0.475), "Z", "escape_iron", verts=6))
    return join(parts, "escape_stair")


def escape_ladder():
    x, y = (HATCH[0] + HATCH[1]) / 2, (HATCH[2] + HATCH[3]) / 2
    parts = []
    for dy in (-0.18, 0.18):
        parts.append(box("rail", x - 0.02, x + 0.02, y + dy - 0.01, y + dy + 0.01, -1.9, 1.0, "escape_iron"))
    z = -1.8
    while z < 0.95:
        parts.append(cylinder("rung", 0.011, 0.36, (x, y, z), "Y", "escape_iron", verts=6))
        z += 0.3
    parts.append(box("guide", x - 0.12, x + 0.12, y - 0.24, y + 0.24, -0.16, -0.1, "escape_iron"))
    return join(parts, "escape_ladder")


# ---------------------------------------------------------------------------
# the record shop

def sleeves(parts, count, x0, step, y, z, tilt, rng, axis="X", size=0.315, thick=0.006):
    for k in range(count):
        mat = f"sleeve{rng.randrange(len(SLEEVES))}"
        jitter = rng.uniform(-0.004, 0.004)
        if axis == "X":
            parts.append(turned_box("sleeve", (thick, size, size), (x0 + k * step + jitter, y, z + size / 2), (0, tilt, 0), mat))


def record_bin():
    rng = random.Random(11)
    w, d, top = 1.4, 0.76, 0.76
    parts = []
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        for y in (-d / 2 + 0.03, d / 2 - 0.03):
            parts.append(box("leg", x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0.0, 0.46, "wood_bin"))
    tub = box("tub", -w / 2, w / 2, -d / 2, d / 2, 0.44, top, "wood_bin", bev=0.006)
    cut(tub, box("c", -w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.03, d / 2 - 0.03, 0.48, top + 0.1, None), "wood_bin")
    parts.append(tub)
    parts.append(box("divider", -0.01, 0.01, -d / 2 + 0.03, d / 2 - 0.03, 0.46, top - 0.02, "wood_bin"))
    parts.append(box("shelf", -w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.03, d / 2 - 0.03, 0.1, 0.12, "wood_bin"))
    for y in (-0.18, 0.18):
        for half in (-1, 1):
            x0 = 0.04 if half > 0 else -w / 2 + 0.06
            sleeves(parts, 17, x0, 0.036, y, 0.49, RAD(-12), rng)
        parts.append(turned_box("card", (0.004, 0.32, 0.36), (-0.2, y, 0.49 + 0.18), (0, RAD(-12), 0), "card"))
    for k in range(4):
        x = -0.5 + k * 0.33
        parts.append(box("crate", x - 0.15, x + 0.15, -0.16, 0.16, 0.12, 0.44, f"sleeve{(k * 3) % len(SLEEVES)}"))
    return join(parts, "record_bin")


def record_shelf():
    rng = random.Random(23)
    w, h, d = 1.8, 2.2, 0.4
    parts = [box("side", -w / 2, -w / 2 + 0.03, -d, 0.0, 0.0, h, "wood_shelf"), box("side", w / 2 - 0.03, w / 2, -d, 0.0, 0.0, h, "wood_shelf"),
             box("back", -w / 2, w / 2, -0.02, 0.0, 0.0, h, "wood_shelf"), box("top", -w / 2, w / 2, -d, 0.0, h - 0.03, h, "wood_shelf")]
    levels = [0.05, 0.5, 0.95, 1.4, 1.85]
    for z in levels:
        parts.append(box("board", -w / 2 + 0.03, w / 2 - 0.03, -d, 0.0, z - 0.025, z, "wood_shelf"))
    # Spines packed on the lower shelves, sleeves face out on the upper ones.
    for z in levels[:3]:
        x = -w / 2 + 0.05
        while x < w / 2 - 0.08:
            n = rng.randint(4, 12)
            width = min(n * 0.009, w / 2 - 0.05 - x)
            parts.append(box("spines", x, x + width, -d + 0.04, -0.03, z, z + 0.315 - rng.uniform(0, 0.01), f"sleeve{rng.randrange(len(SLEEVES))}"))
            x += width + 0.001
    for z in levels[3:]:
        for k in range(5):
            x = -w / 2 + 0.2 + k * 0.35
            parts.append(turned_box("face", (0.315, 0.006, 0.315), (x, -0.12, z + 0.16), (RAD(-10), 0, 0), f"sleeve{rng.randrange(len(SLEEVES))}"))
    return join(parts, "record_shelf")


def turntable():
    parts = [box("plinth", -0.23, 0.23, -0.18, 0.18, 0.0, 0.09, "black", bev=0.008)]
    parts.append(cylinder("platter", 0.15, 0.02, (-0.04, 0, 0.1), "Z", "steel", verts=32))
    parts.append(cylinder("mat", 0.148, 0.004, (-0.04, 0, 0.112), "Z", "black", verts=32))
    parts.append(cylinder("record", 0.15, 0.003, (-0.04, 0, 0.116), "Z", "black", verts=32))
    parts.append(cylinder("label", 0.045, 0.002, (-0.04, 0, 0.118), "Z", "sleeve0", verts=20))
    parts.append(cylinder("pivot", 0.02, 0.04, (0.17, 0.12, 0.11), "Z", "steel", verts=12))
    parts.append(tube("arm", [(0.17, 0.12, 0.13), (0.1, 0.02, 0.13), (0.06, -0.06, 0.125)], 0.005, "steel", verts=6))
    return join(parts, "turntable")



# ---------------------------------------------------------------------------
# market stalls, in the stall's own frame: counter facing +X, 3 m along Y

STALL_Y = 1.5


def sphere(name, radius, center, mat, segments=10, rings=7):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat)


def stall_body():
    parts = []
    # The counter front: vertical boards, a dark kick strip and an overhanging top.
    y = -STALL_Y + 0.05
    k = 0
    while y < STALL_Y - 0.06:
        w = 0.118
        parts.append(box("board", 0.56, 0.6, y, min(y + w, STALL_Y - 0.05), 0.08, 0.95, "wood_stall" if k % 3 else "wood_stall2", bev=0.004))
        y += w + 0.006
        k += 1
    parts.append(box("kick", 0.52, 0.59, -STALL_Y + 0.04, STALL_Y - 0.04, 0.0, 0.08, "wood_post"))
    parts.append(box("top", -0.62, 0.68, -STALL_Y - 0.03, STALL_Y + 0.03, 0.95, 1.0, "wood_top", bev=0.008))
    for side in (-1, 1):
        for z0 in (0.05, 0.36, 0.67):
            parts.append(box("side", -0.6, 0.56, side * (STALL_Y - 0.05), side * STALL_Y, z0, z0 + 0.28, "wood_stall2", bev=0.003))
    parts.append(box("back", -0.62, -0.58, -STALL_Y, STALL_Y, 0.0, 0.95, "wood_stall2"))
    # Posts, the back rack with two shelves, and the beam the awning rests on.
    for side in (-1, 1):
        parts.append(box("post", 0.51, 0.59, side * STALL_Y - 0.04, side * STALL_Y + 0.04, 0.0, 2.42, "wood_post", bev=0.006))
        parts.append(box("post", -0.62, -0.54, side * STALL_Y - 0.04, side * STALL_Y + 0.04, 0.0, 2.82, "wood_post", bev=0.006))
        parts.append(tube("brace", [(0.55, side * (STALL_Y - 0.02), 1.95), (1.25, side * (STALL_Y - 0.02), 2.22)], 0.02, "wood_post", verts=6))
    y = -STALL_Y + 0.04
    while y < STALL_Y - 0.05:
        parts.append(box("rack", -0.62, -0.59, y, min(y + 0.24, STALL_Y - 0.04), 1.0, 2.62, "wood_stall"))
        y += 0.245
    for z in (1.45, 1.95):
        parts.append(box("shelf", -0.59, -0.28, -STALL_Y + 0.04, STALL_Y - 0.04, z - 0.03, z, "wood_top", bev=0.004))
        for yy in (-1.0, 0.0, 1.0):
            parts.append(turned_box("bracket", (0.2, 0.02, 0.02), (-0.48, yy, z - 0.1), (0, RAD(35), 0), "wood_post"))
    parts.append(box("beam", 0.5, 0.6, -STALL_Y - 0.05, STALL_Y + 0.05, 2.38, 2.46, "wood_post", bev=0.006))
    # A chalk price board hung from the beam, off to one side of the lamp.
    parts.append(box("price", 0.555, 0.575, 0.35, 1.15, 2.0, 2.3, "chalkboard", bev=0.004))
    parts.append(box("price_frame", 0.548, 0.556, 0.33, 1.17, 1.98, 2.32, "wood_post"))
    for k in range(4):
        parts.append(box("chalk", 0.547, 0.549, 0.42, 0.42 + 0.3 + (k % 2) * 0.25, 2.24 - k * 0.06, 2.255 - k * 0.06, "chalk"))
    for yy in (0.45, 1.05):
        parts.append(cylinder("hook", 0.004, 0.09, (0.565, yy, 2.34), "Z", "dark_steel", verts=6))
    return join(parts, "stall_body")


def awning_strips(torn):
    """The fabric: eight strips from the back rail down to the front edge, alternating the
    stall's colour and cream, sagging between the rafters, with a scalloped valance."""
    random.seed(31 if torn else 5)
    parts = []
    back, front = (-0.66, 2.86), (1.42, 2.24)
    n = 8
    width = 2 * (STALL_Y + 0.25) / n
    for i in range(n):
        y0 = -(STALL_Y + 0.25) + i * width
        mat = "paint_awning" if i % 2 == 0 else "fabric_cream"
        reach = 1.0
        if torn and i in (2, 5):
            reach = 0.45 + random.uniform(0, 0.15)
        steps = 6
        bm = bmesh.new()
        rows = []
        for k in range(steps + 1):
            t = k / steps * reach
            x = back[0] + (front[0] - back[0]) * t
            z = back[1] + (front[1] - back[1]) * t - math.sin(math.pi * t) * 0.05
            rows.append([bm.verts.new((x, y0 + 0.003, z)), bm.verts.new((x, y0 + width - 0.003, z))])
        for r0, r1 in zip(rows, rows[1:]):
            bm.faces.new((r0[0], r0[1], r1[1], r1[0]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        strip = mesh_object("strip", bm, mat)
        mod = strip.modifiers.new("Solid", "SOLIDIFY")
        mod.thickness = 0.012
        apply_modifiers(strip)
        parts.append(strip)
        if reach < 1.0:
            # A ripped strip hangs down from where it tore.
            t = reach
            x = back[0] + (front[0] - back[0]) * t
            z = back[1] + (front[1] - back[1]) * t
            parts.append(turned_box("flap", (0.012, width * 0.8, 0.55), (x + 0.04, y0 + width / 2, z - 0.27), (0, RAD(8), RAD(random.uniform(-10, 10))), mat))
            continue
        # Scallops: two hanging tongues per strip.
        if torn and i in (0, 6):
            continue
        for j in range(2):
            yc = y0 + width * (0.25 + 0.5 * j)
            profile = [(-width * 0.24, 0.0)] + [(math.cos(RAD(a)) * width * 0.24, -math.sin(RAD(a)) * 0.13) for a in range(180, 361, 30)]
            tongue = prism("tongue", [(px, pz) for px, pz in profile], -0.006, 0.006, mat)
            tongue.data.transform(Matrix.Translation((front[0] + 0.01, yc, front[1] - 0.01)) @ Matrix.Rotation(RAD(90), 4, "Z"))
            parts.append(tongue)
    # Rafters and the back rail under the fabric.
    for yy in (-STALL_Y, -0.5, 0.5, STALL_Y):
        droop = -0.25 if torn and yy == 0.5 else 0.0
        parts.append(tube("rafter", [(back[0], yy, back[1] - 0.03), (front[0], yy, front[1] - 0.03 + droop)], 0.018, "wood_post", verts=6))
    parts.append(tube("rail", [(front[0], -STALL_Y - 0.25, front[1] - 0.02), (front[0], STALL_Y + 0.25, front[1] - 0.02)], 0.016, "wood_post", verts=6))
    return parts


def stall_awning():
    return join(awning_strips(False), "stall_awning")


def stall_awning_torn():
    return join(awning_strips(True), "stall_awning_torn")


def stall_wreck():
    """The stall knocked down into a pile about 0.7 m high, spilling forward."""
    random.seed(17)
    parts = []
    parts.append(turned_box("top", (1.3, 3.0, 0.05), (0.05, 0.0, 0.42), (0, RAD(28), RAD(4)), "wood_top", bev=0.006))
    parts.append(turned_box("back", (0.05, 2.9, 0.9), (-0.45, 0.1, 0.3), (0, RAD(-62), RAD(-3)), "wood_stall2"))
    for k in range(16):
        x, y = random.uniform(-0.3, 1.0), random.uniform(-1.5, 1.5)
        parts.append(turned_box("board", (0.12, 0.02 + random.uniform(0, 0.01), random.uniform(0.4, 0.9)), (x, y, 0.08 + random.uniform(0, 0.25)),
                                (RAD(random.uniform(60, 120)), RAD(random.uniform(-30, 30)), RAD(random.uniform(0, 180))), "wood_stall" if k % 2 else "wood_stall2", bev=0.003))
    for k, (x, y, rz, ry) in enumerate([(0.7, -1.3, 20, 75), (0.3, 1.2, -35, 70), (-0.5, -1.4, 5, 40)]):
        parts.append(turned_box("post", (0.08, 0.08, 2.3 if k < 2 else 1.4), (x, y, 0.3), (0, RAD(ry), RAD(rz)), "wood_post", bev=0.006))
    # The awning, fallen across the pile in folds.
    for i in range(8):
        y0 = -1.7 + i * 0.425
        mat = "paint_awning" if i % 2 == 0 else "fabric_cream"
        parts.append(turned_box("fabric", (1.6, 0.42, 0.012), (0.35, y0 + 0.21, 0.55 - abs(i - 3.5) * 0.04), (RAD(random.uniform(-6, 6)), RAD(-14 + random.uniform(-6, 6)), 0), mat))
    for k in range(10):
        x, y = random.uniform(0.6, 1.6), random.uniform(-1.6, 1.6)
        parts.append(sphere("goods", 0.045, (x, y, 0.045), ["fruit_orange", "fruit_red", "fruit_green"][k % 3], segments=8, rings=6))
    for k in range(3):
        parts.append(turned_box("crate", (0.45, 0.35, 0.12), (random.uniform(0.7, 1.3), -1.0 + k, 0.1), (RAD(random.uniform(-25, 25)), RAD(random.uniform(-20, 20)), RAD(random.uniform(0, 90))), "wicker"))
    return join(parts, "stall_wreck")


def crate_of(parts, center, size, fruit, rng):
    cx, cy, cz = center
    w, d = size
    parts.append(box("crate", cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, cz, cz + 0.12, "wicker", bev=0.008))
    r = 0.042
    nx, ny = int(w / (2 * r)), int(d / (2 * r))
    for i in range(nx):
        for j in range(ny):
            x = cx - w / 2 + r + i * 2 * r + rng.uniform(-0.004, 0.004)
            y = cy - d / 2 + r + j * 2 * r + rng.uniform(-0.004, 0.004)
            parts.append(sphere("fruit", r * rng.uniform(0.9, 1.05), (x, y, cz + 0.1 + r * 0.6), rng.choice(fruit), segments=8, rings=6))


def goods_fruit():
    rng = random.Random(3)
    parts = []
    crate_of(parts, (0.18, -0.9, 1.0), (0.48, 0.4), ["fruit_orange"], rng)
    crate_of(parts, (0.18, -0.25, 1.0), (0.48, 0.4), ["fruit_red", "fruit_red", "fruit_green"], rng)
    crate_of(parts, (0.18, 0.4, 1.0), (0.48, 0.4), ["fruit_yellow"], rng)
    for z in (1.45, 1.95):
        for y in (-1.0, -0.2, 0.6):
            parts.append(cylinder("basket", 0.12, 0.12, (-0.44, y, z + 0.06), "Z", "wicker", verts=14))
            for k in range(4):
                parts.append(sphere("fruit", 0.045, (-0.44 + math.cos(k * 1.6) * 0.05, y + math.sin(k * 1.6) * 0.05, z + 0.15), rng.choice(["fruit_orange", "fruit_green", "fruit_red"]), segments=8, rings=6))
    return join(parts, "goods_fruit")


def bowl(name, center, radius, mat):
    return cylinder(name, radius * 0.6, radius * 0.8, (center[0], center[1], center[2] + radius * 0.4), "Z", mat, verts=14, radius2=radius)


def goods_noodles():
    rng = random.Random(9)
    parts = []
    # A stockpot where the steam rises, with its lid propped on the rim.
    parts.append(cylinder("pot", 0.22, 0.3, (0.3, -0.4, 1.15), "Z", "steel", verts=24))
    parts.append(cylinder("broth", 0.205, 0.01, (0.3, -0.4, 1.27), "Z", "sauce_dark", verts=24))
    parts.append(turned_box("lid", (0.44, 0.44, 0.012), (0.12, -0.4, 1.32), (0, RAD(70), 0), "steel"))
    parts.append(tube("ladle", [(0.35, -0.3, 1.2), (0.42, -0.25, 1.45)], 0.008, "steel", verts=6))
    for k in range(5):
        parts.append(bowl("bowl", (0.2, 0.35, 1.0 + k * 0.045), 0.085, "ceramic"))
    for k in range(4):
        parts.append(bowl("bowl", (0.2, 0.6, 1.0 + k * 0.045), 0.085, "ceramic_blue"))
    for k, mat in enumerate(["sauce_red", "sauce_dark", "sauce_red"]):
        parts.append(cylinder("bottle", 0.03, 0.18, (0.38, 0.95 + k * 0.08, 1.09), "Z", mat, verts=10))
        parts.append(cylinder("cap", 0.015, 0.04, (0.38, 0.95 + k * 0.08, 1.2), "Z", "chalk", verts=8))
    for z in (1.45, 1.95):
        for k in range(9):
            parts.append(cylinder("nest", 0.06, 0.06, (-0.44, -1.25 + k * 0.3, z + 0.03), "Z", "noodle", verts=10))
    return join(parts, "goods_noodles")


def goods_grill():
    parts = []
    parts.append(box("trough", 0.0, 0.46, -0.75, 0.75, 1.0, 1.16, "dark_steel", bev=0.01))
    parts.append(box("bed", 0.03, 0.43, -0.72, 0.72, 1.12, 1.14, "coals"))
    rng = random.Random(4)
    for k in range(40):
        parts.append(box("coal", *(lambda x, y: (x - 0.025, x + 0.025, y - 0.025, y + 0.025, 1.13, 1.16))(rng.uniform(0.06, 0.4), rng.uniform(-0.7, 0.7)), "coals"))
    for k in range(9):
        parts.append(cylinder("bar", 0.004, 1.5, (0.04 + k * 0.047, 0, 1.18), "Y", "steel", verts=6))
    for k in range(10):
        y = -0.6 + k * 0.13
        parts.append(cylinder("skewer", 0.003, 0.62, (0.22, y, 1.2), "X", "wood_top", verts=5))
        for j in range(4):
            parts.append(box("meat", 0.06 + j * 0.08, 0.1 + j * 0.08, y - 0.02, y + 0.02, 1.18, 1.22, "meat", bev=0.006))
    for z in (1.45, 1.95):
        for k in range(6):
            parts.append(cylinder("cup", 0.04, 0.11, (-0.42, -1.1 + k * 0.42, z + 0.055), "Z", "ceramic", verts=10))
    parts.append(box("cooler", -0.55, -0.3, 0.6, 1.2, 1.0, 1.35, "ceramic_blue", bev=0.02))
    return join(parts, "goods_grill")


def teapot(parts, center, mat):
    x, y, z = center
    body = sphere("pot", 0.08, (x, y, z + 0.07), mat, segments=12, rings=8)
    body.data.transform(Matrix.Translation((x, y, z + 0.07)) @ Matrix.Diagonal((1, 1, 0.8, 1)) @ Matrix.Translation((-x, -y, -(z + 0.07))))
    parts.append(body)
    parts.append(tube("spout", [(x + 0.06, y, z + 0.05), (x + 0.13, y, z + 0.12)], 0.012, mat, verts=6))
    parts.append(ring("handle", 0.045, 0.008, (x - 0.08, y, z + 0.08), "Y", mat, verts=12))
    parts.append(cylinder("lid", 0.035, 0.02, (x, y, z + 0.14), "Z", mat, verts=10))


def goods_tea():
    parts = []
    parts.append(cylinder("urn", 0.15, 0.4, (0.2, -0.9, 1.2), "Z", "steel", verts=20))
    parts.append(cylinder("urn_lid", 0.155, 0.03, (0.2, -0.9, 1.415), "Z", "dark_steel", verts=20))
    parts.append(cylinder("tap", 0.012, 0.08, (0.36, -0.9, 1.08), "X", "brass", verts=6))
    for k, mat in enumerate(["ceramic", "ceramic_blue", "ceramic"]):
        teapot(parts, (0.25, -0.3 + k * 0.32, 1.0), mat)
    for k in range(8):
        parts.append(cylinder("cup", 0.035, 0.06, (0.4, 0.75 + (k % 4) * 0.09, 1.03 + (k // 4) * 0.062), "Z", "ceramic" if k % 3 else "ceramic_blue", verts=10))
    tins = ["sauce_red", "fruit_green", "hazard", "ceramic_blue"]
    for z in (1.45, 1.95):
        for k in range(10):
            mat = tins[(k + int(z * 10)) % len(tins)]
            parts.append(cylinder("tin", 0.055, 0.15, (-0.44, -1.3 + k * 0.29, z + 0.075), "Z", mat, verts=12))
            parts.append(cylinder("tin_lid", 0.057, 0.02, (-0.44, -1.3 + k * 0.29, z + 0.16), "Z", "brass", verts=12))
    return join(parts, "goods_tea")


def goods_trinkets():
    rng = random.Random(12)
    parts = []
    # Paper lanterns hung along the beam.
    for k, y in enumerate((-1.1, -0.45, 0.2)):
        mat = "paper_red" if k % 2 == 0 else "paper_yellow"
        lantern = sphere("lantern", 0.11, (0.62, y, 2.05), mat, segments=12, rings=8)
        lantern.data.transform(Matrix.Translation((0.62, y, 2.05)) @ Matrix.Diagonal((1, 1, 1.25, 1)) @ Matrix.Translation((-0.62, -y, -2.05)))
        parts.append(lantern)
        parts.append(cylinder("cap", 0.06, 0.03, (0.62, y, 2.2), "Z", "wood_post", verts=10))
        parts.append(cylinder("string", 0.003, 0.2, (0.62, y, 2.3), "Z", "black", verts=4))
    for k in range(9):
        x, y = rng.uniform(0.05, 0.45), -1.3 + k * 0.3
        h = rng.uniform(0.06, 0.16)
        parts.append(box("box", x - 0.07, x + 0.07, y - 0.09, y + 0.09, 1.0, 1.0 + h, rng.choice(["sauce_red", "ceramic_blue", "hazard", "fruit_green", "paper_yellow"]), bev=0.004))
    for z in (1.45, 1.95):
        for k in range(12):
            y = -1.35 + k * 0.245
            mat = rng.choice(["ceramic", "ceramic_blue", "sauce_red", "brass"])
            if k % 2:
                parts.append(cylinder("vase", 0.04, 0.14, (-0.44, y, z + 0.07), "Z", mat, verts=10, radius2=0.025))
            else:
                parts.append(sphere("cat", 0.05, (-0.44, y, z + 0.05), mat, segments=10, rings=7))
    return join(parts, "goods_trinkets")


# ---------------------------------------------------------------------------
# things that burst

def extinguisher():
    parts = [box("plate", -0.07, 0.07, -0.015, 0.0, 0.25, 0.6, "dark_steel")]
    parts.append(box("strap", -0.09, 0.09, -0.19, -0.015, 0.4, 0.43, "dark_steel"))
    parts.append(cylinder("body", 0.075, 0.48, (0, -0.1, 0.26), "Z", "extinguisher_red", verts=20, bev=0.0))
    parts.append(sphere("dome", 0.075, (0, -0.1, 0.5), "extinguisher_red", segments=16, rings=8))
    parts.append(cylinder("label", 0.077, 0.14, (0, -0.1, 0.25), "Z", "chalk", verts=20))
    parts.append(cylinder("neck", 0.025, 0.06, (0, -0.1, 0.59), "Z", "dark_steel", verts=10))
    parts.append(box("head", -0.03, 0.06, -0.13, -0.07, 0.6, 0.66, "dark_steel", bev=0.006))
    parts.append(turned_box("lever", (0.14, 0.02, 0.012), (0.05, -0.1, 0.68), (0, RAD(-12), 0), "steel"))
    parts.append(cylinder("gauge", 0.018, 0.01, (-0.035, -0.135, 0.63), "Y", "gauge_face", verts=10))
    parts.append(tube("hose", [(0.04, -0.1, 0.6), (0.1, -0.12, 0.55), (0.11, -0.13, 0.3), (0.09, -0.14, 0.12), (0.06, -0.14, 0.1)], 0.011, "black", verts=6))
    parts.append(cylinder("nozzle", 0.014, 0.06, (0.05, -0.14, 0.09), "Z", "black", verts=6))
    return join(parts, "extinguisher")


def fuel_drum():
    r, h = 0.3, 0.9
    parts = [cylinder("drum", r, h, (0, 0, h / 2), "Z", "fuel_red", verts=28)]
    for z in (0.3, 0.6):
        parts.append(ring("rib", r + 0.004, 0.012, (0, 0, z), "Z", "fuel_red", verts=28))
    for z in (0.015, h - 0.015):
        parts.append(ring("chime", r - 0.004, 0.014, (0, 0, z), "Z", "dark_steel", verts=28))
    parts.append(cylinder("bung", 0.03, 0.015, (0.17, 0.0, h + 0.005), "Z", "steel", verts=10))
    parts.append(cylinder("vent", 0.02, 0.015, (-0.17, 0.05, h + 0.005), "Z", "steel", verts=10))
    # A hazard label on two sides: yellow with a black band.
    for a in (0, 180):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=r + 0.002, radius2=r + 0.002, depth=0.24)
        for v in list(bm.verts):
            ang = math.degrees(math.atan2(v.co.y, v.co.x))
            if abs(((ang - a + 180) % 360) - 180) > 40:
                bm.verts.remove(v)
        bmesh.ops.translate(bm, vec=Vector((0, 0, 0.45)), verts=bm.verts)
        parts.append(mesh_object("label", bm, "hazard"))
    parts.append(ring("band", r + 0.004, 0.02, (0, 0, 0.45), "Z", "black", verts=28))
    return join(parts, "fuel_drum")

PIECES = [door_glass, door_panel, door_french, door_steel, frame_steel, boards, ac_window, condenser, pipe_seg, pipe_shoe, pipe_head,
          meter_box, vent, steam_run, steam_valve, lambda: steam_end("steam_end_l", 1), lambda: steam_end("steam_end_r", -1),
          escape_platform, escape_stair, escape_ladder, record_bin, record_shelf, turntable,
          stall_body, stall_awning, stall_awning_torn, stall_wreck, goods_noodles, goods_fruit, goods_grill, goods_tea, goods_trinkets, extinguisher, fuel_drum]


def preview(outdir, built, only=None):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.45, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3
    sun.rotation_euler = (RAD(50), RAD(15), RAD(-35))
    wall = box("wall", -12, 12, 0.0, 0.3, -2, 9, None)
    wall.data.materials.append(MATERIALS["card"])
    ground = box("ground", -12, 12, -6, 0.3, -2.02, -2, None)
    ground.data.materials.append(MATERIALS["old_wood"])
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 30
    scene.camera = cam
    # Lay the pieces out along the wall for the pictures, then put them back.
    spots = {
        "door_glass": (-10.8, 0, -2), "door_panel": (-9.6, 0, -2), "door_french": (-8.4, 0, -2), "door_steel": (-6.6, 0, -2), "frame_steel": (-6.11, 0, -2),
        "boards": (-3.6, 0, -0.6), "ac_window": (-1.4, 0, 0.2), "condenser": (0.2, 0, -0.4), "pipe_seg": (1.4, 0, -1.6), "pipe_shoe": (1.4, 0, -2),
        "pipe_head": (1.4, 0, -0.6), "meter_box": (2.4, 0, -0.9), "vent": (2.4, 0, 1.5), "steam_run": (3.4, 0, 0.6), "steam_valve": (4.62, 0, 0.6),
        "steam_end_l": (3.4, 0, 0.6), "steam_end_r": (5.84, 0, 0.6), "escape_platform": (8.5, 0, 2.2), "escape_stair": (8.5, 0, 2.2),
        "escape_ladder": (8.5, 0, 2.2), "record_bin": (4.2, -2.2, -2), "record_shelf": (6.4, -0.0, -2), "turntable": (4.2, -2.2, -1.24),
    }
    extra = []

    def copy(name, location, rotation=0.0):
        obj = built[name].copy()
        obj.data = built[name].data
        link(obj)
        obj.location = location
        obj.rotation_euler = (0, 0, RAD(rotation))
        extra.append(obj)

    copy("steam_run", (4.84, 0, 0.6))
    for name, obj in built.items():
        obj.location = spots.get(name, (0, 0, 0))
    # A row of stalls in front of the wall, counters toward the camera.
    for x, awning, goods in ((-9.5, "stall_awning", "goods_noodles"), (-5.5, "stall_awning_torn", "goods_fruit"), (-1.5, "stall_awning", "goods_grill"),
                             (2.5, "stall_awning", "goods_tea"), (6.5, "stall_awning", "goods_trinkets")):
        for name in ("stall_body", awning, goods):
            copy(name, (x, -3.2, -2), -90)
    copy("stall_wreck", (10.2, -3.2, -2), -90)
    copy("extinguisher", (11.2, 0, -1.1))
    copy("fuel_drum", (11.4, -0.9, -2))
    shots = {"left": ((-7.5, -5.5, 0.4), (-7.5, 0, -0.6)), "middle": ((0.8, -4.6, 0.2), (0.8, 0, -0.4)), "right": ((6.8, -6.5, 1.6), (7.2, 0, 1.0)),
             "steam": ((4.6, -1.8, 0.9), (4.6, 0, 0.6)), "records": ((4.8, -4.4, -0.5), (5.0, -1.0, -1.4)),
             "stalls_a": ((-5.5, -11.5, 0.6), (-5.5, -3, -0.8)), "stalls_b": ((4.5, -11.5, 0.6), (4.5, -3, -0.8)),
             "stall_close": ((-1.5, -6.4, -0.1), (-1.5, -3, -0.9)), "wreck": ((10.2, -7.0, 0.2), (10.6, -2, -1.6))}
    for name, (location, target) in shots.items():
        if only and name not in only:
            continue
        cam.location = location
        cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"kit_{name}.png")
        bpy.ops.render.render(write_still=True)
    for obj in built.values():
        obj.location = (0, 0, 0)
    for obj in [sun, wall, ground, cam] + extra:
        bpy.data.objects.remove(obj)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out")
    parser.add_argument("--preview")
    parser.add_argument("--shots", help="comma-separated preview shots to render")
    args = parser.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    built = {}
    for make in PIECES:
        obj = make()
        smooth(obj)
        built[obj.name] = obj
    tris = 0
    for obj in built.values():
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
        log(f"{obj.name}: {len(obj.data.loop_triangles)} triangles")
    log(len(built), "pieces,", tris, "triangles")
    if args.preview:
        preview(args.preview, built, args.shots.split(",") if args.shots else None)
    if args.out:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.out), export_format="GLB", use_selection=False, export_apply=True, export_yup=True,
                                  export_materials="EXPORT", export_texcoords=False, export_normals=True, export_animations=False, export_lights=False, export_cameras=False, export_extras=False)
        log("wrote", args.out, os.path.getsize(os.path.abspath(args.out)), "bytes")


if __name__ == "__main__":
    main()
