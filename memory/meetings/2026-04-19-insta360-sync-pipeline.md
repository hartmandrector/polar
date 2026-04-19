# Meeting Notes — 2026-04-19 — Insta360 Sync Pipeline Complete

## Participants
- Hartman (founder)
- VS Code Copilot (Claude Opus 4.6)

## Summary
Built the full Insta360 ↔ GPS viewer ↔ Blender pipeline: GPS viewer UI for sync import (Generate Sync button calling calc-timing.js via server API, Set Capture Range, Import Keyframes), Blender combined video+overlay VSE import script, and fixed IDE/build issues. The pipeline now goes from an edit folder containing INSV + TRACK.CSV through automatic sync calculation to GPS viewer keyframe import and Blender editing. Tested successfully on two Dashanbao flights (05-03-2025-1 and 05-03-2025-2).

## Decisions Made
- Server-side API approach chosen over client-side for calc-timing.js (Vite plugin at `/api/calc-timing`)
- Phase 1 keyframe import: timing only (pipeline_time_s), camera mapping deferred to Phase 2
- Blender combined script uses channels 3-6 for overlays (video+audio occupy ch1+ch2)
- Video scale factor: 0.28× for 4000×3000 → 1080×1920 portrait output
- Text input for edit folder path (browser security prevents directory picker from revealing absolute path)
- Path sanitization: strip surrounding quotes from pasted paths
- Separate `tsconfig.node.json` for vite.config.ts (Node.js types vs browser types)
- Head position sync-result.json naming conflict acknowledged — will be addressed in a future session
- The two sync-result.json files (head position vs Insta360 calc-timing) are in separate folders so not an immediate problem

## Files Changed
- `polar-visualizer/gps.html` — Insta360 Import UI section (folder input, Generate Sync, Load JSON, Set Capture Range, Import Keyframes buttons)
- `polar-visualizer/src/gps-viewer/gps-main.ts` — Insta360SyncData interfaces, applyInsta360Sync(), button click handlers for generate/load/range/keyframes
- `polar-visualizer/src/gps-viewer/gps-style.css` — `#capture-panel { height: auto; max-height: none; }` override
- `polar-visualizer/vite.config.ts` — `calcTimingPlugin()` Vite server middleware (POST /api/calc-timing → execFile calc-timing.js)
- `polar-visualizer/tsconfig.node.json` — NEW: Node.js tsconfig for vite.config.ts
- `polar-visualizer/package.json` — added @types/node devDependency
- `polar-visualizer/scripts/blender-vse-combined.py` — NEW: Blender VSE operator for video + 4 overlay channels
- `docs/INSTA360-DATA-SYNC.md` — Steps 4 & 5 documented, tools section updated

## Open Questions / Blockers
- Head position sync-result.json shares filename with calc-timing output — needs rename or different location in a future session
- Phase 2 keyframe camera mapping (Insta360 pan/tilt/fov → Three.js orbit controls) not yet implemented
- Gyroflow-based fallback sync (for INSV files without .insprj) not yet implemented

## Next Steps
- [ ] Test the full pipeline on more flights (Squaw data, different schemes)
- [ ] Phase 2: Map Insta360 pan/tilt/fov/distance to Three.js orbit camera positions
- [ ] Rename head position sync-result.json to avoid collision
- [ ] Scheme selector dropdown in GPS viewer UI (currently uses default scheme)
- [ ] Consider auto-capture flow: load sync → set range → run Playwright in one click
