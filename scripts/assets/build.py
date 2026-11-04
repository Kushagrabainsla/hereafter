"""Build one family of game assets into public/models/<family>.glb, checked against budgets.

Run inside Blender 4.4 or newer, from anywhere:

  blender -b --python-exit-code 1 --python scripts/assets/build.py -- --family lights [--only lantern,bulb] [--preview DIR] [--no-export]

or for every family: npm run build:assets (scripts/assets/build.sh). See docs/asset-pipeline.md.

A family is a module in scripts/assets/families/ that defines:
  materials()   registers the family's materials with lib.material
  PIECES        a list of Piece(name, make, budget, size, origin): make() returns one object,
                which the driver renames to the piece's name

Every piece is checked before export, and the build fails if any check fails:
  budget   its triangles, at most this many
  size     its bounding box (x, y, z) in metres, each within 10% or 2 cm of this, if given
  smooth   the angle in degrees under which faces shade smooth (40 unless given)
  origin   where its origin sits: "base" (on the floor: lowest point at z = 0), "top" (hangs
           from z = 0), "center" (box centre at the origin), "wall" (backs onto y = 0, built
           toward -Y), or None to skip
  materials every material it uses must be registered; names are unique across families
The report, with each piece's triangles, size and materials, goes to scripts/assets/reports.
"""

import argparse
import importlib
import json
import os
import sys
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "families"))
import lib  # noqa: E402


def log(*args):
    print("[assets]", *args, flush=True)


def bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def check(piece, obj):
    """The problems with a built piece, as sentences; empty if it passes."""
    problems = []
    tris = lib.triangles(obj)
    if tris > piece.budget:
        problems.append(f"{tris} triangles, over its budget of {piece.budget}")
    lo, hi = bounds(obj)
    size = hi - lo
    if piece.size:
        for axis, want, got in zip("xyz", piece.size, size):
            if abs(got - want) > max(0.02, want * 0.1):
                problems.append(f"{got:.3f} m along {axis}, not {want:.3f}")
    tol = 0.012
    centre = (lo + hi) / 2
    if piece.origin == "base" and abs(lo.z) > tol:
        problems.append(f"lowest point at z = {lo.z:.3f}, not on the floor")
    elif piece.origin == "top" and abs(hi.z) > tol:
        problems.append(f"highest point at z = {hi.z:.3f}, not hanging from the origin")
    elif piece.origin == "center" and centre.length > 0.02:
        problems.append(f"centre at {tuple(round(c, 3) for c in centre)}, not the origin")
    elif piece.origin == "wall" and abs(hi.y) > tol:
        problems.append(f"back at y = {hi.y:.3f}, not against the wall at y = 0")
    for slot in obj.material_slots:
        if slot.material is None or slot.material.name not in lib.MATERIALS:
            problems.append(f"unregistered material {slot.material.name if slot.material else None}")
    return problems, tris, size


def preview(outdir, family, built, cell=480, columns=4):
    """A sheet of close-ups, one per piece in the order built, each framed to fit, lit warm
    from one side and cool from the other on a dark floor: <outdir>/<family>.png."""
    import numpy as np
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = cell
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
    scene.world = world
    floor = lib.box("preview_floor", -50, 50, -50, 50, -0.02, 0, None)
    floor.data.materials.append(lib.material("preview_floor", 0x30333a, 0.0, 0.7))
    extra = [floor]
    for i, (name, energy, rotation, color) in enumerate((("key", 2.6, (55, 10, -40), (1.0, 0.85, 0.68)), ("fill", 0.9, (60, -15, 150), (0.62, 0.72, 1.0)))):
        light = lib.link(bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN")))
        light.data.energy, light.data.color = energy, color
        light.rotation_euler = tuple(lib.RAD(a) for a in rotation)
        extra.append(light)
    cam = lib.link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 50
    scene.camera = cam
    extra.append(cam)
    names = list(built)
    rows = (len(names) + columns - 1) // columns
    sheet = np.zeros((rows * cell, columns * cell, 4), dtype=np.float32)
    for obj in built.values():
        obj.hide_render = True
    for index, name in enumerate(names):
        obj = built[name]
        obj.hide_render = False
        lo, hi = bounds(obj)
        obj.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
        size = hi - lo
        radius = max(size.length / 2, 0.05)
        target = Vector((0, 0, size.z / 2))
        cam.location = target + Vector((0.55, -1.0, 0.45)).normalized() * radius * 3.1
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_start = radius * 0.05
        path = os.path.join(outdir, f"{family}-{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
        bpy.data.images.remove(image)
        row, column = index // columns, index % columns
        sheet[(rows - 1 - row) * cell:(rows - row) * cell, column * cell:(column + 1) * cell] = pixels
        obj.hide_render = True
        obj.location = (0, 0, 0)
    out = bpy.data.images.new(f"{family}-sheet", columns * cell, rows * cell, alpha=True)
    out.pixels = sheet.ravel()
    out.filepath_raw = os.path.join(outdir, f"{family}.png")
    out.file_format = "PNG"
    out.save()
    log("preview", out.filepath_raw, "in the order", ", ".join(names))
    for obj in built.values():
        obj.hide_render = False
    for obj in extra:
        bpy.data.objects.remove(obj)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--family", required=True)
    parser.add_argument("--only")
    parser.add_argument("--preview")
    parser.add_argument("--no-export", action="store_true")
    args = parser.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    family = importlib.import_module(args.family)
    family.materials()
    only = set(args.only.split(",")) if args.only else None
    built, report, failures = {}, {}, []
    for piece in family.PIECES:
        if only and piece.name not in only:
            continue
        obj = piece.make()
        obj.name = piece.name
        obj.data.name = piece.name
        lib.smooth(obj, piece.smooth)
        problems, tris, size = check(piece, obj)
        built[piece.name] = obj
        report[piece.name] = {"triangles": tris, "budget": piece.budget, "size": [round(v, 3) for v in size],
                              "materials": sorted({s.material.name for s in obj.material_slots if s.material}), "notes": piece.notes}
        log(f"{piece.name}: {tris}/{piece.budget} triangles, {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m" + ("" if not problems else "  FAILS: " + "; ".join(problems)))
        failures += [f"{piece.name}: {p}" for p in problems]
    total = sum(r["triangles"] for r in report.values())
    log(f"{len(built)} pieces, {total} triangles")
    if args.preview:
        preview(args.preview, args.family, built)
    if failures:
        raise SystemExit("Checks failed:\n  " + "\n  ".join(failures))
    if args.no_export or only:
        return
    # Nothing else may sit in the file: every top-level node is a piece.
    for obj in list(bpy.data.objects):
        if obj.name not in built:
            bpy.data.objects.remove(obj)
    out = os.path.join(lib.ROOT, "public", "models", f"{args.family}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=False, export_apply=True, export_yup=True,
                              export_materials="EXPORT", export_texcoords=False, export_normals=True, export_animations=False,
                              export_lights=False, export_cameras=False, export_extras=False)
    os.makedirs(os.path.join(HERE, "reports"), exist_ok=True)
    with open(os.path.join(HERE, "reports", f"{args.family}.json"), "w") as f:
        json.dump({"family": args.family, "pieces": report, "triangles": total, "bytes": os.path.getsize(out)}, f, indent=1)
        f.write("\n")
    log("wrote", out, os.path.getsize(out), "bytes")


main()
