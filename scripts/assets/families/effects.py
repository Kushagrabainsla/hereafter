"""Effects: the debris that flies off what is shot or blown up, bullet holes and the markers
over pickups. Built into public/models/effects.glb by scripts/assets/build.py.

The debris pieces fit a 1 m box centred on the origin, and the game scales each copy to the
particle's size (stretching splinters and sparks along their length), colouring it per copy:
  debris_chip      a jagged flake of stone, plaster, soil or flesh
  debris_splinter  a sliver of wood, pointed at both ends, along Z (the game's Y)
  debris_shard     a flat broken piece of glass
  debris_leaf      a leaf, folded along its midrib
  debris_spark     a glowing streak along Z (glow_spark: the game draws it unlit)
bullet_hole faces -Y and is 1 m across; the game scales it to the hole and tints its rim. Its
crater runs 6 cm toward +Y, into the surface it is set on. marker_ring lies flat, 1 m in
radius; marker_beam rises 1.7 m from z = 0. Their glow_* faces take the game's own glowing
materials.
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import Piece, hull, join, material, mesh_object, prism, ring


def materials():
    material("fx_debris", 0xffffff, 0.0, 0.85)
    material("glow_spark", 0xffffff, 0.0, 0.5)
    material("fx_hole_core", 0x0b0a09, 0.0, 1.0)
    material("fx_hole_burn", 0x2b2723, 0.0, 1.0)
    material("fx_hole_rim", 0x6c665e, 0.0, 1.0)
    material("glow_marker", 0x59d3d0, 0.35, 0.34)
    material("glow_beam", 0x5bd8d6, 0.0, 0.5)


def debris_chip():
    """A jagged flake: an icosahedron pulled about and flattened."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    rng = random.Random(3)
    for v in bm.verts:
        v.co *= rng.uniform(0.7, 1.15)
        v.co.z *= 0.62
    return mesh_object("debris_chip", bm, "fx_debris")


def debris_splinter():
    """A sliver of wood, ragged along its length and pointed at both ends."""
    rng = random.Random(5)
    points = [(0.0, 0.0, -0.5), (rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0.5)]
    for z in (-0.3, 0.0, 0.3):
        for k in range(4):
            a = 2 * math.pi * k / 4 + rng.uniform(-0.3, 0.3)
            r = rng.uniform(0.22, 0.35)
            points.append((math.cos(a) * r, math.sin(a) * r * 0.6, z))
    return hull("debris_splinter", points, "fx_debris")


def debris_shard():
    """A broken piece of glass: a flat, jagged outline, thin."""
    outline = [(-0.42, -0.5), (0.18, -0.38), (0.5, 0.06), (0.12, 0.5), (-0.2, 0.12), (-0.46, 0.2)]
    return prism("debris_shard", outline, -0.04, 0.04, "fx_debris")


def debris_leaf():
    """A leaf, pointed at the tip, folded along its midrib."""
    outline = [(0.0, -0.5)]
    for k in range(1, 6):
        t = k / 6
        outline.append((0.28 * math.sin(math.pi * t) ** 0.8, -0.5 + t))
    outline.append((0.0, 0.5))
    outline += [(-x, z) for x, z in reversed(outline[1:-1])]
    leaf = prism("debris_leaf", outline, -0.015, 0.015, "fx_debris")
    for v in leaf.data.vertices:
        v.co.y += abs(v.co.x) * 0.5
    leaf.data.transform(Matrix.Translation((0, -0.07, 0)))
    return leaf


def debris_spark():
    """A glowing streak: a long double point."""
    return hull("debris_spark", [(0, 0, -0.5), (0, 0, 0.5), (0.25, 0, 0), (-0.25, 0, 0), (0, 0.25, 0), (0, -0.25, 0)], "glow_spark")


def bullet_hole():
    """A bullet hole: a dark crater sunk into the surface, a scorched ring and a jagged rim of
    spalled material, laid edge to edge so nothing overlaps."""
    rng = random.Random(9)
    n = 10
    core = [(math.cos(a) * r, math.sin(a) * r) for a, r in ((2 * math.pi * k / n, rng.uniform(0.11, 0.15)) for k in range(n))]
    burn = [(x / math.hypot(x, z) * rng.uniform(0.2, 0.24), z / math.hypot(x, z) * rng.uniform(0.2, 0.24)) for x, z in core]
    bm = bmesh.new()
    deep = bm.verts.new((0.0, 0.06, 0.0))
    inner = [bm.verts.new((x, 0.0, z)) for x, z in core]
    for k in range(n):
        bm.faces.new((deep, inner[k], inner[(k + 1) % n]))
    crater = mesh_object("crater", bm, "fx_hole_core")
    # Its faces must look out of the surface, toward -Y.
    if sum(p.normal.y for p in crater.data.polygons) > 0:
        crater.data.flip_normals()

    def band(name, a, b, mat):
        bm = bmesh.new()
        va = [bm.verts.new((x, 0.0, z)) for x, z in a]
        vb = [bm.verts.new((x, 0.0, z)) for x, z in b]
        for k in range(len(a)):
            bm.faces.new((va[k], va[(k + 1) % len(a)], vb[(k + 1) % len(b)], vb[k]))
        for f in bm.faces:
            f.normal_update()
            if f.normal.y > 0:
                f.normal_flip()
        return mesh_object(name, bm, mat)

    # The rim: spikes of spalled material between the scorch and the edge.
    rim = []
    for x, z in burn:
        d = math.hypot(x, z)
        rim.append((x / d * rng.uniform(0.3, 0.5), z / d * rng.uniform(0.3, 0.5)))
    return join([crater, band("burn", core, burn, "fx_hole_burn"), band("rim", burn, rim, "fx_hole_rim")], "bullet_hole")


def marker_ring():
    """The ring round a pickup lying on the floor: a thin glowing hoop with four chevrons
    pointing in."""
    parts = [ring("hoop", 1.0, 0.04, (0, 0, 0), "Z", "glow_marker", verts=40, minor_verts=4)]
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        chevron = prism("chevron", [(-0.07, 0.0), (0.07, 0.0), (0.0, -0.12)], -0.012, 0.012, "glow_marker")
        # Drawn upright in XZ; lay it flat, point inward, out at the ring.
        chevron.data.transform(Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0.9, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
        parts.append(chevron)
    return join(parts, "marker_ring")


def marker_beam():
    """The column of light over a gun pickup: an open cone, wide at the foot."""
    bm = bmesh.new()
    verts = 16
    rings = [[bm.verts.new((math.cos(2 * math.pi * k / verts) * r, math.sin(2 * math.pi * k / verts) * r, z)) for k in range(verts)] for r, z in ((0.38, 0.0), (0.31, 0.85), (0.24, 1.7))]
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(verts):
            bm.faces.new((r0[k], r0[(k + 1) % verts], r1[(k + 1) % verts], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object("marker_beam", bm, "glow_beam")


PIECES = [
    Piece("debris_chip", debris_chip, 40, None, None, "Chips of stone, plaster, soil and flesh."),
    Piece("debris_splinter", debris_splinter, 40, None, None, "Wood splinters, stretched along Y."),
    Piece("debris_shard", debris_shard, 20, None, None, "Glass shards."),
    Piece("debris_leaf", debris_leaf, 50, None, None, "Leaves shaken off plants."),
    Piece("debris_spark", debris_spark, 12, None, None, "Sparks and embers, drawn unlit and stretched."),
    Piece("bullet_hole", bullet_hole, 60, None, None, "Every bullet hole and blast scorch, scaled and tinted."),
    Piece("marker_ring", marker_ring, 400, (2.08, 2.08, 0.08), "center", "Round loose magazines and dropped guns."),
    Piece("marker_beam", marker_beam, 64, (0.76, 0.76, 1.7), "base", "Over gun pickups.", 60),
]
