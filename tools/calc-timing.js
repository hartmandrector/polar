/**
 * calc-timing.js — Insta360 ↔ FlySight sync calculator
 *
 * Usage:
 *   node tools/calc-timing.js <edit-folder> [--scheme <name>] [--json]
 *
 * Auto-discovers:
 *   - INSV file → extracts creation_time from moov/mvhd
 *   - TRACK.CSV → GPS start epoch from first $GNSS record
 *   - .insprj project file → schemes, trim ranges, keyframes
 *
 * Outputs timing chain + keyframes converted to GPS pipeline time.
 * With --json, writes sync-result.json to the edit folder.
 */
const fs = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const editDir = args.find(a => !a.startsWith('--'));
const schemeArg = args.indexOf('--scheme') >= 0 ? args[args.indexOf('--scheme') + 1] : null;
const jsonOut = args.includes('--json');

if (!editDir) {
  console.error('Usage: node tools/calc-timing.js <edit-folder> [--scheme <name>] [--json]');
  process.exit(1);
}

if (!fs.existsSync(editDir)) {
  console.error('Edit folder not found:', editDir);
  process.exit(1);
}

// ── File discovery ────────────────────────────────────────────────────────

function findFile(dir, pattern) {
  const files = fs.readdirSync(dir);
  return files.find(f => pattern.test(f));
}

const insvFile = findFile(editDir, /^VID_.*\.insv$/i);
if (!insvFile) {
  console.error('No .insv file found in', editDir);
  process.exit(1);
}
const insvPath = path.join(editDir, insvFile);

const trackFile = findFile(editDir, /^TRACK\.CSV$/i);
if (!trackFile) {
  console.error('No TRACK.CSV found in', editDir);
  process.exit(1);
}
const trackPath = path.join(editDir, trackFile);

console.log('INSV:', insvFile);
console.log('GPS:', trackFile);

// ── Extract INSV creation_time from moov/mvhd ────────────────────────────

function extractInsvCreationEpoch(filePath) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');

  // Scan top-level atoms to find moov offset
  // Atoms: ftyp, [wide], mdat (may use 64-bit size), moov, inst
  let off = 0;
  let moovOffset = -1;
  const hdr = Buffer.alloc(16);

  while (off < stat.size - 8) {
    fs.readSync(fd, hdr, 0, 16, off);
    let sz = hdr.readUInt32BE(0);
    const type = hdr.toString('ascii', 4, 8);

    if (sz === 1) {
      // 64-bit extended size
      sz = Number(hdr.readBigUInt64BE(8));
    } else if (sz === 0) {
      break; // atom extends to EOF
    }

    if (type === 'moov') {
      moovOffset = off;
      break;
    }

    if (type === 'wide') {
      off += 8;
    } else {
      off += sz;
    }
  }

  if (moovOffset < 0) {
    fs.closeSync(fd);
    throw new Error('moov atom not found in INSV');
  }

  // Read moov header + first 4KB to get mvhd
  const moovBuf = Buffer.alloc(4096);
  fs.readSync(fd, moovBuf, 0, 4096, moovOffset);
  fs.closeSync(fd);

  const moovSize = moovBuf.readUInt32BE(0);
  let mOff = 8; // skip moov header
  const moovEnd = Math.min(moovSize, 4096);

  while (mOff < moovEnd - 8) {
    const aSize = moovBuf.readUInt32BE(mOff);
    const aType = moovBuf.toString('ascii', mOff + 4, mOff + 8);
    if (aSize < 8) break;

    if (aType === 'mvhd') {
      const version = moovBuf[mOff + 8];
      if (version === 0) {
        const creationTime = moovBuf.readUInt32BE(mOff + 12);
        const timescale = moovBuf.readUInt32BE(mOff + 20);
        const duration = moovBuf.readUInt32BE(mOff + 24);
        const mp4Epoch = Date.UTC(1904, 0, 1) / 1000;
        return {
          creationEpochMs: (creationTime + mp4Epoch) * 1000,
          durationMs: Math.round(duration / timescale * 1000),
        };
      }
      break;
    }

    // Enter container atoms, skip leaf atoms
    if (['trak', 'mdia', 'minf', 'stbl', 'udta', 'edts'].includes(aType)) {
      mOff += 8;
    } else {
      mOff += aSize;
    }
  }
  throw new Error('mvhd not found in moov');
}

const insv = extractInsvCreationEpoch(insvPath);
console.log('INSV creation:', new Date(insv.creationEpochMs).toISOString());
console.log('INSV duration:', (insv.durationMs / 1000).toFixed(3) + 's');

// ── Parse FlySight TRACK.CSV for GPS start epoch ──────────────────────────

function parseGpsStartEpoch(trackPath) {
  const text = fs.readFileSync(trackPath, 'utf-8');
  const lines = text.split('\n');
  const gnss = lines.filter(l => l.startsWith('$GNSS'));
  if (gnss.length === 0) throw new Error('No $GNSS records in TRACK.CSV');
  const first = gnss[0].split(',')[1];
  const last = gnss[gnss.length - 1].split(',')[1];
  return {
    startEpochMs: new Date(first).getTime(),
    endEpochMs: new Date(last).getTime(),
    records: gnss.length,
  };
}

const gps = parseGpsStartEpoch(trackPath);
console.log('GPS start:', new Date(gps.startEpochMs).toISOString());
console.log('GPS end:', new Date(gps.endEpochMs).toISOString());
console.log('GPS records:', gps.records, '(' + ((gps.endEpochMs - gps.startEpochMs) / 1000).toFixed(1) + 's)');

const insvOffsetS = (insv.creationEpochMs - gps.startEpochMs) / 1000;
console.log('\nINSV starts ' + insvOffsetS.toFixed(1) + 's after GPS start');

// ── Find and parse .insprj project file ───────────────────────────────────

function findInsprj(insvFilename) {
  const studioProjectDir = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Documents', 'Insta360', 'Studio', 'Project'
  );
  if (!fs.existsSync(studioProjectDir)) return null;

  // Search all hash directories for matching .insprj
  const target = insvFilename + '.insprj';
  const hashDirs = fs.readdirSync(studioProjectDir);
  for (const dir of hashDirs) {
    const fullDir = path.join(studioProjectDir, dir);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    const projFile = path.join(fullDir, target);
    if (fs.existsSync(projFile)) return projFile;
  }
  return null;
}

function parseInsprj(projPath) {
  const xml = fs.readFileSync(projPath, 'utf-8');

  // Extract default scheme
  const defaultMatch = xml.match(/default="([^"]+)"/);
  const defaultScheme = defaultMatch ? defaultMatch[1] : null;

  // Split by scheme tags and parse each
  const schemes = [];
  const schemeRegex = /<scheme\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/scheme>/g;
  let match;
  while ((match = schemeRegex.exec(xml)) !== null) {
    const id = match[1];
    const body = match[2];

    // Trim info from <preference>
    const trimStart = parseInt((body.match(/trim_start="(\d+)"/) || [])[1]) || 0;
    const trimEnd = parseInt((body.match(/trim_end="(\d+)"/) || [])[1]) || 0;
    const duration = parseInt((body.match(/duration="(\d+)"/) || [])[1]) || 0;
    const ratio_w = parseInt((body.match(/ratio_width="(\d+)"/) || [])[1]) || 16;
    const ratio_h = parseInt((body.match(/ratio_height="(\d+)"/) || [])[1]) || 9;

    // Parse keyframes from <keyframes> section
    const keyframes = [];
    const kfRegex = /<keyframe\s([^\/]+)\/>/g;
    let kfMatch;
    while ((kfMatch = kfRegex.exec(body)) !== null) {
      const attrs = kfMatch[1];
      const attr = (name) => {
        const m = attrs.match(new RegExp(name + '="([^"]*)"'));
        return m ? m[1] : null;
      };
      keyframes.push({
        id: attr('id'),
        time: parseInt(attr('time')) || 0,
        pan: parseFloat(attr('pan')) || 0,
        tilt: parseFloat(attr('tilt')) || 0,
        roll: parseFloat(attr('roll')) || 0,
        fov: parseFloat(attr('fov')) || 0,
        distance: parseFloat(attr('distance')) || 0,
        view_mode: parseInt(attr('view_mode')) || 0,
      });
    }

    // Parse transitions to get playback order
    const transitions = [];
    const trRegex = /connection="([^"]+)"/g;
    let trMatch;
    while ((trMatch = trRegex.exec(body)) !== null) {
      transitions.push(trMatch[1]); // e.g. "point1-point2"
    }

    // Sort keyframes by transition order if we have transitions
    let ordered = keyframes;
    if (transitions.length > 0) {
      const order = [];
      // First keyframe is the first part of the first transition
      const firstTr = transitions[0].split('-');
      order.push(firstTr[0]);
      for (const tr of transitions) {
        const parts = tr.split('-');
        order.push(parts[1]);
      }
      const byId = new Map(keyframes.map(kf => [kf.id, kf]));
      ordered = order.filter(id => byId.has(id)).map(id => byId.get(id));
      // Add any keyframes not in transitions (shouldn't happen, but safe)
      for (const kf of keyframes) {
        if (!order.includes(kf.id)) ordered.push(kf);
      }
    } else {
      // Sort by time
      ordered.sort((a, b) => a.time - b.time);
    }

    schemes.push({
      id,
      trimStart,
      trimEnd,
      duration,
      trimDuration: trimEnd - trimStart,
      aspectRatio: ratio_w + ':' + ratio_h,
      keyframes: ordered,
      transitions,
      isDefault: id === defaultScheme,
    });
  }

  return { defaultScheme, schemes };
}

const insprjPath = findInsprj(insvFile);
if (!insprjPath) {
  console.error('\nNo .insprj project file found for', insvFile);
  console.error('Looked in:', path.join(process.env.USERPROFILE || '', 'Documents', 'Insta360', 'Studio', 'Project'));
  process.exit(1);
}
console.log('\nProject file:', insprjPath);

const project = parseInsprj(insprjPath);
console.log('Default scheme:', project.defaultScheme);
console.log('Schemes found:', project.schemes.length);

// ── Select scheme ─────────────────────────────────────────────────────────

console.log('\n=== ALL SCHEMES ===');
for (const s of project.schemes) {
  const pStart = (insv.creationEpochMs + s.trimStart - gps.startEpochMs) / 1000;
  const pEnd = (insv.creationEpochMs + s.trimEnd - gps.startEpochMs) / 1000;
  const marker = s.isDefault ? ' ← DEFAULT' : '';
  console.log(
    `  ${s.id}: trim ${(s.trimStart/1000).toFixed(1)}s→${(s.trimEnd/1000).toFixed(1)}s` +
    ` (${(s.trimDuration/1000).toFixed(1)}s) → pipeline ${pStart.toFixed(1)}s→${pEnd.toFixed(1)}s` +
    ` [${s.aspectRatio}] ${s.keyframes.length} keyframes${marker}`
  );
}

const scheme = schemeArg
  ? project.schemes.find(s => s.id === schemeArg)
  : project.schemes.find(s => s.isDefault) || project.schemes[0];

if (!scheme) {
  console.error('Scheme not found:', schemeArg);
  console.error('Available:', project.schemes.map(s => s.id).join(', '));
  process.exit(1);
}

console.log('\n=== SELECTED SCHEME: ' + scheme.id + ' ===');
console.log('Trim: ' + (scheme.trimStart / 1000).toFixed(3) + 's → ' + (scheme.trimEnd / 1000).toFixed(3) + 's');
console.log('Duration: ' + (scheme.trimDuration / 1000).toFixed(3) + 's');
console.log('Aspect ratio: ' + scheme.aspectRatio);

// ── Convert to GPS pipeline time ──────────────────────────────────────────

const pipelineStartS = (insv.creationEpochMs + scheme.trimStart - gps.startEpochMs) / 1000;
const pipelineEndS = (insv.creationEpochMs + scheme.trimEnd - gps.startEpochMs) / 1000;
const frameRate = 60;
const totalFrames = Math.ceil((pipelineEndS - pipelineStartS) * frameRate);

console.log('\n=== GPS PIPELINE TIME ===');
console.log('Start: ' + pipelineStartS.toFixed(3) + 's');
console.log('End:   ' + pipelineEndS.toFixed(3) + 's');
console.log('Frames: ' + totalFrames + ' @ ' + frameRate + 'fps');

// ── Keyframes in GPS pipeline time ────────────────────────────────────────

console.log('\n=== KEYFRAMES (transition order) ===');
const pipelineKeyframes = scheme.keyframes.map(kf => {
  const pipelineTime = (insv.creationEpochMs + kf.time - gps.startEpochMs) / 1000;
  const clipTime = (kf.time - scheme.trimStart) / 1000; // seconds from clip start
  return {
    id: kf.id,
    insv_time_ms: kf.time,
    clip_time_s: parseFloat(clipTime.toFixed(3)),
    pipeline_time_s: parseFloat(pipelineTime.toFixed(3)),
    pan: kf.pan,
    tilt: kf.tilt,
    roll: kf.roll,
    fov: kf.fov,
    distance: kf.distance,
  };
});

for (const kf of pipelineKeyframes) {
  const inTrim = kf.insv_time_ms >= scheme.trimStart && kf.insv_time_ms <= scheme.trimEnd;
  console.log(
    `  ${kf.id.padEnd(8)} clip:${kf.clip_time_s.toFixed(2).padStart(7)}s` +
    `  pipeline:${kf.pipeline_time_s.toFixed(2).padStart(8)}s` +
    `  pan=${kf.pan.toFixed(3).padStart(7)} tilt=${kf.tilt.toFixed(3).padStart(7)}` +
    `  fov=${kf.fov.toFixed(3).padStart(6)}` +
    (inTrim ? '' : '  [outside trim]')
  );
}

// ── Transition order ──────────────────────────────────────────────────────

if (scheme.transitions.length > 0) {
  console.log('\nTransition order: ' + scheme.transitions.join(' → '));
}

// ── Playwright URL ────────────────────────────────────────────────────────

console.log('\n=== PLAYWRIGHT CAPTURE URL PARAMS ===');
console.log('startTime=' + pipelineStartS.toFixed(3));
console.log('endTime=' + pipelineEndS.toFixed(3));
console.log('frameRate=' + frameRate);
console.log('totalFrames=' + totalFrames);

// ── JSON output ───────────────────────────────────────────────────────────

if (jsonOut) {
  const result = {
    insv_file: insvFile,
    scheme: scheme.id,
    aspect_ratio: scheme.aspectRatio,
    insv_creation_epoch_ms: insv.creationEpochMs,
    insv_duration_ms: insv.durationMs,
    gps_start_epoch_ms: gps.startEpochMs,
    gps_end_epoch_ms: gps.endEpochMs,
    trim_start_insv_ms: scheme.trimStart,
    trim_end_insv_ms: scheme.trimEnd,
    pipeline_start_s: parseFloat(pipelineStartS.toFixed(3)),
    pipeline_end_s: parseFloat(pipelineEndS.toFixed(3)),
    frame_rate: frameRate,
    total_frames: totalFrames,
    keyframes: pipelineKeyframes,
    transition_order: scheme.transitions,
  };

  const outPath = path.join(editDir, 'sync-result.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('\nWrote:', outPath);
}
