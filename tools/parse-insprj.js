// Parse Insta360 Studio .insprj file for trim and keyframe data
const fs = require('fs');
const projFile = 'C:\\Users\\hartm\\Documents\\Insta360\\Studio\\Project\\3fa2e52894f25a4d6019008908bdd26e\\VID_20250503_161157_00_016.insv.insprj';
const content = fs.readFileSync(projFile, 'utf-8');

// Extract scheme IDs
const schemes = content.match(/<scheme [^>]+>/g) || [];
for (const s of schemes) {
  const id = (s.match(/id="([^"]+)"/) || [])[1];
  const lastEdit = (s.match(/last_edit_time="([^"]*)"/) || [])[1];
  console.log('Scheme:', id, 'last_edit:', lastEdit);
}

// Extract all preference/trim blocks
const prefs = content.match(/<preference[^>]+>/g) || [];
for (const p of prefs) {
  const dur = (p.match(/duration="(\d+)"/) || [])[1];
  const ts = (p.match(/trim_start="(\d+)"/) || [])[1];
  const te = (p.match(/trim_end="(\d+)"/) || [])[1];
  console.log('  duration:', dur, 'trim_start:', ts, 'trim_end:', te);
  if (ts && te) {
    const trimMs = parseInt(te) - parseInt(ts);
    console.log('  trim_range_ms:', trimMs, '=', (trimMs/1000).toFixed(3), 's');
    console.log('  trim_start_s:', (parseInt(ts)/1000).toFixed(3));
    console.log('  trim_end_s:', (parseInt(te)/1000).toFixed(3));
  }
}

// Extract keyframes
const kfs = content.match(/<keyframe [^\/]+\/>/g) || [];
console.log('\nKeyframes:', kfs.length);
for (const kf of kfs) {
  const time = (kf.match(/time="(\d+)"/) || [])[1];
  const pan = (kf.match(/ pan="([^"]+)"/) || [])[1];
  const tilt = (kf.match(/ tilt="([^"]+)"/) || [])[1];
  const fov = (kf.match(/ fov="([^"]+)"/) || [])[1];
  const id = (kf.match(/id="([^"]+)"/) || [])[1];
  if (time) {
    console.log('  ' + id + ' t=' + time + 'ms (' + (parseInt(time)/1000).toFixed(1) + 's)' +
      ' pan=' + parseFloat(pan).toFixed(2) + ' tilt=' + parseFloat(tilt).toFixed(2) + 
      ' fov=' + parseFloat(fov).toFixed(2));
  }
}

// Check default scheme
const defaultScheme = (content.match(/default="([^"]+)"/) || [])[1];
console.log('\nDefault scheme:', defaultScheme);

// Total recording duration
console.log('\nTotal INSV recording: 435.435s');
console.log('MP4 duration from moov/mvhd: 11.044s');

// For each scheme, compute what this maps to
const trimStart = 298329; // ms
const trimEnd = 363557;   // ms
console.log('\nScheme tt4dl trim: ' + (trimStart/1000).toFixed(1) + 's → ' + (trimEnd/1000).toFixed(1) + 's (' + ((trimEnd-trimStart)/1000).toFixed(1) + 's)');

// Check: does 65.228s ≈ 11.044s? No! So this scheme is NOT the export source
// The MP4 is 11s but the trim range is 65s. The MP4 was exported from a different scheme.
console.log('\nTrim range duration: ' + ((trimEnd-trimStart)/1000).toFixed(3) + 's ≠ MP4 duration 11.044s');
console.log('This scheme is NOT the MP4 export source. Checking other schemes...');

// Let's look at ALL scheme data
console.log('\n=== FULL SCHEME LIST ===');
const fullContent = content;
// Split by scheme tags
const schemeBlocks = fullContent.split(/<scheme /).slice(1);
for (const block of schemeBlocks) {
  const id = (block.match(/id="([^"]+)"/) || [])[1];
  const ts = (block.match(/trim_start="(\d+)"/) || [])[1];
  const te = (block.match(/trim_end="(\d+)"/) || [])[1];
  const dur = (block.match(/duration="(\d+)"/) || [])[1];
  const trimDur = ts && te ? ((parseInt(te) - parseInt(ts))/1000).toFixed(3) : 'N/A';
  console.log('Scheme', id, ': trim_start=' + ts + ' trim_end=' + te + ' duration=' + dur + ' trimDur=' + trimDur + 's');
}
