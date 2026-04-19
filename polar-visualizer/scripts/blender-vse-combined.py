"""
Blender VSE Combined Import — Video + Polar overlay PNG sequences.

Imports an Insta360 exported MP4 on Channel 1 and polar overlay PNG sequences
on Channels 2-5, all starting at frame 1. The MP4 and PNGs should cover the
same capture range (produced by the calc-timing.js → Playwright pipeline).

Usage:
  1. Open Blender (any project, or fresh)
  2. Switch to Video Editing workspace
  3. Go to Scripting tab → Open this file → Run Script
  4. In the VSE: Add menu → "Import Video + Overlays" (or press F3 and search)
  5. Select the edit folder containing the MP4 and polar-* subfolders
  6. Video goes to Channel 1, overlays to Channels 2-5, all aligned at frame 1

Expected folder structure:
  edit-folder/
  ├── VID_*.(1).mp4 or *.mp4      (exported video from Insta360 Studio)
  ├── polar-body*/                  (body-frame overlay PNGs)
  ├── polar-inertial*/              (inertial-frame overlay PNGs)
  ├── polar-moment*/                (moment decomposition PNGs)
  └── polar-speed*/                 (speed chart PNGs)

Channel layout:
  Channel 1: Video (MP4)
  Channel 2: Audio (auto-imported with video)
  Channel 3: polar-body overlays
  Channel 4: polar-inertial overlays
  Channel 5: polar-moment overlays
  Channel 6: polar-speed overlays

Video transform: 0.28× scale for 4000×3000 → 1080×1920 portrait output.
Overlay transforms: preset positions tuned for 1080×1920 portrait.
"""

import bpy
import os
import re

bl_info = {
    "name": "Polar VSE Combined Import",
    "blender": (3, 4, 0),
    "category": "Sequencer",
    "description": "Import Insta360 MP4 video + polar overlay PNGs with transforms",
}

# ── Video Transform ──────────────────────────────────────────────────────────
# 4000×3000 MP4 → 1080×1920 portrait output
VIDEO_SCALE = 0.28
VIDEO_OFFSET_X = 0
VIDEO_OFFSET_Y = 0

# ── Overlay Transform Presets ────────────────────────────────────────────────
# Same as blender-vse-import.py
OVERLAY_PRESETS = [
    {
        'name': 'Body Frame',
        'prefix': 'polar-body',
        'channel': 3,
        'offset_x': 220,
        'offset_y': 572,
        'scale': 1.0,
        'crop_top': 0,
    },
    {
        'name': 'Inertial',
        'prefix': 'polar-inertial',
        'channel': 4,
        'offset_x': -127,
        'offset_y': -624,
        'scale': 1.42,
        'crop_top': 41,
    },
    {
        'name': 'Moment Decomposition',
        'prefix': 'polar-moment',
        'channel': 5,
        'offset_x': -224,
        'offset_y': 614,
        'scale': 1.0,
        'crop_top': 0,
    },
    {
        'name': 'Speed Chart',
        'prefix': 'polar-speed',
        'channel': 6,
        'offset_x': 343,
        'offset_y': -692,
        'scale': 0.91,
        'crop_top': 0,
    },
]

PROJECT_FPS = 60
PROJECT_RES_X = 1080
PROJECT_RES_Y = 1920


def find_mp4(parent_dir):
    """Find the exported MP4 in the folder. Prefers files with '(1)' in name."""
    mp4s = []
    for entry in sorted(os.listdir(parent_dir)):
        if entry.lower().endswith('.mp4'):
            mp4s.append(entry)
    if not mp4s:
        return None
    # Prefer the Insta360 export naming: VID_*_(1).mp4
    for f in mp4s:
        if '(1)' in f:
            return os.path.join(parent_dir, f)
    # Fall back to first MP4
    return os.path.join(parent_dir, mp4s[0])


def find_subfolder(parent_dir, prefix):
    """Find the first subfolder whose name starts with prefix."""
    for entry in sorted(os.listdir(parent_dir)):
        full = os.path.join(parent_dir, entry)
        if os.path.isdir(full) and entry.lower().startswith(prefix):
            return full
    return None


def collect_pngs(folder):
    """Return sorted list of PNG filenames in folder."""
    return sorted(
        f for f in os.listdir(folder)
        if f.lower().endswith('.png')
    )


class POLAR_OT_combined_import(bpy.types.Operator):
    """Import Insta360 MP4 video + polar overlay PNGs into VSE"""
    bl_idname = "sequencer.polar_combined_import"
    bl_label = "Import Video + Overlays"
    bl_description = "Select an edit folder with MP4 + polar-* PNG subfolders"
    bl_options = {'REGISTER', 'UNDO'}

    directory: bpy.props.StringProperty(
        subtype='DIR_PATH',
        name="Edit Folder",
    )
    filter_folder: bpy.props.BoolProperty(default=True, options={'HIDDEN'})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        if not self.directory:
            self.report({'ERROR'}, "No folder selected")
            return {'CANCELLED'}

        parent = self.directory.rstrip('/\\')

        # Set project render settings
        scene = context.scene
        scene.render.resolution_x = PROJECT_RES_X
        scene.render.resolution_y = PROJECT_RES_Y
        scene.render.fps = PROJECT_FPS
        scene.render.fps_base = 1.0

        # Ensure sequencer exists
        if not scene.sequence_editor:
            scene.sequence_editor_create()
        sed = scene.sequence_editor

        imported_count = 0
        max_end_frame = 1

        # ── Import Video (Channel 1) ────────────────────────────────────
        mp4_path = find_mp4(parent)
        if mp4_path:
            existing_names = set(sed.sequences_all.keys())

            bpy.ops.sequencer.movie_strip_add(
                filepath=mp4_path,
                relative_path=False,
                frame_start=1,
                channel=1,
                fit_method='ORIGINAL',
                sound=True,
            )

            new_names = set(sed.sequences_all.keys()) - existing_names
            # Find the movie strip (not the sound strip)
            video_strip = None
            for name in new_names:
                strip = sed.sequences_all[name]
                if strip.type == 'MOVIE':
                    video_strip = strip
                    break

            if video_strip:
                video_strip.name = "video"
                video_strip.transform.scale_x = VIDEO_SCALE
                video_strip.transform.scale_y = VIDEO_SCALE
                video_strip.transform.offset_x = VIDEO_OFFSET_X
                video_strip.transform.offset_y = VIDEO_OFFSET_Y

                end = video_strip.frame_final_end
                if end > max_end_frame:
                    max_end_frame = end

                imported_count += 1
                self.report({'INFO'},
                    f"  Video: {os.path.basename(mp4_path)} → ch1 "
                    f"(scale {VIDEO_SCALE})")
            else:
                self.report({'WARNING'}, "MP4 imported but no movie strip found")
        else:
            self.report({'WARNING'},
                f"No MP4 found in {parent}")

        # ── Import Overlays (Channels 2-5) ──────────────────────────────
        for preset in OVERLAY_PRESETS:
            subfolder = find_subfolder(parent, preset['prefix'])
            if not subfolder:
                self.report({'WARNING'},
                    f"Skipped '{preset['name']}': no folder matching '{preset['prefix']}*'")
                continue

            pngs = collect_pngs(subfolder)
            if not pngs:
                self.report({'WARNING'},
                    f"Skipped '{preset['name']}': no PNG files in {os.path.basename(subfolder)}")
                continue

            existing_names = set(sed.sequences_all.keys())

            files = [{"name": f} for f in pngs]
            bpy.ops.sequencer.image_strip_add(
                directory=subfolder + os.sep,
                files=files,
                relative_path=False,
                frame_start=1,
                channel=preset['channel'],
                fit_method='ORIGINAL',
            )

            new_names = set(sed.sequences_all.keys()) - existing_names
            if not new_names:
                self.report({'WARNING'},
                    f"Failed to create strip for '{preset['name']}'")
                continue

            strip = sed.sequences_all[new_names.pop()]
            strip.name = f"polar-{preset['name'].lower().replace(' ', '-')}"
            strip.blend_type = 'ALPHA_OVER'
            strip.transform.offset_x = preset['offset_x']
            strip.transform.offset_y = preset['offset_y']
            strip.transform.scale_x = preset['scale']
            strip.transform.scale_y = preset['scale']

            if preset['crop_top'] > 0:
                strip.crop.max_y = preset['crop_top']

            end = strip.frame_final_end
            if end > max_end_frame:
                max_end_frame = end

            imported_count += 1
            self.report({'INFO'},
                f"  {preset['name']}: {len(pngs)} frames → ch{preset['channel']} "
                f"(offset {preset['offset_x']},{preset['offset_y']} "
                f"scale {preset['scale']:.2f})")

        # ── Set Timeline ────────────────────────────────────────────────
        scene.frame_start = 1
        scene.frame_end = max_end_frame - 1

        duration_sec = (max_end_frame - 1) / PROJECT_FPS
        self.report({'INFO'},
            f"Imported {imported_count} strips: "
            f"{max_end_frame - 1} frames ({duration_sec:.1f}s at {PROJECT_FPS}fps)")

        return {'FINISHED'}


# ── Menu Integration ─────────────────────────────────────────────────────────

def menu_draw(self, context):
    self.layout.separator()
    self.layout.operator(
        POLAR_OT_combined_import.bl_idname,
        icon='FILE_MOVIE',
    )


# ── Registration ─────────────────────────────────────────────────────────────

_classes = [POLAR_OT_combined_import]


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.types.SEQUENCER_MT_add.append(menu_draw)
    print("[Polar VSE Combined] Registered — use Add → Import Video + Overlays (or F3 search)")


def unregister():
    bpy.types.SEQUENCER_MT_add.remove(menu_draw)
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
    print("[Polar VSE Combined] Unregistered")


if __name__ == "__main__":
    register()
