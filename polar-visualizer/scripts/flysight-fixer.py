#!/usr/bin/env python3
"""
FlySight CSV Fixer for BASElineXR

Converts FlySight 1 format and FlySight Viewer exports to FlySight 2 format
that's compatible with BASElineXR.

FlySight 1 format (old):
    time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV
    2023-10-01T12:00:00.000Z,47.123,-123.456,3000.0,10.0,5.0,30.0,1.0,1.5,0.3,15

FlySight Viewer export format:
    Similar but may have different column names/ordering

FlySight 2 format (new, BASElineXR compatible):
    $FLYS,1
    $VAR,DEVICE_ID,converted
    $VAR,SESSION_ID,converted
    $COL,GNSS,time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV
    $UNIT,GNSS,,deg,deg,m,m/s,m/s,m/s,m,m,m/s,
    $DATA
    $GNSS,2023-10-01T12:00:00.000Z,47.123,-123.456,3000.0,10.0,5.0,30.0,1.0,1.5,0.3,15

Usage:
    python flysight_fixer.py [file_or_folder]
    
If no argument, prompts for file/folder path.
"""

import os
import sys
import re
import uuid
from datetime import datetime
from pathlib import Path


def generate_session_id():
    """Generate a unique session ID for converted files."""
    return uuid.uuid4().hex[:24]


def detect_format(lines):
    """
    Detect the format of a FlySight CSV file.
    
    Returns:
        'flysight2' - Already in FlySight 2 format (has $FLYS header)
        'flysight1_header' - FlySight 1 with header row
        'flysight1_units' - FlySight 1 with header AND units row (2 header rows)
        'flysight1_no_header' - FlySight 1 without header row
        'flysight_viewer' - FlySight Viewer export format
        'unknown' - Unknown format
    """
    if not lines:
        return 'unknown'
    
    first_line = lines[0].strip()
    
    # Check for FlySight 2 format
    if first_line.startswith('$FLYS'):
        return 'flysight2'
    
    # Check for FlySight 1 header row
    # Common header formats:
    # "time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV"
    # "time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,gpsFix,numSV"
    # "time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,heading,cAcc,gpsFix,numSV"
    header_patterns = [
        r'^time,lat,lon,hMSL',
        r'^time\s*,\s*lat\s*,\s*lon',
        r'^Time,Lat,Lon',  # Case variations
    ]
    
    for pattern in header_patterns:
        if re.match(pattern, first_line, re.IGNORECASE):
            # Check if line 2 is a units row (starts with comma or contains (deg))
            if len(lines) > 1:
                second_line = lines[1].strip()
                if second_line.startswith(',') or '(deg)' in second_line or '(m)' in second_line:
                    return 'flysight1_units'
            return 'flysight1_header'
    
    # Check if first line looks like data (ISO timestamp)
    if re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', first_line):
        return 'flysight1_no_header'
    
    # FlySight Viewer has different column names sometimes
    viewer_patterns = [
        r'^UTC Time',
        r'^Timestamp',
        r'^DateTime',
    ]
    
    for pattern in viewer_patterns:
        if re.match(pattern, first_line, re.IGNORECASE):
            return 'flysight_viewer'
    
    return 'unknown'


def parse_flysight1_header(header_line):
    """
    Parse FlySight 1 header to get column mapping.
    
    Returns dict mapping column indices to standard names.
    
    FlySight 1 headers may include extra columns like:
    - heading, cAcc, gpsFix (not needed in FlySight 2)
    """
    columns = [c.strip().lower() for c in header_line.split(',')]
    
    # Standard FlySight 2 column names (what we need)
    standard_cols = ['time', 'lat', 'lon', 'hmsl', 'veln', 'vele', 'veld', 'hacc', 'vacc', 'sacc', 'numsv']
    
    mapping = {}
    for i, col in enumerate(columns):
        # Normalize column names
        col_normalized = col.lower().replace(' ', '')
        if col_normalized in standard_cols:
            mapping[i] = col_normalized
        elif col_normalized == 'altitude' or col_normalized == 'alt':
            mapping[i] = 'hmsl'
        # Skip these FlySight 1 columns - not in FlySight 2 format:
        # heading, cacc, gpsfix
    
    return mapping


def parse_flysight_viewer_header(header_line):
    """
    Parse FlySight Viewer export header.
    
    FlySight Viewer may export with columns like:
    UTC Time, Lat, Lon, Alt, VelN, VelE, VelD, etc.
    """
    columns = [c.strip().lower() for c in header_line.split(',')]
    
    # Map common FlySight Viewer column names to standard names
    name_map = {
        'utc time': 'time',
        'timestamp': 'time',
        'datetime': 'time',
        'latitude': 'lat',
        'longitude': 'lon',
        'alt': 'hmsl',
        'altitude': 'hmsl',
        'hmsl': 'hmsl',
        'veln': 'veln',
        'vele': 'vele',
        'veld': 'veld',
        'vel n': 'veln',
        'vel e': 'vele',
        'vel d': 'veld',
        'hacc': 'hacc',
        'vacc': 'vacc',
        'sacc': 'sacc',
        'numsv': 'numsv',
        'num sv': 'numsv',
        'sats': 'numsv',
        'satellites': 'numsv',
    }
    
    mapping = {}
    for i, col in enumerate(columns):
        col_normalized = col.lower().strip()
        if col_normalized in name_map:
            mapping[i] = name_map[col_normalized]
        elif col_normalized in ['lat', 'lon', 'time']:
            mapping[i] = col_normalized
    
    return mapping


def convert_data_row(row, mapping=None):
    """
    Convert a data row to FlySight 2 format.
    
    If mapping is None, assumes standard column order.
    """
    parts = row.strip().split(',')
    
    if mapping:
        # Reorder based on mapping
        standard_order = ['time', 'lat', 'lon', 'hmsl', 'veln', 'vele', 'veld', 'hacc', 'vacc', 'sacc', 'numsv']
        values = {}
        for i, part in enumerate(parts):
            if i in mapping:
                values[mapping[i]] = part.strip()
        
        # Build output row with defaults for missing values
        output_parts = []
        for col in standard_order:
            if col in values:
                output_parts.append(values[col])
            elif col == 'numsv':
                output_parts.append('0')  # Default satellite count
            elif col in ['hacc', 'vacc', 'sacc']:
                output_parts.append('1.0')  # Default accuracy
            else:
                output_parts.append('0')
        
        return '$GNSS,' + ','.join(output_parts)
    else:
        # Standard order - just add $GNSS prefix
        return '$GNSS,' + row.strip()


def convert_file(input_path, output_path=None):
    """
    Convert a FlySight file to FlySight 2 format.
    
    Args:
        input_path: Path to input CSV file
        output_path: Path to output CSV file (defaults to input_path.converted.csv)
    
    Returns:
        output_path if successful, None if failed
    """
    input_path = Path(input_path)
    
    if output_path is None:
        output_path = input_path.with_suffix('.converted.csv')
    else:
        output_path = Path(output_path)
    
    print(f"Processing: {input_path}")
    
    try:
        with open(input_path, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"  Error reading file: {e}")
        return None
    
    if not lines:
        print("  Error: Empty file")
        return None
    
    format_type = detect_format(lines)
    print(f"  Detected format: {format_type}")
    
    if format_type == 'flysight2':
        print("  Already in FlySight 2 format, no conversion needed")
        return input_path
    
    if format_type == 'unknown':
        print("  Error: Unknown format, cannot convert")
        return None
    
    # Generate headers
    session_id = generate_session_id()
    headers = [
        '$FLYS,1',
        '$VAR,DEVICE_ID,converted',
        f'$VAR,SESSION_ID,{session_id}',
        '$COL,GNSS,time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV',
        '$UNIT,GNSS,,deg,deg,m,m/s,m/s,m/s,m,m,m/s,',
        '$DATA',
    ]
    
    # Convert data
    output_lines = headers.copy()
    mapping = None
    data_start = 0
    
    if format_type == 'flysight1_header':
        mapping = parse_flysight1_header(lines[0])
        data_start = 1
    elif format_type == 'flysight1_units':
        # Has header row AND units row (2 rows to skip)
        mapping = parse_flysight1_header(lines[0])
        data_start = 2
    elif format_type == 'flysight_viewer':
        mapping = parse_flysight_viewer_header(lines[0])
        data_start = 1
    elif format_type == 'flysight1_no_header':
        # No header, assume standard order
        mapping = None
        data_start = 0
    
    converted_count = 0
    for line in lines[data_start:]:
        line = line.strip()
        if not line:
            continue
        
        try:
            converted = convert_data_row(line, mapping)
            output_lines.append(converted)
            converted_count += 1
        except Exception as e:
            print(f"  Warning: Could not convert line: {line[:50]}...")
    
    # Write output
    try:
        with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
            for line in output_lines:
                f.write(line + '\n')
        print(f"  Converted {converted_count} data points")
        print(f"  Output: {output_path}")
        return output_path
    except Exception as e:
        print(f"  Error writing output: {e}")
        return None


def process_folder(folder_path, recursive=False):
    """
    Process all CSV files in a folder.
    
    Args:
        folder_path: Path to folder
        recursive: If True, process subfolders too
    """
    folder_path = Path(folder_path)
    
    if not folder_path.is_dir():
        print(f"Error: {folder_path} is not a directory")
        return
    
    # Find CSV files
    if recursive:
        csv_files = list(folder_path.rglob('*.csv')) + list(folder_path.rglob('*.CSV'))
    else:
        csv_files = list(folder_path.glob('*.csv')) + list(folder_path.glob('*.CSV'))
    
    # Filter out already converted files
    csv_files = [f for f in csv_files if '.converted.' not in f.name]
    
    if not csv_files:
        print(f"No CSV files found in {folder_path}")
        return
    
    print(f"Found {len(csv_files)} CSV files")
    print()
    
    converted = 0
    for csv_file in csv_files:
        result = convert_file(csv_file)
        if result:
            converted += 1
        print()
    
    print(f"Converted {converted}/{len(csv_files)} files")


def main():
    print("=" * 60)
    print("FlySight CSV Fixer for BASElineXR")
    print("=" * 60)
    print()
    
    # Get path from argument or prompt
    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        print("Enter the path to a FlySight CSV file or folder:")
        print("(Drag and drop a file/folder here, or type the path)")
        path = input("> ").strip().strip('"').strip("'")
    
    if not path:
        print("No path provided, exiting")
        return
    
    path = Path(path)
    
    if not path.exists():
        print(f"Error: Path does not exist: {path}")
        return
    
    if path.is_file():
        convert_file(path)
    elif path.is_dir():
        print()
        print("Process subfolders recursively? (y/n) [n]:")
        recursive = input("> ").strip().lower() == 'y'
        print()
        process_folder(path, recursive)
    else:
        print(f"Error: Unknown path type: {path}")


if __name__ == '__main__':
    main()
