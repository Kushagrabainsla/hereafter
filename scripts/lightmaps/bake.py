"""Bake the Night Market's lightmap with Cycles.

Run inside Blender 4.4 or newer after scripts/lightmaps/export.mjs, from the repository root:

  blender -b --python scripts/lightmaps/bake.py -- [--samples 512] [--encode-only] [--drip-only]

It reads assets-src/lightmaps/night-market.glb (the static surfaces, whose only texture
coordinates are the lightmap atlas, plus the stalls as occluders) and
night-market-scene.json (the lamps and the sun), and writes three images into
public/lightmaps/:

  night-market-sky.webp     how much of the sky each texel sees (ambient occlusion
                            within SKY_DISTANCE metres), linear
  night-market-drip.webp    how near the sill, ledge or fitting above each wall texel is,
                            within DRIP metres, where rain stains the wall (1 just below)
  night-market-bounce.webp  light arriving after at least one bounce from the lamps and
                            the sun, per unit albedo, sRGB-encoded after scaling

and records the bounce scale in public/lightmaps/night-market.json. Light straight from
the lamps and the sun is not baked: the game draws it in real time.

Lamp units follow Three.js: a point light of intensity I gives an irradiance of I / d^2,
which is a Cycles point light of 4 pi I watts. The sun's strength is its irradiance.
"""

import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "assets-src", "lightmaps")
OUT = os.path.join(ROOT, "public", "lightmaps")
NAME = "night-market"
SKY_DISTANCE = 6.0
# How far below a sill or ledge rain stains a wall, in metres.
DRIP = 1.6
MARGIN = 2


def log(*args):
    print("[lightmap]", *args, flush=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(value):
    return tuple(srgb_to_linear(((value >> shift) & 255) / 255) for shift in (16, 8, 0))


def three_to_blender(x, y, z):
    # Three.js is y-up with z toward the viewer; the glTF importer turns that into Blender's z-up.
    return Vector((x, -z, y))


def use_gpu(scene):
    scene.cycles.device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type != "CPU"]
            if gpus:
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = "GPU"
                log("baking on", kind, [d.name for d in gpus])
                return
    except Exception as error:  # noqa: BLE001 - any failure falls back to the CPU
        log("GPU unavailable:", error)
    log("baking on the CPU")


def image_pixels(image):
    w, h = image.size
    a = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def smooth(pixels, rects, radius, passes=3):
    """Average away sampling noise inside each chart, never across charts: repeated box
    blurs approximate a Gaussian, normalised at the chart's edges."""
    out = pixels.copy()
    for x, y, w, h in rects:
        block = out[y:y + h, x:x + w]
        if block.size == 0:
            continue
        for _ in range(passes):
            for axis in (0, 1):
                n = block.shape[axis]
                total = np.cumsum(np.concatenate([np.zeros_like(np.take(block, [0], axis=axis)), block], axis=axis), axis=axis)
                index = np.arange(n)
                low, high = np.clip(index - radius, 0, n), np.clip(index + radius + 1, 0, n)
                taken = np.take(total, high, axis=axis) - np.take(total, low, axis=axis)
                count = (high - low).astype(np.float32)
                shape = [1, 1, 1]
                shape[axis] = n
                block = taken / count.reshape(shape)
        out[y:y + h, x:x + w] = block
    return out


def save(name, pixels, quality=90):
    """Write already-encoded 0..1 values as a WebP with no colour conversion."""
    h, w = pixels.shape[:2]
    image = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(pixels[..., :3], 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    path = os.path.join(OUT, f"{name}.webp")
    image.file_format = "WEBP"
    image.save(filepath=path, quality=quality)
    log("wrote", path, os.path.getsize(path), "bytes")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=384)
    parser.add_argument("--encode-only", action="store_true", help="re-encode the last raw bakes in assets-src/lightmaps")
    parser.add_argument("--drip-only", action="store_true", help="bake only the drip mask; reuse the last sky and bounce bakes")
    args = parser.parse_args(argv)
    with open(os.path.join(SRC, f"{NAME}-scene.json")) as handle:
        setup = json.load(handle)
    size = setup["size"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.encode_only:
        drip_path = os.path.join(SRC, f"{NAME}-drip.exr")
        encode(bpy.data.images.load(os.path.join(SRC, f"{NAME}-sky.exr")), bpy.data.images.load(os.path.join(SRC, f"{NAME}-bounce.exr")),
               bpy.data.images.load(drip_path) if os.path.exists(drip_path) else None)
        return
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    use_gpu(scene)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f"{NAME}.glb"))
    receivers = [o for o in scene.objects if o.type == "MESH" and o.name.startswith("receiver:")]
    log(len(receivers), "receivers,", sum(1 for o in scene.objects if o.name.startswith("occluder:")), "occluders")

    sky = bpy.data.images.new("sky", size, size, alpha=False, float_buffer=True)
    bounce = bpy.data.images.new("bounce", size, size, alpha=False, float_buffer=True)
    nodes = []
    for material in {slot.material for o in receivers for slot in o.material_slots if slot.material}:
        tree = material.node_tree
        node = tree.nodes.new("ShaderNodeTexImage")
        tree.nodes.active = node
        nodes.append(node)

    bpy.ops.object.select_all(action="DESELECT")
    for o in receivers:
        o.select_set(True)
    bpy.context.view_layer.objects.active = receivers[0]
    scene.render.bake.margin = MARGIN
    scene.render.bake.margin_type = "EXTEND"
    scene.render.bake.use_clear = True

    if args.drip_only:
        drip = bake_drip(scene, nodes, size)
        path = os.path.join(SRC, f"{NAME}-drip.exr")
        drip.file_format = "OPEN_EXR"
        drip.save(filepath=path)
        encode(bpy.data.images.load(os.path.join(SRC, f"{NAME}-sky.exr")), bpy.data.images.load(os.path.join(SRC, f"{NAME}-bounce.exr")), bpy.data.images.load(path))
        return

    # Sky visibility: ambient occlusion within a few metres, so corners, the ground under
    # awnings and the foot of the alley walls darken while open paving stays bright.
    world = bpy.data.worlds.new("bake")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    scene.world = world
    world.light_settings.distance = SKY_DISTANCE
    scene.cycles.samples = max(64, args.samples // 4)
    for node in nodes:
        node.image = sky
    log("baking sky occlusion")
    bpy.ops.object.bake(type="AO", margin=MARGIN)

    # Bounce: every lamp and the sun, with only light that has bounced at least once.
    for x, y, z, color, intensity, _distance in setup["lights"]:
        data = bpy.data.lights.new("lamp", "POINT")
        data.energy = 4 * math.pi * intensity
        data.color = hex_color(color)
        data.shadow_soft_size = 0.05
        lamp = bpy.data.objects.new("lamp", data)
        lamp.location = three_to_blender(x, y, z)
        scene.collection.objects.link(lamp)
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = setup["sun"]["intensity"]
    sun_data.color = hex_color(setup["sun"]["color"])
    sun_data.angle = math.radians(1.0)
    sun = bpy.data.objects.new("sun", sun_data)
    direction = three_to_blender(*setup["sun"]["direction"]).normalized()
    sun.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    scene.cycles.samples = args.samples
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 4
    for node in nodes:
        node.image = bounce
    log(f"baking bounce light from {len(setup['lights'])} lamps and the sun at {args.samples} samples")
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"INDIRECT"}, margin=MARGIN)
    drip = bake_drip(scene, nodes, size)
    # The raw bakes stay in assets-src so the encoding can be redone without baking.
    paths = []
    for image in (sky, bounce, drip):
        paths.append(os.path.join(SRC, f"{NAME}-{image.name}.exr"))
        image.file_format = "OPEN_EXR"
        image.save(filepath=paths[-1])
    encode(*(bpy.data.images.load(path) for path in paths))


def bake_attribute(scene, nodes, size, name, socket, scale, offset):
    """Bake a geometry attribute (world position or normal) of every texel into a float
    image, as attribute * scale + offset so it stays positive; empty texels stay black."""
    image = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    for node in nodes:
        tree = node.id_data
        geometry = tree.nodes.new("ShaderNodeNewGeometry")
        remap = tree.nodes.new("ShaderNodeVectorMath")
        remap.operation = "MULTIPLY_ADD"
        remap.inputs[1].default_value = (scale, scale, scale)
        remap.inputs[2].default_value = (offset, offset, offset)
        emission = tree.nodes.new("ShaderNodeEmission")
        output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
        tree.links.new(geometry.outputs[socket], remap.inputs[0])
        tree.links.new(remap.outputs[0], emission.inputs["Color"])
        tree.links.new(emission.outputs[0], output.inputs["Surface"])
        node.image = image
        tree.nodes.active = node
    scene.cycles.samples = 1
    log("baking", name)
    bpy.ops.object.bake(type="EMIT", margin=0)
    return image_pixels(image)[..., :3]


def bake_drip(scene, nodes, size):
    """Where rain runs down a wall: for each wall texel, how near the nearest thing above it
    is (a sill, a ledge, a lintel, an air conditioner, a sign), within DRIP metres. Water
    gathers on it and runs off its edge, staining the wall below in streaks that fade."""
    from mathutils.bvhtree import BVHTree
    position = bake_attribute(scene, nodes, size, "position", "Position", 1 / 200, 0.5)
    normal = bake_attribute(scene, nodes, size, "normal", "Normal", 0.5, 0.5)
    vertices, polygons = [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in scene.objects:
        if o.type != "MESH":
            continue
        mesh = o.evaluated_get(depsgraph).to_mesh()
        base = len(vertices)
        vertices.extend(o.matrix_world @ v.co for v in mesh.vertices)
        polygons.extend([base + i for i in p.vertices] for p in mesh.polygons)
        o.evaluated_get(depsgraph).to_mesh_clear()
    tree = BVHTree.FromPolygons(vertices, polygons)
    n = normal * 2 - 1
    p = (position - 0.5) * 200
    wall = (np.linalg.norm(n, axis=2) > 0.5) & (np.abs(n[..., 2]) < 0.4)
    out = np.zeros((size, size, 3), dtype=np.float32)
    up = Vector((0.0, 0.0, 1.0))
    ys, xs = np.nonzero(wall)
    log("casting", len(ys), "drip rays")
    for y, x in zip(ys, xs):
        # Four starts, 2 cm and 10 cm out on both sides: a sill stands a little proud of the
        # wall, a cornice less, and some faces carry normals that point into the building.
        nearest = DRIP
        for step in (0.02, 0.1, -0.02, -0.1):
            hit = tree.ray_cast(Vector(p[y, x] + n[y, x] * step), up, DRIP)
            if hit[0] is not None and hit[3] < nearest:
                nearest = hit[3]
        out[y, x] = (1 - nearest / DRIP) ** 1.5
    image = bpy.data.images.new("drip", size, size, alpha=False, float_buffer=True)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., :3] = out
    image.pixels.foreach_set(rgba.ravel())
    return image


def encode(sky, bounce, drip=None):
    with open(os.path.join(SRC, f"{NAME}-scene.json")) as handle:
        layout = json.load(handle)
    # The export's chart rectangles count rows from the top of the image; Blender's from the bottom.
    rects = [(x, layout["size"] - y - h, w, h) for x, y, w, h in layout["rects"]]
    if drip is not None:
        streaks = smooth(image_pixels(drip)[..., :1], rects, 1, passes=1).repeat(3, axis=2)
        save(f"{NAME}-drip", streaks)
    sky_pixels = smooth(image_pixels(sky)[..., :3].mean(axis=2, keepdims=True), rects, 1).repeat(3, axis=2)
    light = smooth(image_pixels(bounce)[..., :3], rects, 3)
    # Scale so the brightest texels (ignoring the top half-percent of hot spots) use the
    # full range, then encode as sRGB so dim bounce keeps its precision.
    # Unseen faces all point at the last texel of the atlas, which no chart uses: full sky, no
    # bounce. It is the bottom-right corner of the image, the first rows in Blender's order.
    sky_pixels[:4, -4:] = 1.0
    light[:4, -4:] = 0.0
    peak = float(np.percentile(light.max(axis=2), 99.5)) or 1.0
    scaled = np.clip(light / peak, 0, 1)
    encoded = np.where(scaled <= 0.0031308, scaled * 12.92, 1.055 * np.power(scaled, 1 / 2.4) - 0.055)
    os.makedirs(OUT, exist_ok=True)
    save(f"{NAME}-sky", sky_pixels)
    save(f"{NAME}-bounce", encoded)
    path = os.path.join(OUT, f"{NAME}.json")
    with open(path) as handle:
        data = json.load(handle)
    data["bounceScale"] = round(peak, 6)
    with open(path, "w") as handle:
        json.dump(data, handle, separators=(",", ":"))
    log("bounce peak", peak, "sky mean", float(sky_pixels.mean()))


if __name__ == "__main__":
    main()
