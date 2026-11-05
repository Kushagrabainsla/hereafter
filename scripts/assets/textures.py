"""Surface textures baked in Blender from node materials, for the surfaces that were painted on
a canvas in code: the wooden floors indoors and the kitchen's tiled wall. Each is a colour map
and a tangent-space normal map (OpenGL, +Y up, as three.js wants), 1024 px square, tiling
seamlessly: patterns repeat a whole number of times across the tile, and the noise runs round
a torus in 4D so it meets itself at the edges.

  blender -b --python-exit-code 1 --python scripts/assets/textures.py      (npm run build:textures)

Writes public/textures/<name>_diff.jpg and <name>_normal.jpg; the game loads them in
src/world/surfaceTextures.ts with the tile size given here.
"""

import math
import os

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "textures")
SIZE = 1024


def linear(hex_value):
    c = [((hex_value >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


class Graph:
    """A material's node tree, with small helpers for the nodes these recipes use."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.nodes.clear()
        self.output = self.node("ShaderNodeOutputMaterial")
        self.bsdf = self.node("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs["BSDF"], self.output.inputs["Surface"])

    def node(self, kind, **inputs):
        n = self.nodes.new(kind)
        for key, value in inputs.items():
            if isinstance(value, bpy.types.NodeSocket):
                self.link(value, n.inputs[key])
            else:
                n.inputs[key].default_value = value
        return n

    def link(self, a, b):
        self.links.new(a, b)

    def math(self, op, a, b=0.0):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                self.link(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def metres(self, tile):
        """Texture coordinates in metres across a tile `tile` metres square."""
        coords = self.node("ShaderNodeTexCoord")
        scale = self.node("ShaderNodeVectorMath")
        scale.operation = "SCALE"
        self.link(coords.outputs["UV"], scale.inputs[0])
        scale.inputs["Scale"].default_value = tile
        return scale.outputs[0]

    def torus_noise(self, tile, scale, detail=4.0, roughness=0.55):
        """Noise that tiles across `tile` metres: the square wrapped round a torus in 4D."""
        coords = self.node("ShaderNodeTexCoord")
        split = self.node("ShaderNodeSeparateXYZ")
        self.link(coords.outputs["UV"], split.inputs[0])
        u, v = self.math("MULTIPLY", split.outputs[0], 2 * math.pi), self.math("MULTIPLY", split.outputs[1], 2 * math.pi)
        radius = tile / (2 * math.pi)
        combine = self.node("ShaderNodeCombineXYZ")
        self.link(self.math("MULTIPLY", self.math("COSINE", u), radius), combine.inputs[0])
        self.link(self.math("MULTIPLY", self.math("SINE", u), radius), combine.inputs[1])
        self.link(self.math("MULTIPLY", self.math("COSINE", v), radius), combine.inputs[2])
        noise = self.node("ShaderNodeTexNoise")
        noise.noise_dimensions = "4D"
        self.link(combine.outputs[0], noise.inputs["Vector"])
        self.link(self.math("MULTIPLY", self.math("SINE", v), radius), noise.inputs["W"])
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = detail
        noise.inputs["Roughness"].default_value = roughness
        return noise.outputs["Fac"]

    def mix(self, factor, a, b):
        n = self.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        self.link(factor, n.inputs[0]) if isinstance(factor, bpy.types.NodeSocket) else setattr(n.inputs[0], "default_value", factor)
        for socket, value in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(value, bpy.types.NodeSocket):
                self.link(value, socket)
            else:
                socket.default_value = value
        return n.outputs[2]


def wood_floor():
    """Oak floorboards: 14 boards across a 2 m tile, each a metre long and staggered by half,
    with a dark gap between them, grain running along each board and blotchy wear."""
    tile = 2.0
    g = Graph("wood_floor")
    p = g.metres(tile)
    boards = g.node("ShaderNodeTexBrick", Vector=p, Color1=(1, 1, 1, 1), Color2=(1, 1, 1, 1), Mortar=(0, 0, 0, 1),
                    Scale=1.0, **{"Mortar Size": 0.0035, "Mortar Smooth": 0.2, "Bias": 0.0, "Brick Width": 1.0, "Row Height": tile / 14})
    boards.offset, boards.offset_frequency, boards.squash, boards.squash_frequency = 0.5, 2, 1.0, 2
    split = g.node("ShaderNodeSeparateXYZ")
    g.link(p, split.inputs[0])
    # A shade per board from its row and its place in the row, both counted within the tile,
    # so a board cut by the tile's edge has the same shade on both sides. Even rows are the
    # ones set over by half a board.
    row = g.math("FLOOR", g.math("DIVIDE", split.outputs[1], tile / 14))
    shift = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, g.math("MODULO", row, 2.0)), 0.5)
    board = g.math("MODULO", g.math("FLOOR", g.math("ADD", split.outputs[0], shift)), 2.0)
    shade = g.math("FRACT", g.math("MULTIPLY", g.math("SINE", g.math("ADD", g.math("MULTIPLY", row, 12.9898), g.math("MULTIPLY", board, 78.233))), 43758.5453))
    wobble = g.math("MULTIPLY", g.math("SUBTRACT", g.torus_noise(tile, 3.0), 0.5), 0.05)
    y = g.math("ADD", g.math("ADD", split.outputs[1], wobble), g.math("MULTIPLY", shade, 0.37))
    # Grain: 30 bands a metre across the boards, a whole number across the tile.
    grain = g.math("SINE", g.math("MULTIPLY", y, 2 * math.pi * 30))
    grain = g.math("POWER", g.math("ADD", g.math("MULTIPLY", grain, 0.5), 0.5), 3.0)
    wear = g.torus_noise(tile, 6.0, 6.0, 0.6)
    plank = g.mix(shade, linear(0x5c3b22), linear(0x7a5232))
    wood = g.mix(g.math("MULTIPLY", grain, 0.45), plank, linear(0x2e1b0e))
    wood = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", wear, 0.35), 0.5), wood, linear(0x9a7048))
    wood = g.mix(boards.outputs["Fac"], wood, linear(0x1a110a))
    g.link(wood, g.bsdf.inputs["Base Color"])
    # Relief: the gaps sunk, the grain faintly raised.
    height = g.math("ADD", g.math("SUBTRACT", 1.0, boards.outputs["Fac"]), g.math("MULTIPLY", grain, 0.08))
    bump = g.node("ShaderNodeBump", Height=height, Distance=0.004, Strength=1.0)
    g.link(bump.outputs["Normal"], g.bsdf.inputs["Normal"])
    return "wood_floor", g.material


def kitchen_tiles():
    """White subway tiles, 20 by 10 cm in grey grout, half-bond, with rounded edges, a little
    variation from tile to tile and a faint ripple in the glaze."""
    tile = 1.0
    g = Graph("kitchen_tiles")
    p = g.metres(tile)
    tiles = g.node("ShaderNodeTexBrick", Vector=p, Color1=linear(0xe9ece6), Color2=linear(0xd7dbd4), Mortar=linear(0x9a9d97),
                   Scale=1.0, **{"Mortar Size": 0.004, "Mortar Smooth": 0.45, "Bias": 0.0, "Brick Width": 0.2, "Row Height": 0.1})
    tiles.offset, tiles.offset_frequency = 0.5, 2
    glaze = g.torus_noise(tile, 9.0, 3.0, 0.5)
    colour = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", glaze, 0.5), 0.15), tiles.outputs["Color"], linear(0xb9bcb4))
    g.link(colour, g.bsdf.inputs["Base Color"])
    height = g.math("ADD", g.math("SUBTRACT", 1.0, tiles.outputs["Fac"]), g.math("MULTIPLY", glaze, 0.03))
    bump = g.node("ShaderNodeBump", Height=height, Distance=0.003, Strength=1.0)
    g.link(bump.outputs["Normal"], g.bsdf.inputs["Normal"])
    return "kitchen_tiles", g.material


def bake(obj, material, name, kind):
    """Bakes one map of `material` on the plane into public/textures/<name>_<kind>.jpg."""
    colour = kind == "diff"
    image = bpy.data.images.new(f"{name}_{kind}", SIZE, SIZE, alpha=False)
    image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    target = material.node_tree.nodes.new("ShaderNodeTexImage")
    target.image = image
    material.node_tree.nodes.active = target
    obj.data.materials.clear()
    obj.data.materials.append(material)
    if colour:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=0, use_clear=True)
    else:
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=0, use_clear=True)
    image.filepath_raw = os.path.join(OUT, f"{name}_{kind}.jpg")
    image.file_format = "JPEG"
    image.save(quality=90)
    material.node_tree.nodes.remove(target)
    print(f"[textures] wrote {image.filepath_raw}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    for make in (wood_floor, kitchen_tiles):
        name, material = make()
        bake(plane, material, name, "diff")
        bake(plane, material, name, "normal")


main()
