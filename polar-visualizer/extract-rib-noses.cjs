/**
 * Extract the nose vertex (max Z) Y coordinate from each rib mesh
 * in the cp2.gltf canopy model.
 *
 * Run: node extract-rib-noses.js
 */
const fs = require('fs');
const path = require('path');

const gltfPath = path.join(__dirname, 'public/models/cp2.gltf');
const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));

// Load the binary buffer
const bufferInfo = gltf.buffers[0];
let bufferData;
if (bufferInfo.uri.startsWith('data:')) {
  // data URI — base64 encoded
  const base64 = bufferInfo.uri.split(',')[1];
  bufferData = Buffer.from(base64, 'base64');
} else {
  bufferData = fs.readFileSync(path.join(path.dirname(gltfPath), bufferInfo.uri));
}

/**
 * Read a GLTF accessor as a Float32Array of [x,y,z] triples.
 */
function readPositionAccessor(accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count; // number of vec3 elements
  const stride = bufferView.byteStride || 12; // 3 * float32 = 12 bytes

  const result = [];
  for (let i = 0; i < count; i++) {
    const off = byteOffset + i * stride;
    const x = bufferData.readFloatLE(off);
    const y = bufferData.readFloatLE(off + 4);
    const z = bufferData.readFloatLE(off + 8);
    result.push({ x, y, z });
  }
  return result;
}

// Find rib meshes
const ribNames = ['Rib_1', 'Rib_2_L', 'Rib_3_L', 'Rib_4_L', 'Rib_5_L', 'Rib_6_L', 'Rib_7_L', 'Rib_8_L'];

console.log('=== Rib Nose Vertices (max Z) ===\n');

for (const ribName of ribNames) {
  const node = gltf.nodes.find(n => n.name === ribName);
  if (!node) { console.log(`${ribName}: NOT FOUND`); continue; }

  const mesh = gltf.meshes[node.mesh];
  // Get position accessor from the first primitive
  const posAccessorIdx = mesh.primitives[0].attributes.POSITION;
  const vertices = readPositionAccessor(posAccessorIdx);

  // Find vertex with maximum Z
  let maxZ = -Infinity;
  let noseY = 0;
  let noseX = 0;

  // Also collect ALL vertices near maxZ (within 0.001) to see the full nose region
  for (const v of vertices) {
    if (v.z > maxZ) {
      maxZ = v.z;
      noseY = v.y;
      noseX = v.x;
    }
  }

  // Find all vertices within 0.005 of maxZ
  const noseRegion = vertices.filter(v => v.z >= maxZ - 0.005);

  console.log(`${ribName}:`);
  console.log(`  Nose vertex: X=${noseX.toFixed(4)}, Y=${noseY.toFixed(4)}, Z=${maxZ.toFixed(4)}`);
  console.log(`  Vertices near nose (z >= ${(maxZ - 0.005).toFixed(3)}):`);
  for (const v of noseRegion) {
    console.log(`    X=${v.x.toFixed(4)}, Y=${v.y.toFixed(4)}, Z=${v.z.toFixed(4)}`);
  }
  console.log();
}
