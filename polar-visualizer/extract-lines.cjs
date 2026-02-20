/**
 * Extract line attachment and cascade points from cp2.gltf.
 *
 * For each line mesh (a/b/c/d at ribs 2/4/6/8, upper/lower):
 *   - Find the vertex with maximum Y (canopy / cascade top)
 *   - Find the vertex with minimum Y (cascade bottom / riser)
 *   - Report (X, Y, Z) of each endpoint
 *
 * Run: node extract-lines.cjs
 */
const fs = require('fs');
const path = require('path');

const gltfPath = path.join(__dirname, 'public/models/cp2.gltf');
const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));

// Load binary buffer
const bufferInfo = gltf.buffers[0];
let bufferData;
if (bufferInfo.uri.startsWith('data:')) {
  const base64 = bufferInfo.uri.split(',')[1];
  bufferData = Buffer.from(base64, 'base64');
} else {
  bufferData = fs.readFileSync(path.join(path.dirname(gltfPath), bufferInfo.uri));
}

function readPositionAccessor(accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count;
  const stride = bufferView.byteStride || 12;
  const result = [];
  for (let i = 0; i < count; i++) {
    const off = byteOffset + i * stride;
    result.push({
      x: bufferData.readFloatLE(off),
      y: bufferData.readFloatLE(off + 4),
      z: bufferData.readFloatLE(off + 8),
    });
  }
  return result;
}

function getMeshVertices(meshName) {
  const node = gltf.nodes.find(n => n.name === meshName);
  if (!node) return null;
  const mesh = gltf.meshes[node.mesh];
  const posIdx = mesh.primitives[0].attributes.POSITION;
  return readPositionAccessor(posIdx);
}

/**
 * For a line mesh, find the endpoints:
 * - The vertex with max Y (canopy end or cascade top)
 * - The vertex with min Y (cascade bottom or riser end)
 * Only consider vertices on the RIGHT side (x > 0), or x ≈ 0 for center rib.
 */
function getEndpoints(meshName, ribIdx) {
  const verts = getMeshVertices(meshName);
  if (!verts) return null;

  // Filter to right-side vertices (x >= 0, with small tolerance for center)
  const rightVerts = ribIdx === 1
    ? verts  // center rib: use all
    : verts.filter(v => v.x > 0);

  if (rightVerts.length === 0) return null;

  let topVert = rightVerts[0], botVert = rightVerts[0];
  for (const v of rightVerts) {
    if (v.y > topVert.y) topVert = v;
    if (v.y < botVert.y) botVert = v;
  }
  return { top: topVert, bot: botVert };
}

// Line mesh names
const ribs = [2, 4, 6, 8];
const lines = ['a', 'b', 'c', 'd'];

console.log('=== Line Attachment Points (right side, GLB coords) ===\n');

for (const rib of ribs) {
  console.log(`── Rib ${rib} ──`);

  for (const line of lines) {
    const upperName = `${line}${rib}_upper`;
    const lowerName = `${line}${rib}_lower`;

    const upper = getEndpoints(upperName, rib);
    const lower = getEndpoints(lowerName, rib);

    if (upper) {
      console.log(`  ${upperName}:`);
      console.log(`    Canopy:  X=${upper.top.x.toFixed(4)}, Y=${upper.top.y.toFixed(4)}, Z=${upper.top.z.toFixed(4)}`);
      console.log(`    Cascade: X=${upper.bot.x.toFixed(4)}, Y=${upper.bot.y.toFixed(4)}, Z=${upper.bot.z.toFixed(4)}`);
    } else {
      console.log(`  ${upperName}: NOT FOUND`);
    }

    if (lower) {
      console.log(`  ${lowerName}:`);
      console.log(`    Cascade: X=${lower.top.x.toFixed(4)}, Y=${lower.top.y.toFixed(4)}, Z=${lower.top.z.toFixed(4)}`);
      console.log(`    Riser:   X=${lower.bot.x.toFixed(4)}, Y=${lower.bot.y.toFixed(4)}, Z=${lower.bot.z.toFixed(4)}`);
    }
  }
  console.log();
}

// Also get risers
console.log('── Risers ──');
for (const name of ['Front_Riser', 'Rear_Riser']) {
  const verts = getMeshVertices(name);
  if (!verts) { console.log(`  ${name}: NOT FOUND`); continue; }
  const rightVerts = verts.filter(v => v.x > 0);
  let topVert = rightVerts[0], botVert = rightVerts[0];
  for (const v of rightVerts) {
    if (v.y > topVert.y) topVert = v;
    if (v.y < botVert.y) botVert = v;
  }
  console.log(`  ${name}:`);
  console.log(`    Top:    X=${topVert.x.toFixed(4)}, Y=${topVert.y.toFixed(4)}, Z=${topVert.z.toFixed(4)}`);
  console.log(`    Bottom: X=${botVert.x.toFixed(4)}, Y=${botVert.y.toFixed(4)}, Z=${botVert.z.toFixed(4)}`);
}

// Summary table
console.log('\n=== Summary Table ===\n');
console.log('Rib | Line | Canopy X | Canopy Y | Canopy Z | Cascade X | Cascade Y | Cascade Z');
console.log('----|------|----------|----------|----------|-----------|-----------|----------');
for (const rib of ribs) {
  for (const line of lines) {
    const upperName = `${line}${rib}_upper`;
    const upper = getEndpoints(upperName, rib);
    if (!upper) continue;
    console.log(
      `  ${rib} |    ${line.toUpperCase()} | ` +
      `${upper.top.x.toFixed(3).padStart(8)} | ${upper.top.y.toFixed(3).padStart(8)} | ${upper.top.z.toFixed(3).padStart(8)} | ` +
      `${upper.bot.x.toFixed(3).padStart(9)} | ${upper.bot.y.toFixed(3).padStart(9)} | ${upper.bot.z.toFixed(3).padStart(9)}`
    );
  }
}

// Cascade matching — check that A/B cascades meet, and C/D cascades meet
console.log('\n=== Cascade Junction Verification ===\n');
console.log('Rib | A/B cascade match? | C/D cascade match?');
console.log('----|-------------------|-------------------');
for (const rib of ribs) {
  const aUp = getEndpoints(`a${rib}_upper`, rib);
  const bUp = getEndpoints(`b${rib}_upper`, rib);
  const cUp = getEndpoints(`c${rib}_upper`, rib);
  const dUp = getEndpoints(`d${rib}_upper`, rib);
  const aLo = getEndpoints(`a${rib}_lower`, rib);
  const cLo = getEndpoints(`c${rib}_lower`, rib);

  const abMatch = aUp && bUp ?
    `A.bot=(${aUp.bot.x.toFixed(3)},${aUp.bot.y.toFixed(3)},${aUp.bot.z.toFixed(3)}) B.bot=(${bUp.bot.x.toFixed(3)},${bUp.bot.y.toFixed(3)},${bUp.bot.z.toFixed(3)})` : 'N/A';
  const cdMatch = cUp && dUp ?
    `C.bot=(${cUp.bot.x.toFixed(3)},${cUp.bot.y.toFixed(3)},${cUp.bot.z.toFixed(3)}) D.bot=(${dUp.bot.x.toFixed(3)},${dUp.bot.y.toFixed(3)},${dUp.bot.z.toFixed(3)})` : 'N/A';

  console.log(`  ${rib} | ${abMatch}`);
  console.log(`    | ${cdMatch}`);

  if (aLo) {
    console.log(`    | A/B lower top=(${aLo.top.x.toFixed(3)},${aLo.top.y.toFixed(3)},${aLo.top.z.toFixed(3)}) bot=(${aLo.bot.x.toFixed(3)},${aLo.bot.y.toFixed(3)},${aLo.bot.z.toFixed(3)})`);
  }
  if (cLo) {
    console.log(`    | C/D lower top=(${cLo.top.x.toFixed(3)},${cLo.top.y.toFixed(3)},${cLo.top.z.toFixed(3)}) bot=(${cLo.bot.x.toFixed(3)},${cLo.bot.y.toFixed(3)},${cLo.bot.z.toFixed(3)})`);
  }
}
