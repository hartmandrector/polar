"""
Blender VSE — Extend existing PNG sequence strips with newly added frames.

Use when a capture folder gained more PNGs after the strips were imported
(e.g. a re-capture with a longer range). Each image-sequence strip keeps its
channel, position, transform, crop, blend mode and start trims; only the new
files (sorting after the strip's current last file) are appended.

Split strips: only the piece that currently shows the last frame of its
sequence is extended. Earlier pieces keep their exact visible range.
Strips trimmed short at the end are left as-is (reported).

Usage:
  1. Save a copy of your .blend first.
  2. Scripting tab → Open this file → set DRY_RUN = True → Run Script and
     read the report in the system console / Info editor.
  3. Set DRY_RUN = False → Run Script.
"""

import bpy
import os

DRY_RUN = True            # True = report only, change nothing
NAME_FILTER = ''          # e.g. 'polar-' to restrict to strips whose name starts with this
UPDATE_SCENE_END = False  # True = extend scene.frame_end to the new last frame if needed


def all_strips(sed):
    for attr in ('strips_all', 'sequences_all'):
        strips = getattr(sed, attr, None)
        if strips is not None:
            return list(strips)
    return []


def png_files(folder):
    return sorted(f for f in os.listdir(folder) if f.lower().endswith('.png'))


def main():
    scene = bpy.context.scene
    sed = scene.sequence_editor
    if not sed:
        print('[extend] No sequence editor in this scene')
        return

    strips = [
        s for s in all_strips(sed)
        if s.type == 'IMAGE' and len(s.elements) > 1 and s.name.startswith(NAME_FILTER)
    ]
    if not strips:
        print('[extend] No image-sequence strips found')
        return

    # Group strips that share a folder + file list (split pieces of one import)
    groups = {}
    for s in strips:
        folder = os.path.normpath(bpy.path.abspath(s.directory))
        key = (folder, tuple(e.filename for e in s.elements))
        groups.setdefault(key, []).append(s)

    print(f"\n[extend] {'DRY RUN — ' if DRY_RUN else ''}{len(strips)} image-sequence strip(s) in {len(groups)} sequence(s)")
    new_scene_end = scene.frame_end

    for (folder, names), members in groups.items():
        label = ', '.join(s.name for s in members)
        if not os.path.isdir(folder):
            print(f'  SKIP {label}: folder not found: {folder}')
            continue
        on_disk = png_files(folder)
        last = names[-1]
        new_files = [f for f in on_disk if f > last]
        missing = [n for n in names if n not in set(on_disk)]
        if missing:
            print(f'  WARN {label}: {len(missing)} existing frame(s) no longer on disk (e.g. {missing[0]})')
        if not new_files:
            print(f'  OK   {label}: no new frames ({len(names)} frames, last {last})')
            continue

        # Strip(s) currently showing the final frame of the sequence get extended
        before = {s.name: (s.frame_final_start, s.frame_final_end, s.channel) for s in members}
        content_end = {s.name: s.frame_start + len(names) for s in members}
        to_extend = [s for s in members if s.frame_final_end >= content_end[s.name]]
        trimmed = [s for s in members if s not in to_extend]

        print(f'  ADD  {label}: +{len(new_files)} frames ({new_files[0]} … {new_files[-1]}), '
              f'{len(names)} → {len(names) + len(new_files)}')
        for s in trimmed:
            print(f'       {s.name}: trimmed before the last frame — visible range kept')
        if DRY_RUN:
            for s in to_extend:
                print(f'       {s.name}: end {s.frame_final_end} → {s.frame_final_end + len(new_files)}')
            continue

        for s in members:
            for f in new_files:
                s.elements.append(f)
        for s in members:
            start, end, _ = before[s.name]
            if s in to_extend:
                # Keep any held/still frames past the old content end
                s.frame_final_end = end + len(new_files)
            else:
                s.frame_final_end = end
            if s.frame_final_start != start:
                s.frame_final_start = start
            _, _, ch = before[s.name]
            note = f' (moved to channel {s.channel}: overlap)' if s.channel != ch else ''
            print(f'       {s.name}: frames {s.frame_final_start}–{s.frame_final_end}{note}')
            new_scene_end = max(new_scene_end, s.frame_final_end - 1)

    if new_scene_end > scene.frame_end:
        if UPDATE_SCENE_END and not DRY_RUN:
            scene.frame_end = new_scene_end
            print(f'[extend] scene.frame_end → {new_scene_end}')
        else:
            print(f'[extend] Note: strips now run to frame {new_scene_end}; scene.frame_end is {scene.frame_end}')
    print('[extend] Done')


main()
