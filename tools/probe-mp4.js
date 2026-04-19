// Probe MP4 and INSV files for timing metadata
const fs = require('fs');

const editDir = 'C:\\Users\\hartm\\OneDrive\\Wingsuit Science\\china\\dashanbao\\dashinbao\\edit\\25-05-03\\05-03-2025-2';
const mp4Path = editDir + '\\VID_20250503_161157_00_016(1).mp4';
const insvPath = editDir + '\\VID_20250503_161157_00_016.insv';
const lrvPath = editDir + '\\LRV_20250503_161157_01_016.lrv';

function readAtOffset(filePath, offset, length) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, offset);
  fs.closeSync(fd);
  return buf;
}

function hexDump(buf, maxRows = 20) {
  for (let row = 0; row < buf.length && row / 16 < maxRows; row += 16) {
    const hex = [];
    const ascii = [];
    for (let c = 0; c < 16 && row + c < buf.length; c++) {
      hex.push(buf[row + c].toString(16).padStart(2, '0'));
      const ch = buf[row + c];
      ascii.push(ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '.');
    }
    console.log(hex.join(' ').padEnd(48) + '  ' + ascii.join(''));
  }
}

function findAtoms(buf, startOffset = 0) {
  const atoms = [];
  let off = startOffset;
  while (off < buf.length - 8) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (size < 8 || off + size > buf.length + 1000000) break;
    atoms.push({ offset: off, size, type });
    off += size;
  }
  return atoms;
}

// ── MP4 udta/meta content ──
console.log('=== MP4 FILE ===');
const mp4Stat = fs.statSync(mp4Path);
console.log('Size:', mp4Stat.size, 'bytes');

// Read last 1KB
const mp4Tail = readAtOffset(mp4Path, mp4Stat.size - 1024, 1024);
// Find udta
const udtaIdx = mp4Tail.indexOf('udta');
if (udtaIdx >= 0) {
  const udtaOff = udtaIdx - 4;
  console.log('\n--- UDTA content ---');
  hexDump(mp4Tail.slice(udtaOff), 15);
}

// ── INSV file ──
console.log('\n=== INSV FILE ===');
const insvStat = fs.statSync(insvPath);
console.log('Size:', insvStat.size, 'bytes');

// Read first 64KB to get top-level atoms
const insvHead = readAtOffset(insvPath, 0, 65536);
const topAtoms = findAtoms(insvHead);
console.log('Top-level atoms (from header):');
topAtoms.forEach(a => console.log('  ' + a.type + ' offset:' + a.offset + ' size:' + a.size));

// Read last 256KB to find moov and inst atoms  
const insvTailSize = Math.min(512 * 1024, insvStat.size);
const insvTail = readAtOffset(insvPath, insvStat.size - insvTailSize, insvTailSize);

// Search for moov in tail
const moovIdx = insvTail.indexOf('moov');
if (moovIdx >= 0) {
  const moovOff = moovIdx - 4;
  const moovSize = insvTail.readUInt32BE(moovOff);
  console.log('\nFound moov at file offset:', (insvStat.size - insvTailSize + moovOff), 'size:', moovSize);
  
  // Parse mvhd inside moov
  let off = moovOff + 8;
  const moovEnd = moovOff + Math.min(moovSize, insvTailSize - moovOff);
  while (off < moovEnd - 8) {
    const aSize = insvTail.readUInt32BE(off);
    const aType = insvTail.toString('ascii', off + 4, off + 8);
    if (aSize < 8) break;
    
    if (aType === 'mvhd') {
      const version = insvTail[off + 8];
      let creationTime, timescale, duration;
      if (version === 0) {
        creationTime = insvTail.readUInt32BE(off + 12);
        timescale = insvTail.readUInt32BE(off + 20);
        duration = insvTail.readUInt32BE(off + 24);
      }
      const mp4Epoch = Date.UTC(1904, 0, 1) / 1000;
      console.log('INSV MVHD:');
      console.log('  creation_utc:', new Date((creationTime + mp4Epoch) * 1000).toISOString());
      console.log('  timescale:', timescale);
      console.log('  duration_ticks:', duration);
      console.log('  duration_seconds:', (duration / timescale).toFixed(3));
      off += aSize;
    } else if (aType === 'trak' || aType === 'mdia' || aType === 'minf' || aType === 'stbl' || aType === 'udta' || aType === 'edts') {
      off += 8; // enter container
    } else if (aType === 'mdhd') {
      const version = insvTail[off + 8];
      if (version === 0) {
        const ts = insvTail.readUInt32BE(off + 20);
        const dur = insvTail.readUInt32BE(off + 24);
        console.log('  MDHD: timescale=' + ts + ' duration=' + dur + ' seconds=' + (dur/ts).toFixed(3));
      }
      off += aSize;
    } else if (aType === 'hdlr') {
      const ht = insvTail.toString('ascii', off + 16, off + 20);
      console.log('  HDLR: handler=' + ht);
      off += aSize;
    } else if (aType === 'tkhd') {
      const version = insvTail[off + 8];
      if (version === 0) {
        const ct = insvTail.readUInt32BE(off + 12);
        const dur = insvTail.readUInt32BE(off + 28);
        const mp4Epoch = Date.UTC(1904, 0, 1) / 1000;
        const w = insvTail.readUInt32BE(off + 84);
        const h = insvTail.readUInt32BE(off + 88);
        console.log('  TKHD: creation=' + new Date((ct + mp4Epoch) * 1000).toISOString() +
          ' dur=' + dur + ' res=' + (w>>16) + 'x' + (h>>16));
      }
      off += aSize;
    } else {
      off += aSize;
    }
  }
}

// Find inst atom
const instIdx = insvTail.indexOf('inst');
if (instIdx >= 0) {
  // Check if this looks like the inst atom at the end
  const instFileOff = insvStat.size - insvTailSize + instIdx;
  console.log('\nFound "inst" at file offset:', instFileOff);
  
  // Read the last 128 bytes for the trailer
  const trailer = readAtOffset(insvPath, insvStat.size - 128, 128);
  console.log('\n--- Last 128 bytes (trailer) ---');
  hexDump(trailer, 8);
  
  // Check for the magic string
  const trailerStr = trailer.toString('ascii');
  if (trailerStr.includes('8db42d')) {
    console.log('\nMagic phrase found!');
    // Read size fields before magic
    const magicIdx = trailer.indexOf('8db42d');
    if (magicIdx >= 8) {
      const contentSize = trailer.readUInt32LE(magicIdx - 8);
      const count = trailer.readUInt32LE(magicIdx - 4);
      console.log('inst content_size:', contentSize, 'count:', count);
    }
  }
}

// ── LRV file ──
console.log('\n=== LRV FILE ===');
const lrvStat = fs.statSync(lrvPath);
console.log('Size:', lrvStat.size, 'bytes');

// Check LRV tail for inst atom or edit markers
const lrvTailSize = Math.min(256 * 1024, lrvStat.size);
const lrvTail = readAtOffset(lrvPath, lrvStat.size - lrvTailSize, lrvTailSize);

const lrvMoovIdx = lrvTail.indexOf('moov');
if (lrvMoovIdx >= 0) {
  const lrvMoovOff = lrvMoovIdx - 4;
  const lrvMoovSize = lrvTail.readUInt32BE(lrvMoovOff);
  console.log('Found moov at file offset:', (lrvStat.size - lrvTailSize + lrvMoovOff), 'size:', lrvMoovSize);
  
  let off = lrvMoovOff + 8;
  const moovEnd = lrvMoovOff + Math.min(lrvMoovSize, lrvTailSize - lrvMoovOff);
  while (off < moovEnd - 8) {
    const aSize = lrvTail.readUInt32BE(off);
    const aType = lrvTail.toString('ascii', off + 4, off + 8);
    if (aSize < 8) break;
    
    if (aType === 'mvhd') {
      const version = lrvTail[off + 8];
      if (version === 0) {
        const creationTime = lrvTail.readUInt32BE(off + 12);
        const timescale = lrvTail.readUInt32BE(off + 20);
        const duration = lrvTail.readUInt32BE(off + 24);
        const mp4Epoch = Date.UTC(1904, 0, 1) / 1000;
        console.log('LRV MVHD:');
        console.log('  creation_utc:', new Date((creationTime + mp4Epoch) * 1000).toISOString());
        console.log('  timescale:', timescale);
        console.log('  duration_seconds:', (duration / timescale).toFixed(3));
      }
      off += aSize;
    } else if (aType === 'trak' || aType === 'mdia' || aType === 'minf' || aType === 'stbl' || aType === 'udta' || aType === 'edts') {
      off += 8;
    } else {
      off += aSize;
    }
  }
}

// Check LRV for inst atom
const lrvInstIdx = lrvTail.indexOf('inst');
if (lrvInstIdx >= 0) {
  console.log('Found "inst" in LRV at offset:', (lrvStat.size - lrvTailSize + lrvInstIdx));
  
  const lrvTrailer = readAtOffset(lrvPath, lrvStat.size - 128, 128);
  console.log('--- LRV last 128 bytes ---');
  hexDump(lrvTrailer, 8);
  const lrvTrailerStr = lrvTrailer.toString('ascii');
  if (lrvTrailerStr.includes('8db42d')) {
    console.log('Magic phrase found in LRV!');
    const magicIdx = lrvTrailer.indexOf('8db42d');
    if (magicIdx >= 8) {
      const contentSize = lrvTrailer.readUInt32LE(magicIdx - 8);
      const count = lrvTrailer.readUInt32LE(magicIdx - 4);
      console.log('LRV inst content_size:', contentSize, 'count:', count);
    }
  }
}

// ── Compare timestamps ──
console.log('\n=== TIMING COMPARISON ===');
console.log('INSV filename timestamp: 2025-05-03 16:11:57 (local China CST = UTC+8)');
console.log('Equivalent UTC: 2025-05-03T08:11:57Z');
console.log('MP4 creation_utc: 2025-05-03T08:11:57Z');
console.log('=> MP4 creation time = ORIGINAL recording start (NOT trim start)');
console.log('');
console.log('MP4 duration: 11.044 seconds (trimmed)');
console.log('If INSV duration >> MP4 duration, the trim range is lost in metadata');
