"""Bake the Night Market's lightmap with Cycles.

Run inside Blender 4.4 or newer after scripts/lightmaps/export.mjs, from the repository root:

  blender -b --python scripts/lightmaps/bake.py -- [--samples 512] [--encode-only]

It reads assets-src/lightmaps/night-market.glb (the static surfaces, whose only texture
coordinates are the lightmap atlas, plus the stalls as occluders) and
night-market-scene.json (the lamps and the sun), and writes two images into
public/lightmaps/:

  night-market-sky.webp     how much of the sky each texel sees (ambient occlusion
                            within SKY_DISTANCE metres), linear
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
    args = parser.parse_args(argv)
    with open(os.path.join(SRC, f"{NAME}-scene.json")) as handle:
        setup = json.load(handle)
    size = setup["size"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.encode_only:
        encode(bpy.data.images.load(os.path.join(SRC, f"{NAME}-sky.exr")), bpy.data.images.load(os.path.join(SRC, f"{NAME}-bounce.exr")))
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
    # The raw bakes stay in assets-src so the encoding can be redone without baking.
    paths = []
    for image in (sky, bounce):
        paths.append(os.path.join(SRC, f"{NAME}-{image.name}.exr"))
        image.file_format = "OPEN_EXR"
        image.save(filepath=paths[-1])
    encode(*(bpy.data.images.load(path) for path in paths))


def encode(sky, bounce):
    with open(os.path.join(SRC, f"{NAME}-scene.json")) as handle:
        rects = json.load(handle)["rects"]
    sky_pixels = smooth(image_pixels(sky)[..., :3].mean(axis=2, keepdims=True), rects, 1).repeat(3, axis=2)
    light = smooth(image_pixels(bounce)[..., :3], rects, 3)
    # Scale so the brightest texels (ignoring the top half-percent of hot spots) use the
    # full range, then encode as sRGB so dim bounce keeps its precision.
    # Unseen faces all point at the top-right corner, which no chart uses: full sky, no bounce.
    sky_pixels[-4:, -4:] = 1.0
    light[-4:, -4:] = 0.0
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
