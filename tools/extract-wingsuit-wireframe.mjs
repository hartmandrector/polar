#!/usr/bin/env node
/**
 * Extract per-segment wingsuit wireframe geometry from an edited .glb that
 * was originally produced by `__polar.exportWingsuitWireframes()`.
 *
 * Output:
 *   - Walks the scene graph, accumulates world-space matrices.
 *   - For each `seg-NAME` group, finds its mesh children and pulls vertex
 *     positions from the binary buffer.
 *   - Transforms vertices to world Three.js coords, then converts back to
 *     NED metres (inverse of `nedToThreeJS({x,y,z}) = (-y, -z, x)`).
 *   - Optionally divides by `--pilot-scale` (default 1.0666666666666667 —
 *     the wingsuit MODEL_SCALE used by the polar visualizer at export time).
 *   - Prints, per segment: AABB in NED, centroid, and (for the custom
 *     prism meshes) the 8 corner vertices in canonical order so a fresh
 *     `BoxSpec` / `TrianglePrismSpec` / `SweptWingSpec` can be authored.
 *
 * Usage:
 *   node tools/extract-wingsuit-wireframe.mjs path/to/edited.glb [--pilot-scale 1.0666666666666667]
 */

import { readFileSync } from 'node:fs'
import { argv } from 'node:process'

// ── arg parse ───────────────────────────────────────────────────────────
const args = argv.slice(2)
if (args.length < 1) {
  console.error('Usage: node tools/extract-wingsuit-wireframe.mjs <path.glb> [--pilot-scale N]')
  process.exit(2)
}
const glbPath = args[0]
let pilotScale = 1.0666666666666667
const psIdx = args.indexOf('--pilot-scale')
if (psIdx >= 0) pilotScale = parseFloat(args[psIdx + 1])

// ── parse glb ───────────────────────────────────────────────────────────
const bytes = readFileSync(glbPath)
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a glb (bad magic)')
const totalLen = dv.getUint32(8, true)
let off = 12
const chunks = []
while (off < totalLen) {
  const cl = dv.getUint32(off, true)
  const ct = dv.getUint32(off + 4, true)
  chunks.push({ type: ct, offset: off + 8, length: cl })
  off += 8 + cl
}
const jsonChunk = chunks.find(c => c.type === 0x4e4f534a) // 'JSON'
const binChunk = chunks.find(c => c.type === 0x004e4942) // 'BIN\0'
if (!jsonChunk) throw new Error('No JSON chunk')
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonChunk.offset, jsonChunk.offset + jsonChunk.length)))
const bin = binChunk ? bytes.subarray(binChunk.offset, binChunk.offset + binChunk.length) : null

// ── matrix helpers (column-major 4×4, glTF convention) ──────────────────
const mat4 = {
  identity: () => Float64Array.of(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1),
  fromTRS(t = [0,0,0], r = [0,0,0,1], s = [1,1,1]) {
    const [x,y,z,w] = r
    const xx=x*x, yy=y*y, zz=z*z, xy=x*y, xz=x*z, yz=y*z, wx=w*x, wy=w*y, wz=w*z
    return Float64Array.of(
      (1-2*(yy+zz))*s[0], (2*(xy+wz))*s[0], (2*(xz-wy))*s[0], 0,
      (2*(xy-wz))*s[1], (1-2*(xx+zz))*s[1], (2*(yz+wx))*s[1], 0,
      (2*(xz+wy))*s[2], (2*(yz-wx))*s[2], (1-2*(xx+yy))*s[2], 0,
      t[0], t[1], t[2], 1,
    )
  },
  mul(a, b) {
    const r = new Float64Array(16)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k*4 + j] * b[i*4 + k]
      r[i*4 + j] = s
    }
    return r
  },
  transformPoint(m, [x,y,z]) {
    return [
      m[0]*x + m[4]*y + m[8]*z + m[12],
      m[1]*x + m[5]*y + m[9]*z + m[13],
      m[2]*x + m[6]*y + m[10]*z + m[14],
    ]
  },
}

function nodeMatrix(n) {
  if (n.matrix) return Float64Array.from(n.matrix)
  return mat4.fromTRS(n.translation, n.rotation, n.scale)
}

// ── accessor reader (FLOAT VEC3 only, sufficient for POSITION) ──────────
function readVec3Accessor(idx) {
  const acc = json.accessors[idx]
  const bv = json.bufferViews[acc.bufferView]
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || 12
  const out = []
  for (let i = 0; i < acc.count; i++) {
    const o = start + i * stride
    out.push([
      bin.readFloatLE(o),
      bin.readFloatLE(o + 4),
      bin.readFloatLE(o + 8),
    ])
  }
  return out
}

// ── walk scene, find seg-* groups ───────────────────────────────────────
const sceneNodes = json.scenes[json.scene].nodes
const segments = []  // { name, worldMatrix, meshes: [{name, worldMatrix, verts}] }

function walk(nodeIdx, parentMatrix, currentSegName, currentSegMatrix) {
  const node = json.nodes[nodeIdx]
  const local = nodeMatrix(node)
  const world = mat4.mul(parentMatrix, local)
  const name = node.name || `node-${nodeIdx}`

  let segName = currentSegName
  let segMatrix = currentSegMatrix
  if (name.startsWith('seg-')) {
    segName = name.slice(4)
    segMatrix = world
    segments.push({ name: segName, worldMatrix: world, meshes: [] })
  }

  if (typeof node.mesh === 'number' && segName) {
    const mesh = json.meshes[node.mesh]
    const prim = mesh.primitives[0]
    const posIdx = prim.attributes.POSITION
    const verts = readVec3Accessor(posIdx)
    const transformed = verts.map(v => mat4.transformPoint(world, v))
    segments[segments.length - 1].meshes.push({
      name, meshIdx: node.mesh, worldVerts: transformed, vertCount: verts.length,
    })
  }

  if (node.children) {
    for (const c of node.children) walk(c, world, segName, segMatrix)
  }
}

const root = mat4.identity()
for (const n of sceneNodes) walk(n, root, null, null)

// ── convert world Three.js → NED metres, divide by pilotScale ───────────
//   nedToThreeJS({x,y,z}) = (-y, -z, x)  →  inverse:  NED = (W.z, -W.x, -W.y)
//   Then divide by pilotScale to undo the per-segment scale baked at export.
function threeWorldToNED([wx, wy, wz]) {
  return [wz / pilotScale, -wx / pilotScale, -wy / pilotScale]
}

function aabb(points) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < 3; i++) {
    if (p[i] < min[i]) min[i] = p[i]
    if (p[i] > max[i]) max[i] = p[i]
  }
  const size = [max[0]-min[0], max[1]-min[1], max[2]-min[2]]
  const ctr = [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2]
  return { min, max, size, center: ctr }
}

const fmt = (v, d=3) => v.toFixed(d).padStart(7)
const fmt3 = (p) => `(${fmt(p[0])}, ${fmt(p[1])}, ${fmt(p[2])})`

console.log(`\n=== Wingsuit wireframe extraction ===`)
console.log(`File:        ${glbPath}`)
console.log(`pilotScale:  ${pilotScale}`)
console.log(`Segments:    ${segments.map(s => s.name).join(', ')}`)
console.log(`Axis convention printed below: NED metres ` +
  `(x = fore +, y = right +, z = down +).\n`)

const reportSegments = []

for (const seg of segments) {
  const allNED = []
  const meshSummaries = []
  for (const m of seg.meshes) {
    const ned = m.worldVerts.map(threeWorldToNED)
    const bb = aabb(ned)
    allNED.push(...ned)
    // Unique vertex count: for our custom prism builders we wrote 8 verts;
    // for THREE.BoxGeometry we wrote 24 (with normal-split duplicates).
    const isPrism = ned.length === 8
    meshSummaries.push({ name: m.name, count: ned.length, bb, ned, isPrism })
  }
  const segBB = aabb(allNED)
  // World-space NED of the segment's reference position (origin of seg-group)
  const segOriginThree = [seg.worldMatrix[12], seg.worldMatrix[13], seg.worldMatrix[14]]
  const segOriginNED = threeWorldToNED(segOriginThree)

  console.log(`── ${seg.name} ──`)
  console.log(`  seg origin  (NED m): ${fmt3(segOriginNED)}`)
  console.log(`  segment AABB (NED):  min ${fmt3(segBB.min)}  max ${fmt3(segBB.max)}`)
  console.log(`  segment size:        chord(x)=${fmt(segBB.size[0])}  span(y)=${fmt(segBB.size[1])}  thick(z)=${fmt(segBB.size[2])}`)
  for (const m of meshSummaries) {
    console.log(`  mesh "${m.name}" [${m.count} verts] AABB:`)
    console.log(`     min ${fmt3(m.bb.min)}  max ${fmt3(m.bb.max)}`)
    console.log(`     size ${fmt3(m.bb.size)}  center ${fmt3(m.bb.center)}`)
    if (m.isPrism) {
      // Canonical 8-vertex order from buildPrismMeshFromVertsNED:
      //   0 fwd-L top  1 fwd-R top  2 aft-R top  3 aft-L top
      //   4 fwd-L bot  5 fwd-R bot  6 aft-R bot  7 aft-L bot
      // (forward = high NED.x;  L = +y;  top = low NED.z)
      const labels = ['fwd-L top', 'fwd-R top', 'aft-R top', 'aft-L top',
                       'fwd-L bot', 'fwd-R bot', 'aft-R bot', 'aft-L bot']
      console.log(`     8 corner vertices (NED m, world-space):`)
      for (let i = 0; i < 8; i++) {
        console.log(`       [${i}] ${labels[i].padEnd(10)} ${fmt3(m.ned[i])}`)
      }
      // Refit hint: for the "swept-wing-xy" pattern the vertex layout is
      //   0 inboard-LE top  1 outboard-LE top  2 outboard-TE top  3 inboard-TE top
      // That maps onto the same indices.  Print the values that would go into the spec.
      const v = m.ned
      const xLeIn  = v[0][0], xLeOut = v[1][0], xTeOut = v[2][0], xTeIn = v[3][0]
      const yIn    = (v[0][1] + v[3][1]) / 2 - segOriginNED[1]
      const yOut   = (v[1][1] + v[2][1]) / 2 - segOriginNED[1]
      const yTeIn  = v[3][1] - segOriginNED[1]
      const yTeOut = v[2][1] - segOriginNED[1]
      const thickness = v[4][2] - v[0][2]
      const zCenter   = (v[0][2] + v[4][2]) / 2 - segOriginNED[2]
      console.log(`     swept-wing fit (rel to seg origin):`)
      console.log(`       yIn=${fmt(yIn)}  yOut=${fmt(yOut)}`)
      console.log(`       xLeIn=${fmt(xLeIn - segOriginNED[0])}  xLeOut=${fmt(xLeOut - segOriginNED[0])}`)
      console.log(`       xTeIn=${fmt(xTeIn - segOriginNED[0])}  xTeOut=${fmt(xTeOut - segOriginNED[0])}`)
      console.log(`       yTeIn=${fmt(yTeIn)}  yTeOut=${fmt(yTeOut)}`)
      console.log(`       thickness=${fmt(thickness)}  zCenter=${fmt(zCenter)}`)
    }
  }
  console.log()
  reportSegments.push({
    name: seg.name,
    originNED: segOriginNED,
    aabbNED: segBB,
    meshes: meshSummaries.map(m => ({
      name: m.name, count: m.count,
      aabb: m.bb,
      ned: m.ned,
    })),
  })
}

// Save raw JSON beside the input for downstream tooling.
const outPath = glbPath.replace(/\.glb$/i, '') + '.extracted.json'
const fs = await import('node:fs')
fs.writeFileSync(outPath, JSON.stringify({
  source: glbPath,
  pilotScale,
  segments: reportSegments,
}, null, 2))
console.log(`Wrote raw extraction → ${outPath}`)
