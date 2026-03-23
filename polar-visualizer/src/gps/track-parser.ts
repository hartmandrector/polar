/**
 * GPS Track Parsers
 * 
 * Supports:
 * - FlySight TRACK.CSV ($GNSS lines, $VAR metadata)
 * - CloudBASE stability CSV (t, V, alpha_deg, ...)
 * - Generic GPS CSV (time, lat, lon, hMSL, velN, velE, velD, ...)
 */

import { GNSSData, TrackDataset, StabilityCSVRow } from './types';

// ============================================================================
// FlySight TRACK.CSV Parser
// ============================================================================

function parseISOTimestamp(isoString: string): number {
  return new Date(isoString).getTime();
}

function parseGNSSLine(parts: string[]): GNSSData | null {
  if (parts.length < 12) return null;

  const isoTime = parts[1];
  const timestamp = parseISOTimestamp(isoTime);
  if (isNaN(timestamp)) return null;

  return {
    type: 'GNSS',
    isoTime,
    timestamp,
    lat: parseFloat(parts[2]),
    lon: parseFloat(parts[3]),
    hMSL: parseFloat(parts[4]),
    velN: parseFloat(parts[5]),
    velE: parseFloat(parts[6]),
    velD: parseFloat(parts[7]),
    hAcc: parseFloat(parts[8]),
    vAcc: parseFloat(parts[9]),
    sAcc: parseFloat(parts[10]),
    numSV: parseInt(parts[11], 10),
  };
}

/** Parse FlySight TRACK.CSV file */
export function parseTrackCSV(content: string): TrackDataset {
  const lines = content.split('\n');
  const dataset: TrackDataset = {
    gnssData: [],
    firmwareVersion: null,
    deviceId: null,
    sessionId: null,
  };

  let inDataSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === '$DATA') {
      inDataSection = true;
      continue;
    }

    if (trimmed.startsWith('$VAR,')) {
      const parts = trimmed.split(',');
      if (parts.length >= 3) {
        const [, varName, varValue] = parts;
        if (varName === 'FIRMWARE_VER') dataset.firmwareVersion = varValue;
        else if (varName === 'DEVICE_ID') dataset.deviceId = varValue;
        else if (varName === 'SESSION_ID') dataset.sessionId = varValue;
      }
      continue;
    }

    if (trimmed.startsWith('$FLYS') || trimmed.startsWith('$COL') || trimmed.startsWith('$UNIT')) {
      continue;
    }

    if (inDataSection && trimmed.startsWith('$GNSS,')) {
      const gnss = parseGNSSLine(trimmed.split(','));
      if (gnss) dataset.gnssData.push(gnss);
    }
  }

  return dataset;
}

// ============================================================================
// Stability CSV Parser
// ============================================================================

/** Parse CloudBASE-exported stability CSV */
export function parseStabilityCSV(content: string): StabilityCSVRow[] {
  const lines = content.split('\n');
  const rows: StabilityCSVRow[] = [];

  // Find column header line (skip # comments)
  let headerLine = '';
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // First non-comment line is header
    headerLine = trimmed;
    dataStart = i + 1;
    break;
  }

  const headers = headerLine.split(',').map(h => h.trim());
  const colIdx = (name: string): number => headers.indexOf(name);

  for (let i = dataStart; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const cols = trimmed.split(',');
    const get = (name: string, fallback = NaN): number => {
      const idx = colIdx(name);
      if (idx < 0 || idx >= cols.length) return fallback;
      const val = parseFloat(cols[idx]);
      return isNaN(val) ? fallback : val;
    };

    rows.push({
      t: get('t'),
      V: get('V'),
      alpha_deg: get('alpha_deg'),
      gamma_deg: get('gamma_deg'),
      phi_deg: get('phi_deg'),
      theta_deg: get('theta_deg'),
      psi_deg: get('psi_deg'),
      p_dps: get('p_dps'),
      q_dps: get('q_dps'),
      r_dps: get('r_dps'),
      vN: get('vN'),
      vE: get('vE'),
      vD: get('vD'),
      hMSL: get('hMSL'),
      qbar: get('qbar'),
      rho: get('rho'),
      CL: get('CL'),
      CD: get('CD'),
    });
  }

  return rows;
}

// ============================================================================
// Generic GPS CSV Parser (baseline track format)
// ============================================================================

/** Parse generic GPS CSV with NED velocities into GNSSData array */
export function parseGenericGPSCSV(content: string): GNSSData[] {
  const lines = content.split('\n');
  const results: GNSSData[] = [];

  let headerLine = '';
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    headerLine = trimmed;
    dataStart = i + 1;
    break;
  }

  const headers = headerLine.split(',').map(h => h.trim());
  const colIdx = (name: string): number => headers.indexOf(name);

  for (let i = dataStart; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const cols = trimmed.split(',');
    const get = (name: string, fallback = 0): number => {
      const idx = colIdx(name);
      if (idx < 0 || idx >= cols.length) return fallback;
      const val = parseFloat(cols[idx]);
      return isNaN(val) ? fallback : val;
    };
    const getStr = (name: string): string => {
      const idx = colIdx(name);
      return (idx >= 0 && idx < cols.length) ? cols[idx].trim() : '';
    };

    // Try to get timestamp
    const timeStr = getStr('time') || getStr('isoTime') || getStr('timestamp');
    let timestamp = 0;
    if (timeStr) {
      const parsed = new Date(timeStr).getTime();
      timestamp = isNaN(parsed) ? get('time') * 1000 : parsed;
    } else {
      timestamp = get('time') * 1000; // assume seconds
    }

    results.push({
      type: 'GNSS',
      isoTime: timeStr || new Date(timestamp).toISOString(),
      timestamp,
      lat: get('lat'),
      lon: get('lon') || get('lng'),
      hMSL: get('hMSL') || get('alt'),
      velN: get('velN') || get('vN'),
      velE: get('velE') || get('vE'),
      velD: get('velD') || get('vD'),
      hAcc: get('hAcc'),
      vAcc: get('vAcc'),
      sAcc: get('sAcc'),
      numSV: get('numSV') || get('gpsFix'),
    });
  }

  return results;
}

// ============================================================================
// Auto-detect format
// ============================================================================

export type GPSFileFormat = 'flysight' | 'stability' | 'generic';

/** Detect file format from content */
export function detectFormat(content: string): GPSFileFormat {
  const first500 = content.slice(0, 500);
  if (first500.includes('$GNSS') || first500.includes('$FLYS') || first500.includes('$DATA')) {
    return 'flysight';
  }
  if (first500.includes('alpha_deg') || first500.includes('gamma_deg')) {
    return 'stability';
  }
  return 'generic';
}
