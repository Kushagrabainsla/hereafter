"""Build public/models/food-truck.glb: the Night Market's food truck, a step van turned kitchen.

Run inside Blender 4.4 or newer, from the repository root:

  blender -b --python scripts/truck/build.py -- --out public/models/food-truck.glb [--preview DIR]

Everything is modelled here at real size, with flat materials (no textures), in the truck's
own frame: the origin on the ground under the middle of the footprint, the cab toward +X,
the serving side toward -Y and up +Z. The glTF exporter turns that into three.js axes, with
the serving side toward +Z (src/world/foodTruck.ts places it).

Nodes the game drives, each with its origin where it moves from:
  hatch                  serving hatch, hinged along its top edge
  door_left, door_right  rear doors, hinged at their outer edges
  wheel_fl ... wheel_rr  wheels, at the axle centre
  propane_a, propane_b   propane cylinders, at their centres
  glass_serving, glass_windshield, glass_cab_left, glass_cab_right   breakable glass
  roof_sign, menu_board  planes the game paints with canvas signs
  interior_light         ceiling panels
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

RAD = math.radians

# Dimensions in metres.
BOX = (-3.1, 1.55)          # kitchen box, along X
CAB = (1.55, 3.1)
HALF_W = 1.2
SKIN = 0.05
FLOOR = 0.44                # floor top; the rear step is half way up
ROOF = 2.95
WINDOW = (-1.6, 0.9, 1.3, 2.3)   # serving window x0, x1, z0, z1
DOOR = (-1.0, 1.0, FLOOR, 2.45)  # rear door opening y0, y1, z0, z1
AXLES = (2.15, -1.55)
WHEEL_R = 0.42


def log(*args):
    print("[truck]", *args, flush=True)


def srgb(hex_value):
    c = [((hex_value >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


MATERIALS = {}


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, alpha=1.0):
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
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    MATERIALS[name] = m
    return m


def make_materials():
    material("paint", 0xf1e6cc, 0.15, 0.38)
    material("teal", 0x1f7a74, 0.2, 0.42)
    material("red", 0xb83a2e, 0.1, 0.45)
    material("chrome", 0xd9dde0, 1.0, 0.12)
    material("steel", 0xb4b9bd, 1.0, 0.32)
    material("dark_steel", 0x3a3f44, 0.8, 0.45)
    material("rubber", 0x161616, 0.0, 0.88)
    material("trim", 0x1c1d1f, 0.2, 0.55)
    material("interior", 0xe9e6df, 0.0, 0.62)
    material("floor_plate", 0x8d9296, 0.9, 0.48)
    material("glass", 0x0d1418, 0.6, 0.04, alpha=0.38)
    material("tinted", 0x050709, 0.6, 0.06)
    material("headlight", 0xf2f0e6, 0.2, 0.1, emit=0xfff2d6, strength=1.5)
    material("tail_light", 0x5a0806, 0.1, 0.2, emit=0xff2a1a, strength=2.2)
    material("amber", 0x7a4a08, 0.1, 0.2, emit=0xffa030, strength=1.0)
    material("ceiling_light", 0xffffff, 0.0, 0.5, emit=0xfff1dc, strength=2.2)
    material("cooktop", 0x121212, 0.6, 0.35)
    material("oil", 0x7a5212, 0.1, 0.08)
    material("bamboo", 0xc9a46a, 0.0, 0.7)
    material("seat", 0x2a2a2c, 0.0, 0.8)
    material("propane", 0xe8e8e2, 0.3, 0.4)
    material("plate", 0xf4f2ea, 0.1, 0.5)
    material("sign", 0xffffff, 0.0, 0.6)
    material("box_red", 0xc0392b, 0.0, 0.6)
    material("box_white", 0xeeeeea, 0.0, 0.6)
    material("box_green", 0x3f7a3a, 0.0, 0.6)


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


def cylinder(name, radius, depth, center, axis, mat, verts=24, bev=0.0, segments=2, radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    rot = {"X": Matrix.Rotation(RAD(90), 4, "Y"), "Y": Matrix.Rotation(RAD(90), 4, "X"), "Z": Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=bm.verts)
    return bevel(mesh_object(name, bm, mat), bev, segments)


def prism(name, profile, y0, y1, mat, bev=0.0, segments=2):
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
    return bevel(mesh_object(name, bm, mat), bev, segments)


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
    return obj


def smooth(obj, angle=40):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=RAD(angle))
    return obj


def set_origin(obj, point):
    """Move an object's origin to a point without moving its geometry."""
    offset = Vector(point) - obj.matrix_world.translation
    obj.data.transform(Matrix.Translation(-offset))
    obj.matrix_world.translation += offset
    return obj


def text(name, body, size, location, rotation, mat, extrude=0.004, align="CENTER"):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.align_x = align
    curve.align_y = "CENTER"
    obj = link(bpy.data.objects.new(name, curve))
    obj.location = location
    obj.rotation_euler = rotation
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    obj.data.materials.clear()
    obj.data.materials.append(MATERIALS[mat])
    return obj


def plane(name, x0, x1, z0, z1, y, facing, mat):
    """A plane in XZ at y, facing -Y or +Y, with UVs over the whole face."""
    bm = bmesh.new()
    corners = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    if facing > 0:
        corners = [(x1, z0), (x0, z0), (x0, z1), (x1, z1)]
    verts = [bm.verts.new((x, y, z)) for x, z in corners]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new("UVMap")
    for loop, (u, v) in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = (u, v)
    return mesh_object(name, bm, mat)


# ---------------------------------------------------------------------------
# parts

def body():
    x0, x1 = BOX
    shell = box("body_shell", x0, x1, -HALF_W, HALF_W, 0.3, ROOF, "paint", bev=0.06, segments=3)
    inner = box("inner", x0 + SKIN, x1 - SKIN, -HALF_W + SKIN, HALF_W - SKIN, FLOOR, ROOF - SKIN, None)
    cut(shell, inner, "interior")
    wx0, wx1, wz0, wz1 = WINDOW
    cut(shell, box("window_cut", wx0, wx1, -HALF_W - 0.2, -HALF_W + 0.2, wz0, wz1, None, bev=0.03), "trim")
    dy0, dy1, dz0, dz1 = DOOR
    cut(shell, box("door_cut", x0 - 0.2, x0 + 0.2, dy0, dy1, dz0, dz1, None), "trim")
    for side in (-1, 1):
        cut(shell, cylinder("arch", 0.5, 0.3, (AXLES[1], side * HALF_W, WHEEL_R), "Y", None, verts=32), "trim")
    parts = [shell]
    # Wheel wells inside, under the counters.
    for side in (-1, 1):
        parts.append(box("well", AXLES[1] - 0.52, AXLES[1] + 0.52, side * 0.85, side * (HALF_W - SKIN), FLOOR, 0.98, "interior", bev=0.08))
    # Livery: a teal band and a chrome rub rail, a little proud of the skin.
    for side in (-1, 1):
        parts.append(box("band", x0 + 0.04, x1 - 0.02, side * (HALF_W - 0.001), side * (HALF_W + 0.003), 1.0, 1.22, "teal"))
        parts.append(box("rail", x0 + 0.04, x1 - 0.02, side * (HALF_W - 0.006), side * (HALF_W + 0.008), 0.66, 0.7, "chrome", bev=0.004))
    # Roof drip rail.
    for side in (-1, 1):
        parts.append(box("drip", x0 + 0.02, x1, side * (HALF_W - 0.01) - 0.012, side * (HALF_W - 0.01) + 0.012, ROOF - 0.02, ROOF + 0.015, "trim", bev=0.006))
    return join(parts, "body")


def cab():
    x0, x1 = CAB
    outline = [(x0, 0.3), (3.0, 0.3), (3.08, 0.45), (3.1, 1.35), (2.98, 1.5), (2.72, 2.8), (2.55, ROOF), (x0, ROOF)]
    shell = prism("cab", outline, -HALF_W + 0.02, HALF_W - 0.02, "paint", bev=0.07, segments=3)
    hollow = [(x0 - 0.1, 0.62), (2.9, 0.62), (2.92, 1.35), (2.86, 1.45), (2.64, 2.75), (2.5, ROOF - 0.06), (x0 - 0.1, ROOF - 0.06)]
    cut(shell, prism("cab_hollow", hollow, -HALF_W + 0.07, HALF_W - 0.07, None), "interior")
    # Windscreen: an opening in the raked face.
    a, b = Vector((2.98, 1.5)), Vector((2.72, 2.8))
    mid = (a + b) / 2
    angle = math.atan2(a.x - b.x, b.y - a.y)
    screen = box("screen_cut", -0.15, 0.15, -HALF_W + 0.12, HALF_W - 0.12, -0.58, 0.58, None, bev=0.05)
    screen.matrix_world = Matrix.Translation((mid.x, 0, mid.y)) @ Matrix.Rotation(-angle, 4, "Y")
    cut(shell, screen, "trim")
    # Side windows in the cab doors, and the seam around each door.
    for side in (-1, 1):
        cut(shell, box("side_cut", 1.72, 2.52, side * HALF_W - 0.15, side * HALF_W + 0.15, 1.62, 2.55, None, bev=0.03), "trim")
        surface = side * (HALF_W - 0.02)
        ring = box("seam", 1.62, 2.64, surface - side * 0.006, surface + side * 0.06, 0.52, 2.66, None)
        cut(ring, box("seam_inside", 1.632, 2.628, surface - side * 0.1, surface + side * 0.1, 0.532, 2.648, None))
        cut(shell, ring, "trim")
    cut(shell, cylinder("front_arch_l", 0.5, 0.3, (AXLES[0], HALF_W, WHEEL_R), "Y", None, verts=32), "trim")
    cut(shell, cylinder("front_arch_r", 0.5, 0.3, (AXLES[0], -HALF_W, WHEEL_R), "Y", None, verts=32), "trim")
    parts = [shell]
    # Front: grille, headlights, bumper, plate, indicators.
    parts.append(box("grille", 3.06, 3.115, -0.6, 0.6, 0.62, 1.22, "trim", bev=0.02))
    for k in range(6):
        z = 0.68 + k * 0.09
        parts.append(box("slat", 3.1, 3.125, -0.56, 0.56, z, z + 0.03, "chrome", bev=0.006))
    for side in (-1, 1):
        parts.append(cylinder("bezel", 0.13, 0.06, (3.09, side * 0.86, 0.95), "X", "chrome", verts=28, bev=0.012))
        parts.append(cylinder("lamp", 0.1, 0.02, (3.125, side * 0.86, 0.95), "X", "headlight", verts=28))
        parts.append(box("indicator", 3.08, 3.11, side * 0.86 - 0.08, side * 0.86 + 0.08, 0.72, 0.8, "amber", bev=0.01))
    parts.append(box("bumper", 3.02, 3.22, -HALF_W + 0.04, HALF_W - 0.04, 0.32, 0.55, "chrome", bev=0.04, segments=3))
    parts.append(box("front_plate", 3.22, 3.235, -0.17, 0.17, 0.36, 0.5, "plate", bev=0.005))
    # Mirrors on arms.
    for side in (-1, 1):
        parts.append(box("mirror_arm", 2.55, 2.6, side * HALF_W, side * (HALF_W + 0.22), 2.18, 2.22, "dark_steel", bev=0.01))
        parts.append(box("mirror", 2.5, 2.62, side * (HALF_W + 0.18), side * (HALF_W + 0.34), 1.95, 2.4, "trim", bev=0.03))
    # Inside: seats, dashboard and a steering wheel, seen through the glass.
    parts.append(box("dash", 2.55, 2.92, -1.08, 1.08, 1.25, 1.52, "trim", bev=0.06))
    for side in (-1, 1):
        parts.append(box("seat", 1.75, 2.15, side * 0.62 - 0.26, side * 0.62 + 0.26, 0.62, 1.2, "seat", bev=0.08, segments=3))
        parts.append(box("seat_back", 1.62, 1.78, side * 0.62 - 0.26, side * 0.62 + 0.26, 1.15, 1.95, "seat", bev=0.06, segments=3))
    wheel = cylinder("steering", 0.2, 0.04, (2.45, 0.62, 1.6), "X", "trim", verts=28, bev=0.015)
    wheel.data.transform(Matrix.Translation((2.45, 0.62, 1.6)) @ Matrix.Rotation(RAD(-35), 4, "Y") @ Matrix.Translation((-2.45, -0.62, -1.6)))
    parts.append(wheel)
    return join(parts, "cab")


def glass():
    out = []
    wx0, wx1, wz0, wz1 = WINDOW
    # Sliding serving window: the right pane closed, the left one slid open behind it.
    out.append(join([
        box("pane", -0.35, wx1, -HALF_W + 0.012, -HALF_W + 0.022, wz0, wz1, "glass"),
        box("pane", -0.4, wx1 - 0.05, -HALF_W + 0.03, -HALF_W + 0.04, wz0, wz1, "glass"),
        box("pane_frame", -0.37, -0.33, -HALF_W + 0.008, -HALF_W + 0.026, wz0, wz1, "trim"),
    ], "glass_serving"))
    a, b = Vector((2.98, 1.5)), Vector((2.72, 2.8))
    mid = (a + b) / 2
    angle = math.atan2(a.x - b.x, b.y - a.y)
    screen = box("glass_windshield", -0.012, 0.012, -HALF_W + 0.13, HALF_W - 0.13, -0.57, 0.57, "glass")
    screen.data.transform(Matrix.Translation((mid.x - 0.04, 0, mid.y)) @ Matrix.Rotation(-angle, 4, "Y"))
    out.append(screen)
    for side, name in ((1, "glass_cab_left"), (-1, "glass_cab_right")):
        out.append(box(name, 1.72, 2.52, side * (HALF_W - 0.06) - 0.006, side * (HALF_W - 0.06) + 0.006, 1.62, 2.55, "glass"))
    return out


def hatch():
    wx0, wx1, wz0, wz1 = WINDOW
    y = -HALF_W
    flap = box("hatch_panel", wx0 - 0.05, wx1 + 0.05, y - 0.04, y, wz0 - 0.1, wz1 + 0.08, "paint", bev=0.02)
    edge = box("hatch_edge", wx0 - 0.05, wx1 + 0.05, y - 0.046, y - 0.036, wz0 - 0.1, wz0 - 0.02, "teal")
    word = text("closed", "CLOSED", 0.34, (-0.35, y - 0.042, 1.86), (RAD(90), 0, 0), "red")
    sub = text("hours", "OPEN 5 PM - 2 AM", 0.11, (-0.35, y - 0.042, 1.58), (RAD(90), 0, 0), "trim")
    obj = join([flap, edge, word, sub], "hatch")
    return set_origin(obj, (-0.35, y, wz1 + 0.08))


def rear_doors():
    x0 = BOX[0]
    dy0, dy1, dz0, dz1 = DOOR
    doors = []
    for name, ya, yb, hinge in (("door_left", 0.0, dy1, dy1), ("door_right", dy0, 0.0, dy0)):
        panel = box(name + "_panel", x0 - 0.03, x0 + 0.02, ya + 0.005, yb - 0.005, dz0 + 0.005, dz1 - 0.005, "paint", bev=0.015)
        cut(panel, box("door_window", x0 - 0.1, x0 + 0.1, ya + 0.14, yb - 0.14, 1.62, 2.28, None, bev=0.02), "trim")
        pane = box("door_pane", x0 - 0.012, x0 + 0.004, ya + 0.14, yb - 0.14, 1.62, 2.28, "tinted")
        handle_y = yb - 0.12 if hinge == dy0 else ya + 0.12
        handle = box("handle", x0 - 0.06, x0 - 0.03, handle_y - 0.02, handle_y + 0.02, 1.15, 1.45, "chrome", bev=0.01)
        stripe = box("door_band", x0 - 0.033, x0 - 0.029, ya + 0.01, yb - 0.01, 1.0, 1.22, "teal")
        hinge_parts = [box("hinge", x0 - 0.05, x0 - 0.02, hinge - 0.03, hinge + 0.03, z - 0.06, z + 0.06, "dark_steel", bev=0.008) for z in (0.75, 1.5, 2.2)]
        door = join([panel, pane, handle, stripe] + hinge_parts, name)
        doors.append(set_origin(door, (x0, hinge, (dz0 + dz1) / 2)))
    return doors


def rear():
    x0 = BOX[0]
    parts = [
        # The bumper is the step up to the doors: half way between the ground and the floor.
        box("rear_bumper", x0 - 0.22, x0 + 0.02, -HALF_W + 0.02, HALF_W - 0.02, 0.1, 0.216, "dark_steel", bev=0.015),
        box("rear_step", x0 - 0.22, x0, -0.7, 0.7, 0.214, 0.22, "floor_plate", bev=0.003),
        box("rear_plate", x0 - 0.01, x0 + 0.005, -0.16, 0.16, 0.28, 0.4, "plate", bev=0.004),
    ]
    for side in (-1, 1):
        parts.append(box("tail", x0 - 0.02, x0 + 0.01, side * 1.1 - 0.06, side * 1.1 + 0.06, 0.62, 0.92, "tail_light", bev=0.01))
        parts.append(box("tail_amber", x0 - 0.02, x0 + 0.01, side * 1.1 - 0.06, side * 1.1 + 0.06, 0.94, 1.04, "amber", bev=0.01))
        parts.append(box("gutter", x0 - 0.03, x0 + 0.01, side * 1.06 - 0.015, side * 1.06 + 0.015, 0.44, 2.6, "trim"))
    return join(parts, "rear")


def wheels():
    out = []
    for name, x, side in (("wheel_fl", AXLES[0], 1), ("wheel_fr", AXLES[0], -1), ("wheel_rl", AXLES[1], 1), ("wheel_rr", AXLES[1], -1)):
        y = side * (HALF_W - 0.17)
        tyre = cylinder(name + "_tyre", WHEEL_R, 0.28, (x, y, WHEEL_R), "Y", "rubber", verts=36, bev=0.07, segments=4)
        rim = cylinder(name + "_rim", 0.25, 0.29, (x, y, WHEEL_R), "Y", "steel", verts=36, bev=0.02)
        cap = cylinder(name + "_cap", 0.11, 0.31, (x, y, WHEEL_R), "Y", "chrome", verts=24, bev=0.02)
        nuts = [cylinder("nut", 0.018, 0.32, (x + 0.16 * math.cos(a), y, WHEEL_R + 0.16 * math.sin(a)), "Y", "chrome", verts=8) for a in [k * math.tau / 6 for k in range(6)]]
        wheel = join([tyre, rim, cap] + nuts, name)
        out.append(set_origin(wheel, (x, y, WHEEL_R)))
    return out


def chassis():
    parts = [box("rail", -3.0, 3.0, side * 0.55 - 0.06, side * 0.55 + 0.06, 0.16, 0.3, "trim") for side in (-1, 1)]
    parts.append(cylinder("fuel", 0.13, 1.1, (-0.2, 0.78, 0.18), "X", "dark_steel", verts=20, bev=0.03))
    parts.append(cylinder("exhaust", 0.04, 2.6, (0.3, -0.75, 0.16), "X", "dark_steel", verts=12))
    parts.append(box("axle_f", AXLES[0] - 0.06, AXLES[0] + 0.06, -0.95, 0.95, WHEEL_R - 0.05, WHEEL_R + 0.05, "trim"))
    parts.append(box("axle_r", AXLES[1] - 0.06, AXLES[1] + 0.06, -0.95, 0.95, WHEEL_R - 0.05, WHEEL_R + 0.05, "trim"))
    return join(parts, "chassis")


def roof():
    parts = [
        box("fan_base", -1.6, -1.0, 0.3, 0.9, ROOF, ROOF + 0.24, "steel", bev=0.02),
        cylinder("fan_cap", 0.34, 0.12, (-1.3, 0.6, ROOF + 0.32), "Z", "steel", verts=28, bev=0.03, radius2=0.2),
        box("ac", 0.15, 1.15, -0.45, 0.45, ROOF, ROOF + 0.24, "box_white", bev=0.04),
    ]
    for k in range(7):
        x = 0.25 + k * 0.12
        parts.append(box("ac_grille", x, x + 0.04, -0.4, 0.4, ROOF + 0.24, ROOF + 0.25, "trim"))
    # Sign board on posts, its face toward the market.
    for x in (-2.4, -0.5):
        parts.append(box("post", x - 0.03, x + 0.03, -0.86, -0.8, ROOF, ROOF + 0.15, "dark_steel"))
    parts.append(box("sign_back", -2.75, -0.15, -0.86, -0.78, ROOF + 0.12, ROOF + 0.7, "trim", bev=0.02))
    return join(parts, "roof")


def signs():
    board = plane("roof_sign", -2.7, -0.2, ROOF + 0.15, ROOF + 0.67, -0.865, -1, "sign")
    menu = plane("menu_board", 0.97, 1.47, 1.32, 2.42, -HALF_W - 0.006, -1, "sign")
    lettering = [
        text("brand", "BAO & BUNS", 0.42, (-1.35, HALF_W + 0.004, 1.92), (RAD(90), 0, RAD(180)), "red"),
        text("tag", "STEAMED · FRIED · SOFA", 0.13, (-1.35, HALF_W + 0.004, 1.55), (RAD(90), 0, RAD(180)), "teal"),
        text("brand_front", "BAO & BUNS", 0.22, (-2.35, -HALF_W - 0.004, 1.78), (RAD(90), 0, 0), "red"),
    ]
    return [board, menu, join(lettering, "lettering")]


def interior():
    wx0, wx1, _, _ = WINDOW
    y_in = HALF_W - SKIN
    parts = [box("floor_plate", BOX[0] + SKIN, BOX[1] - SKIN, -y_in, y_in, FLOOR, FLOOR + 0.004, "floor_plate")]
    # Serving counter under the window.
    parts.append(box("counter", wx0 - 0.1, wx1 + 0.05, -y_in, -0.6, FLOOR, 1.24, "steel", bev=0.01))
    parts.append(box("counter_top", wx0 - 0.12, wx1 + 0.07, -y_in, -0.58, 1.24, 1.28, "steel", bev=0.008))
    for k in range(4):
        x = wx0 + 0.1 + k * 0.62
        parts.append(box("cabinet_door", x, x + 0.56, -0.6, -0.592, FLOOR + 0.1, 1.15, "steel", bev=0.004))
    # The kitchen line along the far wall: griddle, fryer, steamers and a sink.
    parts.append(box("griddle_base", -2.4, -1.4, 0.55, y_in, FLOOR, 1.0, "dark_steel", bev=0.01))
    parts.append(box("griddle_top", -2.42, -1.38, 0.53, y_in, 1.0, 1.05, "cooktop", bev=0.01))
    parts.append(box("fryer", -1.4, -0.8, 0.55, y_in, FLOOR, 1.05, "steel", bev=0.01))
    for k in range(2):
        x = -1.36 + k * 0.28
        parts.append(box("oil", x, x + 0.24, 0.62, 1.05, 1.0, 1.03, "oil"))
        parts.append(box("basket", x + 0.02, x + 0.22, 0.6, 0.9, 1.08, 1.2, "chrome"))
    parts.append(box("prep", -0.8, 0.9, 0.55, y_in, FLOOR, 0.92, "steel", bev=0.01))
    parts.append(box("prep_top", -0.82, 0.92, 0.53, y_in, 0.92, 0.95, "steel", bev=0.006))
    for k, x in enumerate((-0.55, -0.15)):
        for tier in range(3 - k):
            parts.append(cylinder("steamer", 0.17, 0.09, (x, 0.85, 0.99 + tier * 0.095), "Z", "bamboo", verts=24, bev=0.012))
    parts.append(cylinder("faucet", 0.015, 0.3, (0.6, 1.05, 1.1), "Z", "chrome", verts=8))
    parts.append(box("backsplash", -2.45, 0.9, y_in - 0.01, y_in, 0.95, 1.4, "steel"))
    # Fridge by the cab, a hood over the line and a shelf of supplies over the window.
    parts.append(box("fridge", 0.92, BOX[1] - SKIN, 0.5, y_in, FLOOR, 2.6, "steel", bev=0.02))
    parts.append(box("fridge_handle", 0.95, 0.98, 0.45, 0.48, 1.5, 2.3, "chrome", bev=0.006))
    hood = prism("hood", [(-2.5, 2.85), (0.3, 2.85), (0.3, 2.25), (-2.5, 2.25)], 0.5, y_in, "steel", bev=0.01)
    parts.append(hood)
    parts.append(box("shelf", BOX[0] + 0.1, wx1, -y_in, -0.88, 2.42, 2.45, "steel"))
    import random
    rng = random.Random(7)
    x = BOX[0] + 0.15
    while x < wx1 - 0.2:
        w = rng.uniform(0.12, 0.26)
        h = rng.uniform(0.12, 0.3)
        parts.append(box("supply", x, x + w, -y_in + 0.02, -0.92, 2.45, 2.45 + h, rng.choice(["box_red", "box_white", "box_green", "bamboo"]), bev=0.01))
        x += w + rng.uniform(0.02, 0.08)
    # A rack of stock by the rear doors.
    parts.append(box("rack", BOX[0] + SKIN, BOX[0] + 0.5, -y_in, -0.62, FLOOR, 2.0, "dark_steel", bev=0.01))
    for z in (0.9, 1.4, 1.9):
        parts.append(box("stock", BOX[0] + 0.1, BOX[0] + 0.45, -y_in + 0.04, -0.66, z - 0.36, z - 0.06, rng.choice(["box_red", "box_white", "box_green"]), bev=0.01))
    lights = join([box("panel", x0, x1, -0.22, 0.22, ROOF - SKIN - 0.03, ROOF - SKIN, "ceiling_light", bev=0.005) for x0, x1 in ((-2.6, -1.1), (-0.8, 0.8))], "interior_light")
    return [join(parts, "interior"), lights]


def propane():
    out = []
    parts = []
    for name, x in (("propane_a", -2.8), ("propane_b", -2.48)):
        body = cylinder(name + "_body", 0.15, 0.5, (x, 1.36, 0.7), "Z", "propane", verts=28, bev=0.06, segments=4)
        collar = cylinder(name + "_collar", 0.09, 0.1, (x, 1.36, 1.0), "Z", "propane", verts=20, bev=0.01)
        valve = cylinder(name + "_valve", 0.025, 0.08, (x, 1.36, 1.07), "Z", "chrome", verts=10)
        foot = cylinder(name + "_foot", 0.13, 0.06, (x, 1.36, 0.42), "Z", "propane", verts=24)
        tank = join([body, collar, valve, foot], name)
        out.append(set_origin(tank, (x, 1.36, 0.71)))
    # The cage that holds them against the body, and the hose into the kitchen.
    for x in (-2.98, -2.3):
        for y in (1.2, 1.53):
            parts.append(box("cage_post", x - 0.015, x + 0.015, y - 0.015, y + 0.015, 0.36, 1.08, "trim"))
    for z in (0.38, 0.8, 1.06):
        parts.append(box("cage_rail", -2.98, -2.3, 1.515, 1.545, z - 0.015, z + 0.015, "trim"))
        parts.append(box("cage_end", -2.995, -2.965, 1.2, 1.53, z - 0.015, z + 0.015, "trim"))
        parts.append(box("cage_end", -2.315, -2.285, 1.2, 1.53, z - 0.015, z + 0.015, "trim"))
    parts.append(box("cage_floor", -2.98, -2.3, 1.2, 1.53, 0.34, 0.37, "dark_steel"))
    parts.append(cylinder("hose", 0.012, 0.5, (-2.64, 1.26, 1.1), "X", "rubber", verts=8))
    out.append(join(parts, "propane_cage"))
    return out


# ---------------------------------------------------------------------------

def preview(outdir):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.45, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3
    sun.rotation_euler = (RAD(50), RAD(15), RAD(35))
    ground = box("ground", -10, 10, -10, 10, -0.02, 0, None)
    ground.data.materials.append(MATERIALS["trim"])
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 28
    scene.camera = cam
    shots = {"front": (7.5, -4.8, 2.0), "serving": (-0.3, -7.5, 1.7), "rear": (-8.0, 2.8, 2.0), "back": (-0.5, 7.5, 2.4), "inside": (-2.85, -0.1, 1.95), "inside_window": (-0.3, 0.45, 1.95), "top": (0.0, -5.0, 8.0)}
    targets = {"inside": (1.2, 0.1, 1.2), "inside_window": (-0.3, -1.6, 1.6), "top": (0.0, 0.0, 1.5)}
    for name, location in shots.items():
        cam.location = location
        target = Vector(targets.get(name, (0.0, 0.0, 1.3)))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"truck_{name}.png")
        bpy.ops.render.render(write_still=True)
    for obj in (sun, ground, cam):
        bpy.data.objects.remove(obj)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out")
    parser.add_argument("--preview")
    args = parser.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    for build in (body, cab, rear, chassis, roof, hatch, propane, glass, rear_doors, wheels, signs, interior):
        build()
        log("built", build.__name__)
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in objects:
        smooth(obj)
    tris = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
    log(len(objects), "objects,", tris, "triangles")
    if args.preview:
        preview(args.preview)
    if args.out:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.out), export_format="GLB", use_selection=False, export_apply=True, export_yup=True,
                                  export_materials="EXPORT", export_texcoords=True, export_normals=True, export_animations=False, export_lights=False, export_cameras=False, export_extras=False)
        log("wrote", args.out, os.path.getsize(os.path.abspath(args.out)), "bytes")


if __name__ == "__main__":
    main()
