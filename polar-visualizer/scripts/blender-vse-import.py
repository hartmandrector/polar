"""
Blender VSE Overlay Import — Import polar PNG sequences with preset transforms.

Usage:
  1. Open Blender (any project, or fresh)
  2. Switch to Video Editing workspace
  3. Go to Scripting tab → Open this file → Run Script
  4. In the VSE: Add menu → "Import Polar Overlays" (or press F3 and search)
  5. Select the parent folder containing the polar-* subfolders
  6. All 4 overlay strips are imported at frame 1 with transforms applied

The script looks for subfolders matching these prefixes:
  - polar-body*           → channel 2
  - polar-inertial*       → channel 3
  - polar-moment*         → channel 4
  - polar-speed*          → channel 5

Channel 1 is left free for your video strip.

Transforms are tuned for 1080×1920 portrait output.
"""

import bpy
import os
import glob

bl_info = {
    "name": "Polar VSE Overlay Import",
    "blender": (3, 4, 0),
    "category": "Sequencer",
    "description": "Import polar capture PNG sequences with preset transforms",
}

# ── Overlay Transform Presets ────────────────────────────────────────────────
# Each entry: folder prefix match, VSE channel, offset X/Y, uniform scale, crop top px
OVERLAY_PRESETS = [
    {
        'name': 'Body Frame',
        'prefix': 'polar-body',
        'channel': 2,
        'offset_x': 220,
        'offset_y': 572,
        'scale': 1.0,
        'crop_top': 0,
    },
    {
        'name': 'Inertial',
        'prefix': 'polar-inertial',
        'channel': 3,
        'offset_x': -127,
        'offset_y': -624,
        'scale': 1.42,
        'crop_top': 41,
    },
    {
        'name': 'Moment Decomposition',
        'prefix': 'polar-moment',
        'channel': 4,
        'offset_x': -224,
        'offset_y': 614,
        'scale': 1.0,
        'crop_top': 0,
    },
    {
        'name': 'Speed Chart',
        'prefix': 'polar-speed',
        'channel': 5,
        'offset_x': 343,
        'offset_y': -692,
        'scale': 0.91,
        'crop_top': 0,
    },
]

PROJECT_FPS = 60
PROJECT_RES_X = 1080
PROJECT_RES_Y = 1920


def find_subfolder(parent_dir, prefix):
    """Find the first subfolder whose name starts with prefix."""
    for entry in sorted(os.listdir(parent_dir)):
        full = os.path.join(parent_dir, entry)
        if os.path.isdir(full) and entry.lower().startswith(prefix):
            return full
    return None


def collect_pngs(folder):
    """Return sorted list of PNG filenames (not full paths) in folder."""
    pngs = sorted(
        f for f in os.listdir(folder)
        if f.lower().endswith('.png')
    )
    return pngs


class POLAR_OT_import_overlays(bpy.types.Operator):
    """Import polar overlay PNG sequences into VSE with preset transforms"""
    bl_idname = "sequencer.polar_import_overlays"
    bl_label = "Import Polar Overlays"
    bl_description = "Select a folder containing polar-* PNG sequence subfolders"
    bl_options = {'REGISTER', 'UNDO'}

    # Directory picker property
    directory: bpy.props.StringProperty(
        subtype='DIR_PATH',
        name="Capture Folder",
    )

    # Hidden filter props so Blender shows a folder picker (not file picker)
    filter_folder: bpy.props.BoolProperty(default=True, options={'HIDDEN'})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        if not self.directory:
            self.report({'ERROR'}, "No folder selected")
            return {'CANCELLED'}

        parent = self.directory.rstrip('/\\')

        # Validate: at least one polar-* subfolder exists
        found_any = False
        for preset in OVERLAY_PRESETS:
            if find_subfolder(parent, preset['prefix']):
                found_any = True
                break

        if not found_any:
            self.report({'ERROR'},
                f"No polar-* subfolders found in:\n{parent}\n"
                "Expected: polar-body*, polar-inertial*, polar-moment*, polar-speed*")
            return {'CANCELLED'}

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

            # Record existing strip names so we can find the newly created one
            existing_names = set(sed.sequences_all.keys())

            # Import image sequence
            files = [{"name": f} for f in pngs]
            bpy.ops.sequencer.image_strip_add(
                directory=subfolder + os.sep,
                files=files,
                relative_path=False,
                frame_start=1,
                channel=preset['channel'],
                fit_method='ORIGINAL',
            )

            # Find the new strip
            new_names = set(sed.sequences_all.keys()) - existing_names
            if not new_names:
                self.report({'WARNING'},
                    f"Failed to create strip for '{preset['name']}'")
                continue

            strip = sed.sequences_all[new_names.pop()]

            # Rename strip for clarity
            strip.name = f"polar-{preset['name'].lower().replace(' ', '-')}"

            # Blend mode: Alpha Over so transparent PNG areas show through
            strip.blend_type = 'ALPHA_OVER'

            # Transform: position and scale
            strip.transform.offset_x = preset['offset_x']
            strip.transform.offset_y = preset['offset_y']
            strip.transform.scale_x = preset['scale']
            strip.transform.scale_y = preset['scale']

            # Crop (top pixels)
            if preset['crop_top'] > 0:
                strip.crop.max_y = preset['crop_top']

            # Track timeline end
            end = strip.frame_final_end
            if end > max_end_frame:
                max_end_frame = end

            imported_count += 1
            self.report({'INFO'},
                f"  {preset['name']}: {len(pngs)} frames → ch{preset['channel']} "
                f"(offset {preset['offset_x']},{preset['offset_y']} "
                f"scale {preset['scale']:.2f})")

        # Set timeline range
        scene.frame_start = 1
        scene.frame_end = max_end_frame - 1  # end is exclusive in Blender

        # Summary
        duration_sec = (max_end_frame - 1) / PROJECT_FPS
        self.report({'INFO'},
            f"Imported {imported_count} overlay strips: "
            f"{max_end_frame - 1} frames ({duration_sec:.1f}s at {PROJECT_FPS}fps)")

        return {'FINISHED'}


# ── Menu Integration ─────────────────────────────────────────────────────────

def menu_draw(self, context):
    self.layout.separator()
    self.layout.operator(
        POLAR_OT_import_overlays.bl_idname,
        icon='FILE_IMAGE',
    )


# ── Registration ─────────────────────────────────────────────────────────────

_classes = [POLAR_OT_import_overlays]


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.types.SEQUENCER_MT_add.append(menu_draw)
    print("[Polar VSE] Registered — use Add → Import Polar Overlays (or F3 search)")


def unregister():
    bpy.types.SEQUENCER_MT_add.remove(menu_draw)
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
    print("[Polar VSE] Unregistered")


if __name__ == "__main__":
    register()
