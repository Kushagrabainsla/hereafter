"""Shared Blender modelling helpers for every asset build (scripts/assets, scripts/kit).

Import from a build script run inside Blender 4.4 or newer:

    sys.path.insert(0, os.path.join(<repo>, "scripts", "assets"))
    from lib import *

Everything is modelled in metres, Z up; the glTF exporter turns that into three.js Y up.
Materials are flat Principled BSDF colours (no textures) registered by name in MATERIALS.
Naming rules the game relies on:
  paint_*   pale, tinted per copy by the game (src/world/kit.ts)
  glow_*    lamp glass, neon and lit faces: the game swaps in its own emissive material and a
            dark one when the lamp is shot out (src/world/kit.ts, glowParts)
"""

import math
import os
import random

from dataclasses import dataclass, field
from typing import Callable, Optional

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

RAD = math.radians
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


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


def ring(name, radius, minor, center, axis, mat, verts=32, minor_verts=8):
    pts = arc((0, 0, 0), radius, 0, 360, verts, {"X": "YZ", "Y": "XZ", "Z": "XY"}[axis])
    obj = tube(name, pts, minor, mat, verts=minor_verts, caps=False)
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


def sphere(name, radius, center, mat, segments=10, rings=7):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat)


# ---------------------------------------------------------------------------
# turned shapes, text and wear


def lathe(name, profile, mat, verts=16, ribs=0, rib_depth=0.0, cap_top=False, cap_bottom=False):
    """A surface of revolution about Z from (radius, z) points, bottom to top. With ribs, the
    radius dips between that many ribs by rib_depth of itself, like the bamboo of a lantern."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring_verts = []
        for k in range(verts):
            a = 2 * math.pi * k / verts
            scale = 1 - rib_depth * (1 - math.cos(ribs * a)) / 2 if ribs else 1
            ring_verts.append(bm.verts.new((math.cos(a) * r * scale, math.sin(a) * r * scale, z)))
        rings.append(ring_verts)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(verts):
            bm.faces.new((r0[k], r0[(k + 1) % verts], r1[(k + 1) % verts], r1[k]))
    if cap_bottom and profile[0][0] > 0:
        bm.faces.new(rings[0][::-1])
    if cap_top and profile[-1][0] > 0:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, mat)


FONTS = {}


def font(file="BebasNeue-Regular.ttf"):
    """A font from assets-src/fonts (fetched by scripts/assets/fetch.sh), loaded once."""
    if file not in FONTS:
        path = os.path.join(ROOT, "assets-src", "fonts", file)
        if not os.path.exists(path):
            raise SystemExit(f"Missing font {path}: run scripts/assets/fetch.sh")
        FONTS[file] = bpy.data.fonts.load(path)
    return FONTS[file]


def text_mesh(name, body, size, mat, neon=0.0, extrude=0.0, align="CENTER", spacing=1.0, resolution=3, font_file="BebasNeue-Regular.ttf", tube_sides=6):
    """Text as a mesh in the XZ plane, centred on the origin, reading along +X with its face
    toward -Y (out of a wall in the kit's frame) and its top toward +Z. With neon, a glass tube
    of that radius follows each letter's outline; otherwise the letters are solid, extruded
    by `extrude` toward -Y from y = 0."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = font(font_file)
    cu.size = size
    cu.space_character = spacing
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.resolution_u = resolution
    if neon:
        cu.fill_mode = "NONE"
        cu.bevel_depth = neon
        # 4 sides with no extra resolution, 6 with one step per quarter round, and so on.
        cu.bevel_resolution = max(0, (tube_sides - 4) // 2)
    else:
        cu.extrude = extrude / 2
    obj = link(bpy.data.objects.new(name, cu))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    # The XY plane, facing +Z, turned to the XZ plane facing -Y.
    obj.data.transform(Matrix.Rotation(RAD(90), 4, "X") @ Matrix.Translation((0, 0, 0 if neon else extrude / 2)))
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear()
    obj.data.materials.append(MATERIALS[mat])
    obj.name = name
    return obj


def rounded_rect(width, height, radius, steps=4):
    """Points round a rectangle in the XZ plane with rounded corners, for a neon border."""
    pts = []
    for cx, cz, a0 in ((width / 2 - radius, height / 2 - radius, 0), (-width / 2 + radius, height / 2 - radius, 90),
                       (-width / 2 + radius, -height / 2 + radius, 180), (width / 2 - radius, -height / 2 + radius, 270)):
        pts += arc((cx, 0, cz), radius, a0, a0 + 90, steps, "XZ")
    return pts + [pts[0]]


def jitter(obj, amount, seed=1):
    """Moves every vertex by up to `amount` at random, for crumpled paper or bent metal."""
    rng = random.Random(seed)
    for v in obj.data.vertices:
        v.co += Vector((rng.uniform(-amount, amount), rng.uniform(-amount, amount), rng.uniform(-amount, amount)))
    return obj


def tear(obj, share, seed=1):
    """Deletes about `share` of the faces at random, for torn paper."""
    rng = random.Random(seed)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if rng.random() < share], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def move(obj, offset):
    """Moves an object's mesh by an offset, leaving its origin where it is."""
    obj.data.transform(Matrix.Translation(Vector(offset)))
    return obj


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


@dataclass
class Piece:
    """One asset in a family: its name in the game, how to make it and what it must meet
    (see scripts/assets/build.py)."""
    name: str
    make: Callable[[], object]
    budget: int
    size: Optional[tuple] = None
    origin: Optional[str] = "center"
    notes: str = field(default="")
    # Faces meeting at less than this many degrees shade smooth; round things want more.
    smooth: float = 40
