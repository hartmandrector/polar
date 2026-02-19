/**
 * GLB Measurement Script for Three.js Editor
 * ============================================
 * 
 * Usage:
 *   1. Open https://threejs.org/editor/
 *   2. File → Import → select a GLB file
 *   3. Open browser console (F12 → Console tab)
 *   4. Paste this entire script and press Enter
 * 
 * Output: JSON block with all measurements needed for MODEL-GEOMETRY.md
 */

(function measureGLB() {
  // Find the loaded model in the scene
  const root = editor.scene.children.find(c => c.name !== 'Camera' && c.type !== 'AmbientLight' && c.type !== 'DirectionalLight');
  if (!root) {
    console.error('No model found in scene. Import a GLB first.');
    return;
  }

  console.log('=== GLB Measurement: ' + root.name + ' ===\n');

  // ─── Scene tree ───
  console.log('── Scene Tree ──');
  function printTree(obj, indent) {
    const pos = obj.position;
    const rot = obj.rotation;
    const scl = obj.scale;
    const rotDeg = [
      (rot.x * 180 / Math.PI).toFixed(2),
      (rot.y * 180 / Math.PI).toFixed(2),
      (rot.z * 180 / Math.PI).toFixed(2),
    ];
    console.log(
      indent + obj.name + ' (' + obj.type + ')' +
      '  pos(' + pos.x.toFixed(4) + ', ' + pos.y.toFixed(4) + ', ' + pos.z.toFixed(4) + ')' +
      '  rot(' + rotDeg.join('°, ') + '°)' +
      '  scale(' + scl.x.toFixed(4) + ', ' + scl.y.toFixed(4) + ', ' + scl.z.toFixed(4) + ')'
    );
    obj.children.forEach(function(child) { printTree(child, indent + '  '); });
  }
  printTree(root, '');

  // ─── Per-mesh buffer geometry ───
  console.log('\n── Buffer Geometry (per-mesh, pre-transform) ──');
  root.traverse(function(child) {
    if (!child.isMesh) return;
    child.geometry.computeBoundingBox();
    var bb = child.geometry.boundingBox;
    var size = new THREE.Vector3();
    bb.getSize(size);
    var center = new THREE.Vector3();
    bb.getCenter(center);
    console.log('Mesh: ' + child.name);
    console.log('  Vertices: ' + (child.geometry.attributes.position ? child.geometry.attributes.position.count : 'N/A'));
    console.log('  Buffer min: { x: ' + bb.min.x.toFixed(3) + ', y: ' + bb.min.y.toFixed(3) + ', z: ' + bb.min.z.toFixed(3) + ' }');
    console.log('  Buffer max: { x: ' + bb.max.x.toFixed(3) + ', y: ' + bb.max.y.toFixed(3) + ', z: ' + bb.max.z.toFixed(3) + ' }');
    console.log('  Buffer size: { x: ' + size.x.toFixed(3) + ', y: ' + size.y.toFixed(3) + ', z: ' + size.z.toFixed(3) + ' }');
    console.log('  Buffer center: { x: ' + center.x.toFixed(3) + ', y: ' + center.y.toFixed(3) + ', z: ' + center.z.toFixed(3) + ' }');
  });

  // ─── World-space bounding box ───
  console.log('\n── World-Space BBox (after all transforms) ──');
  var worldBox = new THREE.Box3().setFromObject(root);
  var worldSize = worldBox.getSize(new THREE.Vector3());
  var worldCenter = worldBox.getCenter(new THREE.Vector3());
  console.log('BBox min: { x: ' + worldBox.min.x.toFixed(4) + ', y: ' + worldBox.min.y.toFixed(4) + ', z: ' + worldBox.min.z.toFixed(4) + ' }');
  console.log('BBox max: { x: ' + worldBox.max.x.toFixed(4) + ', y: ' + worldBox.max.y.toFixed(4) + ', z: ' + worldBox.max.z.toFixed(4) + ' }');
  console.log('BBox size: { x: ' + worldSize.x.toFixed(4) + ', y: ' + worldSize.y.toFixed(4) + ', z: ' + worldSize.z.toFixed(4) + ' }');
  console.log('BBox center: { x: ' + worldCenter.x.toFixed(4) + ', y: ' + worldCenter.y.toFixed(4) + ', z: ' + worldCenter.z.toFixed(4) + ' }');
  console.log('Max dimension: ' + Math.max(worldSize.x, worldSize.y, worldSize.z).toFixed(4) +
    ' (axis: ' + (worldSize.x >= worldSize.y && worldSize.x >= worldSize.z ? 'X' : worldSize.y >= worldSize.z ? 'Y' : 'Z') + ')');

  // ─── Derived scaling ───
  var maxDim = Math.max(worldSize.x, worldSize.y, worldSize.z);
  var pilotHeight = 1.875;  // A5_HEIGHT — change if not a wingsuit pilot
  var glbToMeters = pilotHeight / maxDim;
  var glbToNED = glbToMeters / pilotHeight;
  console.log('\n── Derived Scaling (assuming pilot height = ' + pilotHeight + ' m) ──');
  console.log('glbToMeters: ' + glbToMeters.toFixed(4) + '  (1 GLB unit = ' + glbToMeters.toFixed(4) + ' m)');
  console.log('glbToNED:    ' + glbToNED.toFixed(4) + '  (1 GLB unit = ' + glbToNED.toFixed(4) + ' NED)');
  console.log('Origin offset from BBox center: { x: ' +
    (-worldCenter.x).toFixed(4) + ', y: ' +
    (-worldCenter.y).toFixed(4) + ', z: ' +
    (-worldCenter.z).toFixed(4) + ' }');

  // ─── Markdown table snippet ───
  console.log('\n── Markdown Table Snippet (copy-paste into MODEL-GEOMETRY.md) ──');
  console.log('| BBox min | { x: ' + worldBox.min.x.toFixed(3) + ', y: ' + worldBox.min.y.toFixed(3) + ', z: ' + worldBox.min.z.toFixed(3) + ' } | World-space |');
  console.log('| BBox max | { x: ' + worldBox.max.x.toFixed(3) + ', y: ' + worldBox.max.y.toFixed(3) + ', z: ' + worldBox.max.z.toFixed(3) + ' } | World-space |');
  console.log('| BBox size | { x: ' + worldSize.x.toFixed(3) + ', y: ' + worldSize.y.toFixed(3) + ', z: ' + worldSize.z.toFixed(3) + ' } | World-space |');
  console.log('| `glbToMeters` | ' + glbToMeters.toFixed(4) + ' | `' + pilotHeight + ' / ' + maxDim.toFixed(3) + '` |');
  console.log('| `glbToNED` | ' + glbToNED.toFixed(4) + ' | `' + glbToMeters.toFixed(4) + ' / ' + pilotHeight + '` |');

  console.log('\n=== Done ===');
})();
