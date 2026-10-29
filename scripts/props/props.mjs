#!/usr/bin/env node
// Helpers for scripts/props/build.sh. Dependencies are pinned in scripts/props/package.json.
//   node props.mjs list                                -> one line per prop: name source ratio error texture_px
//   node props.mjs prepare <name> <source> <out.glb>   -> pick the variant, fix its pose, bake transforms into
//                                                         one node, centre on x/z with the base at y = 0
//   node props.mjs normalise <in.glb> <out.glb>        -> re-centre after simplification (geometry, not node TRS)
//   node props.mjs manifest <public dir>               -> write <public>/models/props/props.json from the GLBs
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeTransform, compactPrimitive, dedup, joinPrimitives, prune, transformMesh } from '@gltf-transform/functions';

const PH_LICENSE = 'CC0-1.0 (https://polyhaven.com/license)';
const ph = (asset) => `https://polyhaven.com/a/${asset}`;

// Order is the manifest order. `source` is relative to assets-src/props. `ratio` is the simplify target
// (fraction of vertices kept; 1 = skip) and `error` its limit as a fraction of the mesh radius (default 0.01);
// `texture` is the maximum texture edge in pixels.
// Masses are real-world estimates for the object as found on a street, noted per prop.
export const PROPS = [
  {
    name: 'crate_wood', source: 'wooden_crate_01/wooden_crate_01_1k.gltf', ratio: 0.32, error: 0.02, texture: 512,
    keep: ['wooden_crate_01', 'wooden_crate_01_lid', 'wooden_crate_01_latch'],
    material: 'wood', mass: 18, // ~12 kg of pine boards and fittings plus some contents
    source_url: ph('wooden_crate_01'), author: 'James Ray Cock', license: PH_LICENSE,
  },
  {
    name: 'crate_wood_large', source: 'wooden_military_crate/wooden_military_crate_1k.gltf', ratio: 0.16, error: 0.015, texture: 512,
    // 23k source triangles; below ~0.3 the bevelled planks collapse and the front panel shades blotchy.
    keep: ['wooden_military_crate', 'wooden_military_crate_lid', 'wooden_military_crate_latch'],
    material: 'wood', mass: 40, // 1.2 m hardwood transport crate with steel straps, empty
    source_url: ph('wooden_military_crate'), author: 'Prabhjinder Singh', license: PH_LICENSE,
  },
  {
    name: 'trash_can', source: 'metal_trash_can/metal_trash_can_1k.gltf', ratio: 0.38, error: 0.02, texture: 512,
    keep: ['metal_trash_can', 'metal_trash_can_lid', 'metal_trash_can_handle_left', 'metal_trash_can_handle_right'],
    // The source leans the lid against the can; seat it on the rim (the lid's underside is its local y = 0).
    pose: { metal_trash_can_lid: { translation: [0.5, 0.908, 0], rotation: [0, 0, 0, 1] } },
    material: 'metal-thin', mass: 14, // ~9 kg galvanised steel can plus refuse
    source_url: ph('metal_trash_can'), author: 'GurJas Studios', license: PH_LICENSE,
  },
  {
    name: 'oil_drum', source: 'barrel_03/barrel_03_1k.gltf', ratio: 1, texture: 512,
    keep: ['barrel_03'],
    material: 'metal-thin', mass: 95, // 20 kg 208 L steel drum, part filled (~80 L of oil)
    source_url: ph('barrel_03'), author: 'Serhii Khromov', license: PH_LICENSE,
  },
  {
    name: 'cardboard_box', source: 'cardboard_box_01/cardboard_box_01_1k.gltf', ratio: 0.07, error: 0.03, texture: 512,
    keep: ['cardboard_box_01'],
    material: 'cardboard', mass: 5, // strapped carton with loose contents
    source_url: ph('cardboard_box_01'), author: 'Rahul Chaudhary', license: PH_LICENSE,
  },
  {
    name: 'aircon_unit', source: 'exterior_aircon_unit/exterior_aircon_unit_1k.gltf', ratio: 0.3, error: 0.02, texture: 512,
    keep: ['exterior_aircon_unit'], // the clean variant; the rusted twin is dropped
    // Drop the condensate pipe that hangs below the mounting feet (the only part below y = 0).
    strip: (b) => b.min[1] < -0.05,
    // The glTF bundle points the grille material at a JPEG opacity map; use the RGBA diffuse instead.
    textures: { exterior_aircon_unit_02: 'textures/exterior_aircon_unit_02_diff_1k.png' },
    material: 'metal-solid', mass: 45, // split-system condenser: sheet steel case, compressor and coil
    source_url: ph('exterior_aircon_unit'), author: 'Monsta3D', license: PH_LICENSE,
  },
  {
    name: 'plastic_crate', source: 'plastic_crate_02/plastic_crate_02_1k.gltf', ratio: 0.4, error: 0.01, texture: 512,
    // A tight error limit keeps the lattice slots open.
    keep: ['plastic_crate_02'],
    material: 'plastic', mass: 1.6, // empty polypropylene stacking crate
    source_url: ph('plastic_crate_02'), author: 'Fabi_G', license: PH_LICENSE,
  },
];

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
const byName = (name) => {
  const prop = PROPS.find((p) => p.name === name);
  if (!prop) throw new Error(`unknown prop ${name}`);
  return prop;
};

// Remove the connected pieces of a primitive whose bounds match `test` (vertices welded by position).
function stripComponents(prim, test) {
  const pos = prim.getAttribute('POSITION');
  const indices = prim.getIndices();
  const count = pos.getCount();
  const first = new Map();
  const rep = new Uint32Array(count);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    pos.getElement(i, v);
    const key = v.map((x) => Math.round(x * 1e5)).join(',');
    if (!first.has(key)) first.set(key, i);
    rep[i] = first.get(key);
  }
  const parent = Uint32Array.from({ length: count }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tris = indices.getCount() / 3;
  const corner = (t, j) => rep[indices.getScalar(3 * t + j)];
  for (let t = 0; t < tris; t++) {
    const a = find(corner(t, 0));
    parent[find(corner(t, 1))] = a;
    parent[find(corner(t, 2))] = a;
  }
  const bounds = new Map();
  for (let t = 0; t < tris; t++) {
    const root = find(corner(t, 0));
    if (!bounds.has(root)) bounds.set(root, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const b = bounds.get(root);
    for (let j = 0; j < 3; j++) {
      pos.getElement(indices.getScalar(3 * t + j), v);
      for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[k]); b.max[k] = Math.max(b.max[k], v[k]); }
    }
  }
  const drop = new Set([...bounds].filter(([, b]) => test(b)).map(([root]) => root));
  const kept = [];
  for (let t = 0; t < tris; t++) {
    if (drop.has(find(corner(t, 0)))) continue;
    for (let j = 0; j < 3; j++) kept.push(indices.getScalar(3 * t + j));
  }
  const Array_ = count > 65535 ? Uint32Array : Uint16Array;
  indices.setArray(Array_.from(kept));
  compactPrimitive(prim);
  return tris - kept.length / 3;
}

// Translate all geometry so the scene is centred on x/z and its lowest point sits on y = 0.
function groundAndCentre(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const offset = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
}

async function prepare(name, source, out) {
  const prop = byName(name);
  const doc = await io().read(source);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  for (const node of root.listNodes()) {
    if (!prop.keep.includes(node.getName())) node.dispose();
  }
  for (const [nodeName, pose] of Object.entries(prop.pose ?? {})) {
    const node = root.listNodes().find((n) => n.getName() === nodeName);
    if (pose.translation) node.setTranslation(pose.translation);
    if (pose.rotation) node.setRotation(pose.rotation);
  }
  for (const [materialName, file] of Object.entries(prop.textures ?? {})) {
    const material = root.listMaterials().find((m) => m.getName() === materialName);
    const image = await readFile(path.join(path.dirname(source), file));
    const texture = doc.createTexture(path.basename(file, path.extname(file))).setImage(image).setMimeType('image/png');
    material.setBaseColorTexture(texture).setAlphaMode('MASK').setAlphaCutoff(0.5);
  }
  // Bake every node transform into its mesh, then gather all primitives on one node.
  const prop_ = doc.createNode(name);
  const mesh = doc.createMesh(name);
  prop_.setMesh(mesh);
  for (const node of root.listNodes()) {
    if (node === prop_) continue;
    clearNodeTransform(node);
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (prop.strip) {
        const removed = stripComponents(prim, prop.strip);
        if (removed) console.log(`  ${name}: stripped ${removed} triangles`);
      }
      mesh.addPrimitive(prim);
    }
    node.dispose();
  }
  scene.addChild(prop_);
  // Join primitives that share a material (e.g. the can, its lid and handles) into one draw call.
  const groups = new Map();
  for (const prim of mesh.listPrimitives()) {
    const key = prim.getMaterial();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(prim);
  }
  for (const prims of groups.values()) {
    if (prims.length < 2) continue;
    const joined = joinPrimitives(prims);
    for (const p of prims) { mesh.removePrimitive(p); p.dispose(); }
    mesh.addPrimitive(joined);
  }
  groundAndCentre(doc);
  await doc.transform(prune(), dedup());
  await io().write(out, doc);
}

async function normalise(input, out) {
  const doc = await io().read(input);
  groundAndCentre(doc);
  await io().write(out, doc);
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) throw new Error('expected TRIANGLES');
      n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return n;
}

async function manifest(publicDir) {
  const entries = [];
  for (const prop of PROPS) {
    const file = `models/props/${prop.name}.glb`;
    const full = path.join(publicDir, file);
    const doc = await io().read(full);
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    const r = (x) => Math.round(x * 1000) / 1000;
    if (Math.abs(min[1]) > 1e-4 || Math.abs(min[0] + max[0]) > 1e-4 || Math.abs(min[2] + max[2]) > 1e-4) {
      throw new Error(`${prop.name} is not grounded and centred: ${min} ${max}`);
    }
    entries.push({
      name: prop.name,
      file,
      size: [r(max[0] - min[0]), r(max[1] - min[1]), r(max[2] - min[2])],
      material: prop.material,
      mass: prop.mass,
      triangles: triangles(doc),
      bytes: (await stat(full)).size,
      source: prop.source_url,
      author: prop.author,
      license: prop.license,
    });
  }
  const out = path.join(publicDir, 'models/props/props.json');
  await writeFile(out, JSON.stringify(entries, null, 2) + '\n');
  for (const e of entries) console.log(`  ${e.name.padEnd(17)} ${e.size.map((x) => x.toFixed(3)).join(' x ')} m  ${String(e.triangles).padStart(5)} tris  ${(e.bytes / 1024).toFixed(0).padStart(4)} KB  ${e.material}`);
  console.log(`Wrote ${out}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'list') for (const p of PROPS) console.log(p.name, p.source, p.ratio, p.error ?? 0.01, p.texture);
else if (cmd === 'prepare') await prepare(...args);
else if (cmd === 'normalise') await normalise(...args);
else if (cmd === 'manifest') await manifest(...args);
else { console.error('usage: props.mjs list | prepare <name> <source> <out> | normalise <in> <out> | manifest <public dir>'); process.exit(1); }
