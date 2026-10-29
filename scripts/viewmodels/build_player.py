"""Build the third-person player character (public/models/player.glb).

Run from the repository root with Blender 4.4 or newer:

  blender -b --python scripts/viewmodels/build_player.py -- --out public/models/player.glb [--preview DIR]

The Microsoft Rocketbox avatar Military_Male_03 (MIT) is decimated, stripped of
its face bones and holstered pistol, textured at 1K/512 and animated with the
Rocketbox animation library (same licence): idle, walk, run and crouch are
retargeted onto the avatar's own skeleton by copying world-space bone rotations
frame by frame, and a short death fall is generated. A `weapon_socket` empty on
the right hand carries the held weapon. The model faces +Z in glTF with its feet
at the origin, matching src/game/remotePlayers.ts.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import (SRC, assign_action, erase_patches, image_to_np, load_tga,  # noqa: E402
                   log, np_to_image, push_to_nla, resample, select_only, solo_track)

ROCKETBOX = os.path.join(SRC, "rocketbox")
FPS = 30  # the Rocketbox clips are authored at 30 fps and are sampled frame for frame
CLIPS = {
    "idle": ("m_idle_neutral_01.max.fbx", 180),
    "walk": ("m_walk_neutral.max.fbx", None),
    "run": ("m_run_neutral.max.fbx", None),
    "crouch": ("m_crouch_idle.max.fbx", 150),
}
FACE_KEYS = ("Eye", "Jaw", "Lip", "Mouth", "Masseter", "Caninus", "Cheek", "Eyebrow", "Nose", "Tongue")
TEXTURES = {
    "body": ("sm004_body_color_acu.tga", "sm004_body_normal.tga", 1024, 0.9),
    "head": ("sm004_head_color.tga", "sm004_head_normal.tga", 512, 0.72),
    "helmet": ("sm004_helmet_color_acu.tga", "sm004_helmet_normal.tga", 512, 0.85),
    "equipment": ("sm004_equipment_color_acu.tga", "sm004_equipment_normal.tga", 512, 0.8),
}


def rigid(matrix):
    loc, rot, _ = matrix.decompose()
    return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()


# ---------------------------------------------------------------------------
# character

def load_character():
    bpy.ops.import_scene.fbx(filepath=os.path.join(ROCKETBOX, "Military_Male_03.fbx"), use_anim=False)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.name, mesh.name = "Player", "player"
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.data.transform(mw)
    mesh.matrix_world = Matrix.Identity(4)
    aw = arm.matrix_world.copy()
    arm.data.transform(aw)
    arm.matrix_world = Matrix.Identity(4)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    # relink textures that the FBX references through 3ds Max paths
    for img in bpy.data.images:
        local = os.path.join(ROCKETBOX, os.path.basename(img.filepath))
        if os.path.exists(local):
            img.filepath = local
            img.reload()
    return arm, mesh


def simplify(arm, mesh, ratio):
    me = mesh.data
    pistol = next((i for i, m in enumerate(me.materials) if m and m.name == "sm004_pistol"), None)
    bm = bmesh.new()
    bm.from_mesh(me)
    if pistol is not None:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == pistol], context="FACES")
    bm.to_mesh(me)
    bm.free()
    mod = mesh.modifiers.new("decimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    select_only([mesh])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log("mesh after decimation", len(me.vertices), "vertices", len(me.polygons), "faces")
    # face bones go, so their weights move to the head before the groups are dropped
    face_groups = {vg.index for vg in mesh.vertex_groups if any(k in vg.name for k in FACE_KEYS)}
    head = mesh.vertex_groups["Bip01 Head"]
    for v in me.vertices:
        moved = sum(g.weight for g in v.groups if g.group in face_groups)
        if moved > 0:
            head.add([v.index], moved, "ADD")
    select_only([arm])
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        if any(k in b.name for k in FACE_KEYS):
            eb.remove(b)
    bpy.ops.object.mode_set(mode="OBJECT")
    names = {b.name for b in arm.data.bones}
    for vg in list(mesh.vertex_groups):
        if vg.name not in names:
            mesh.vertex_groups.remove(vg)
    loose = sum(1 for v in me.vertices if not any(g.weight > 0 for g in v.groups))
    log("vertices without weights", loose)
    select_only([mesh])
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    log("bones kept", len(arm.data.bones))


def build_materials(mesh):
    me = mesh.data
    index_of = {m.name: i for i, m in enumerate(me.materials) if m}
    new_materials = []
    remap = {}
    for key, (color_name, normal_name, size, roughness) in TEXTURES.items():
        color = load_tga(os.path.join(ROCKETBOX, color_name))
        normal = load_tga(os.path.join(ROCKETBOX, normal_name))
        if key == "body":
            color, normal = erase_patches(color), erase_patches(normal)
        h, w = color.shape[:2]
        scale = size / max(w, h)
        color = resample(color, max(4, int(w * scale)), max(4, int(h * scale)))
        normal = resample(normal, max(4, int(w * scale)), max(4, int(h * scale)))
        mat = bpy.data.materials.new(key)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = roughness
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = np_to_image(f"player_{key}_color", color, True)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = np_to_image(f"player_{key}_normal", normal, False)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        remap[index_of[f"sm004_{key}"]] = len(new_materials)
        new_materials.append(mat)
    old = {p.index: p.material_index for p in me.polygons}
    me.materials.clear()
    for mat in new_materials:
        me.materials.append(mat)
    for p in me.polygons:
        p.material_index = remap.get(old[p.index], 0)
    for m in list(bpy.data.materials):
        if m.name.startswith("sm004"):
            bpy.data.materials.remove(m)
    for img in list(bpy.data.images):
        if img.name.startswith(("Map #", "Bitmaptexture")):
            bpy.data.images.remove(img)


def add_weapon_socket(arm, mesh):
    """Empty on the right hand whose -Z runs along the fingers, +Y to the thumb side, +X away from the palm."""
    bones = arm.data.bones
    hand = bones["Bip01 R Hand"]
    wrist = hand.head_local.copy()
    knuckles = sum((bones[f"Bip01 R Finger{i}"].head_local for i in range(1, 5)), Vector()) / 4
    f = (knuckles - wrist).normalized()
    group = mesh.vertex_groups["Bip01 R Hand"].index
    pts = np.array([v.co[:] for v in mesh.data.vertices if any(g.group == group and g.weight > 0.5 for g in v.groups)])
    _, _, vt = np.linalg.svd(pts - pts.mean(0), full_matrices=False)
    n = Vector(vt[2])
    if n.dot(Vector((-math.copysign(1, wrist.x), 0, 0))) < 0:
        n = -n
    n = (n - f * n.dot(f)).normalized()
    s = f.cross(n)
    frame = Matrix.Identity(4)
    frame.col[0][:3], frame.col[1][:3], frame.col[2][:3] = -n, s, -f
    frame.translation = wrist + f * 0.055 + n * 0.015
    socket = bpy.data.objects.new("weapon_socket", None)
    socket.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(socket)
    socket.parent = arm
    socket.parent_type = "BONE"
    socket.parent_bone = "Bip01 R Hand"
    bpy.context.view_layer.update()
    socket.matrix_world = frame
    return socket


# ---------------------------------------------------------------------------
# animation retargeting

def sample_clip(path, keep_bones):
    """World-space rigid matrices of every kept bone for each frame of a Rocketbox animation FBX."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    new = [o for o in bpy.data.objects if o not in before]
    anim = next(o for o in new if o.type == "ARMATURE")
    act = anim.animation_data.action
    start, end = (int(round(v)) for v in act.frame_range)
    scene = bpy.context.scene
    frames = []
    for f in range(start, end + 1):
        scene.frame_set(f)
        frames.append({pb.name: rigid(anim.matrix_world @ pb.matrix) for pb in anim.pose.bones if pb.name in keep_bones})
    for o in new:
        bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        if a.users == 0 or a is act:
            bpy.data.actions.remove(a)
    return frames


def retarget(arm, frames, root="Bip01 Pelvis"):
    """Local pose matrices for the character from world targets: rotations for every bone, translation for the root."""
    bones = arm.data.bones
    order = []
    def visit(b):
        order.append(b.name)
        for c in b.children:
            visit(c)
    visit(bones[root])
    rest_pelvis = bones[root].head_local
    result = []
    for world in frames:
        actual = {}
        basis = {}
        for name in order:
            if name not in world:
                continue
            bone = bones[name]
            target = world[name]
            if bone.parent is None:
                parent_pose = Matrix.Identity(4)
                local_rest = bone.matrix_local
            else:
                parent_pose = actual[bone.parent.name]
                local_rest = bone.parent.matrix_local.inverted() @ bone.matrix_local
            b = (parent_pose @ local_rest).inverted() @ target
            b = rigid(b)
            if bone.parent is not None:
                b.translation = Vector((0, 0, 0))
            else:
                # keep the body over its own feet: the hip sway stays, forward drift goes
                b.translation = Vector((0.0, 0.0, b.translation.z))
            basis[name] = b
            actual[name] = parent_pose @ local_rest @ b
        result.append(basis)
    pelvis_height = [world[root].translation.z for world in frames]
    log(f"retargeted {len(frames)} frames, pelvis height {min(pelvis_height):.3f}-{max(pelvis_height):.3f} (rest {rest_pelvis.z:.3f})")
    return result


def seam(frames, blend=8):
    """Blend the tail of a loop into its first frame so it cycles without a pop."""
    n = len(frames)
    blend = min(blend, n // 4)
    first = frames[0]
    for i in range(blend):
        k = n - blend + i
        w = (i + 1) / (blend + 1)
        for name, m in frames[k].items():
            loc, rot, _ = m.decompose()
            loc0, rot0, _ = first[name].decompose()
            frames[k][name] = Matrix.Translation(loc.lerp(loc0, w)) @ rot.slerp(rot0, w).to_matrix().to_4x4()
    return frames


def death_frames(arm, idle_pose, seconds=1.0):
    """Fall backwards from the idle pose: the body pivots about the heels and settles on the ground."""
    bones = arm.data.bones
    root = "Bip01 Pelvis"
    rest = bones[root].matrix_local
    n = int(seconds * FPS)
    frames = []
    for f in range(n + 1):
        t = f / n
        k = 1 - (1 - t) ** 2.2
        basis = {name: m.copy() for name, m in idle_pose.items()}
        pelvis_pose = rest @ idle_pose[root]
        pivot = Vector((pelvis_pose.translation.x, pelvis_pose.translation.y + 0.12, 0.0))
        fall = Matrix.Translation(pivot) @ Matrix.Rotation(-math.radians(82) * k, 4, "X") @ Matrix.Translation(-pivot)
        settle = Matrix.Translation((0, 0.05 * k, -0.08 * k))
        target = settle @ fall @ pelvis_pose
        basis[root] = rigid(rest.inverted() @ target)
        for side in "LR":
            for name, angle in ((f"Bip01 {side} Thigh", 18), (f"Bip01 {side} Calf", -28), (f"Bip01 {side} UpperArm", 25), (f"Bip01 {side} Forearm", 20)):
                if name in basis:
                    basis[name] = basis[name] @ Matrix.Rotation(math.radians(angle) * k, 4, "Z")
        frames.append(basis)
    return frames


def write_clip(arm, name, frames):
    act = bpy.data.actions.new(f"{name}.player")
    assign_action(arm, act)
    for f, basis in enumerate(frames):
        for bone_name, m in basis.items():
            pb = arm.pose.bones[bone_name]
            pb.matrix_basis = m
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
    push_to_nla(arm, name)


# ---------------------------------------------------------------------------

def render_previews(outdir, objs, clip_frames):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
    scene.collection.objects.link(cam)
    cam.data.angle = math.radians(40)
    sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(40))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.56, 0.64, 1)
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 900
    for name, count in clip_frames.items():
        solo_track(objs, name)
        for f in sorted({0, count // 2, count - 1}):
            scene.frame_set(f)
            for label, offset in (("front", (0.9, -3.2, 1.1)), ("side", (3.2, 0.3, 1.1))):
                cam.location = Vector(offset)
                cam.rotation_euler = (Vector((0, 0, 0.85)) - cam.location).to_track_quat("-Z", "Y").to_euler()
                scene.camera = cam
                scene.render.filepath = os.path.join(outdir, f"player_{name}_{f:03d}_{label}.png")
                bpy.ops.render.render(write_still=True)
    for o in (cam, sun):
        bpy.data.objects.remove(o)
    solo_track(objs, "idle")
    scene.frame_set(0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--preview")
    ap.add_argument("--ratio", type=float, default=0.55)
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    arm, mesh = load_character()
    scene.render.fps = FPS
    simplify(arm, mesh, args.ratio)
    build_materials(mesh)
    socket = add_weapon_socket(arm, mesh)
    keep = {b.name for b in arm.data.bones}

    clips = {}
    for name, (filename, limit) in CLIPS.items():
        world_frames = sample_clip(os.path.join(ROCKETBOX, "animations", filename), keep)
        if limit:
            world_frames = world_frames[:limit]
        scene.render.fps = FPS
        local = seam(retarget(arm, world_frames))
        clips[name] = local
    clips["death"] = death_frames(arm, clips["idle"][0])
    for name, frames in clips.items():
        write_clip(arm, name, frames)
    scene.frame_set(0)
    objs = [arm, mesh, socket]
    if args.preview:
        render_previews(args.preview, objs, {name: len(frames) for name, frames in clips.items()})
    if args.out:
        out = os.path.abspath(args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        select_only(objs)
        bpy.ops.export_scene.gltf(
            filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
            export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
            export_vertex_color="NONE", export_image_format="WEBP", export_image_quality=80,
            export_skins=True, export_influence_nb=4, export_morph=False,
            export_animations=True, export_animation_mode="NLA_TRACKS", export_merge_animation="NLA_TRACK",
            export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True,
            export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
            export_rest_position_armature=True, export_lights=False, export_cameras=False, export_extras=False,
        )
        log("wrote", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
