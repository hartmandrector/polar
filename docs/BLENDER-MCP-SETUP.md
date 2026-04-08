# Blender MCP Setup — GLB Model Conventions

Reference for working on wingsuit and canopy GLB models in Blender with the MCP server.

## MCP Architecture

```
VS Code (MCP client)  ──MCP protocol──▶  uvx blender-mcp (bridge)  ──TCP 9876──▶  Blender Addon (socket server)
OpenClaw (WSL)        ──TCP 9876──────▶  Blender Addon (socket server)
```

### VS Code MCP Config

File: `.vscode/mcp.json`
```json
{
  "servers": {
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}
```

VS Code launches `uvx blender-mcp` as an MCP server process. That bridge connects to Blender's addon socket on `localhost:9876` and translates MCP tool calls into the addon's JSON protocol.

### OpenClaw Direct Bridge (WSL → Blender)

OpenClaw runs in WSL2. Blender runs on Windows. The addon listens on `localhost:9876` (Windows side).

- **Windows host IP from WSL**: `172.27.224.1` (via `ip route show default | awk '{print $3}'`)
- **Port**: 9880 (changed from default 9876 to avoid conflicts with stale bridge processes)
- **Protocol**: Raw TCP socket, plain JSON messages (no HTTP, no framing)
- **Port proxy required**: Blender addon binds to `127.0.0.1` only. WSL2 is on a virtual network (`172.27.x.x`) so a Windows portproxy is needed:
  ```powershell
  # Run as admin — forwards WSL traffic to Blender's localhost socket
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=9880 connectaddress=127.0.0.1 connectport=9880
  ```
- **Firewall rule**: Also required for the port:
  ```powershell
  New-NetFirewallRule -DisplayName "Blender MCP 9880" -Direction Inbound -LocalPort 9880 -Protocol TCP -Action Allow
  ```

### Blender Addon Details

- **Source**: `C:\Users\hartm\AppData\Roaming\Blender Foundation\Blender\3.4\scripts\addons\addon.py`
- **Author**: Siddharth Ahuja (BlenderMCP v1.2)
- **Blender version**: 3.4

### Socket Protocol

Send a JSON object, receive a JSON object back. No length prefix, no newline delimiter — just raw JSON.

**Request format:**
```json
{"type": "<command>", "params": {<command-specific params>}}
```

**Response format:**
```json
{"status": "success", "result": {<response data>}}
```
or
```json
{"status": "error", "message": "<error description>"}
```

**Available commands:**
| Command | Params | Description |
|---------|--------|-------------|
| `get_scene_info` | none | List all objects, materials, scene settings |
| `get_object_info` | `{"name": "..."}` | Detailed info for one object |
| `execute_code` | `{"code": "..."}` | Run arbitrary Python in Blender |
| `get_viewport_screenshot` | none | Capture viewport as base64 image |

**Important**: The addon uses `bpy.app.timers.register()` to execute commands on Blender's main thread. The connection must stay open — the response comes asynchronously after the timer fires. Blender must be in an active state (not in a modal dialog or splash screen) for timers to process.

### Bridge Script

`polar-visualizer/scripts/blender-bridge.py` — Simple Python script for sending commands from WSL:
```bash
python3 polar-visualizer/scripts/blender-bridge.py get_scene_info
python3 polar-visualizer/scripts/blender-bridge.py execute_code '{"code": "import bpy; print(list(bpy.data.objects.keys()))"}'
```

### Troubleshooting

- **Connection drops with no response**: Addon server may not be started. In Blender: N-key sidebar → BlenderMCP tab → click "Start Server"
- **Timer not firing**: Blender must be in normal interactive mode (not splash screen, not modal dialog)
- **Port not reachable from WSL**: Check `ip route show default` for Windows host IP; may need Windows Firewall exception for port 9876
- **Check Blender console**: Window → Toggle System Console shows addon print messages ("Connected to client", "Client disconnected", errors)

---

## Axis Conventions

### Blender (Y-up, right-handed)
Blender's default: **+X right, +Y up, +Z toward camera** (into screen = -Z).
When exporting GLB, Blender applies a Y-up → Z-up transform automatically.
The resulting GLB file has: **+X right, +Y up, +Z forward** (out of screen).

### GLB Model Space (as loaded by Three.js)
Our wingsuit GLBs use this convention (from `model-registry.ts`):

| GLB Axis | Direction (wingsuit) | Physical Meaning |
|----------|---------------------|------------------|
| **+Z**   | Head (forward)      | Leading edge, nose |
| **−Z**   | Feet (aft)          | Trailing edge, tail |
| **+X**   | Left hand           | Left wing, port |
| **−X**   | Right hand          | Right wing, starboard |
| **+Y**   | Back/dorsal (up)    | Top surface |
| **−Y**   | Belly/ventral (down)| Bottom surface |

### NED Body Frame (physics)
The mapping from GLB → NED body axes:

| NED Axis | GLB Mapping | Physical |
|----------|-------------|----------|
| **NED +x** (forward) | GLB **+Z** | Head direction |
| **NED +y** (right)   | GLB **−X** | Right hand |
| **NED +z** (down)    | GLB **−Y** | Belly |

This is encoded in `model-registry.ts`:
```typescript
axes: {
  ned_x: { glbAxis: 'z', sign:  1 },   // GLB +Z = head = NED forward
  ned_y: { glbAxis: 'x', sign: -1 },   // GLB −X = right hand = NED right
  ned_z: { glbAxis: 'y', sign: -1 },   // GLB −Y = belly = NED down
}
```

### In Blender (after GLB import)
The glTF importer converts Y-up → Z-up with a sign flip on the depth axis:
- **Blender −Y** → GLB +Z = **head/forward/leading edge**
- **Blender +Y** → GLB −Z = **feet/aft/trailing edge**
- **Blender +X** → GLB +X = **left wing (port)**
- **Blender −X** → GLB −X = **right wing (starboard)**
- **Blender +Z** → GLB +Y = **back/dorsal (top surface)**
- **Blender −Z** → GLB −Y = **belly/ventral (bottom surface)**

Mapping: `Blender X = GLB X`, `Blender Y = −GLB Z`, `Blender Z = GLB Y`

**Summary for Blender editing:**
- Face the model looking down the **+Y axis** to see it from the front (head-on)
- The pilot lies **prone** with belly facing **−Z** in Blender
- Wings extend along **±X** (left/right)
- Head points **−Y**, feet point **+Y**
- Leading edge = min Y vertices (most negative Y), trailing edge = max Y vertices

## Current Models

### tsimwingsuit.glb / WSV4.glb (Wingsuit Pilot)
- **Source**: Blender (Khronos glTF Blender I/O v3.4.50)
- **Vertices**: ~3,898 (WSV4), ~3,550 max dim along Z
- **Physical reference**: pilot height 1.875m maps to GLB Z-extent 3.550
- **Scale factor**: `glbToMeters = 1.875 / 3.550 = 0.528`
- **Root node**: `WS_V3` (WSV4)
- **Bbox**: X: ±1.412, Y: −0.284 to 0.328, Z: −2.473 to 1.077

### Corvid 2 Hartman.glb (Pattern Reference)
- **Source**: Rhino 3DM → Three.js GLTFExporter r178
- **Geometry**: LINE_STRIP meshes (curves, not surfaces)
- **Content**: Rib profiles, panel outlines, chord lines from Squirrel Corvid 2 wingsuit patterns
- **Bbox**: Very large raw coordinates (Rhino mm space: X ~35K, Y ~−53K)
- **Use**: Reference geometry only — import as separate collection in Blender, do not export as part of the flight model
- **Note**: Will need significant scaling and axis rotation to align with the wingsuit model space

### Corvid 2 Hartman.3dm (Rhino Source)
- **Format**: OpenNURBS / Rhino 3DM
- **Content**: Exact 2D patterns, rib airfoil profiles, aerodynamic chord measurements
- **Best opened with**: Rhino (license expired), or online viewers (Shapediver, 3dviewer.net)
- **For Blender**: Import via the `.glb` export, not the `.3dm` directly (Blender's Rhino import is limited)
- **Key data to extract**: Rib chord lengths, airfoil shapes at each span station, pattern panel dimensions

## Workflow: Reshaping Wingsuit with Rib Reference

1. **Open WSV4.glb** in Blender as the active working model
2. **Import Corvid GLB** into a separate collection (reference only, non-renderable)
3. **Scale + rotate** the Corvid curves to align with WSV4 coordinate space:
   - Rhino uses mm, WSV4 uses Blender units (~0.528 per meter)
   - Rhino may use Z-up; will need 90° rotation
4. **Identify rib stations**: Match Corvid rib profiles to WSV4 span positions
5. **Cross-section editing**: At each rib station, reshape WSV4 mesh cross-section to match the Corvid airfoil profile
6. **Preserve symmetry**: Only edit +X half, mirror to −X
7. **Export**: glTF Binary (.glb), Y-up, apply transforms

## Blender Export Settings (GLB)

- Format: glTF Binary (.glb)
- Include: Selected Objects (or all visible)
- Transform: **+Y Up** (default)
- Geometry: Apply Modifiers = ON
- Animation: OFF (static model)
- Compression: OFF (for development; enable for production)

## Key Measurements (from model-registry.ts)

### Wingsuit (tsimwingsuit / WSV4)
| Landmark | GLB Position | Description |
|----------|-------------|-------------|
| CG       | (0, −0.150, −0.498) | Center of gravity |
| Head     | (0, 0.037, 1.045)   | Top of head |
| Feet     | (0, −0.151, −2.456) | Sole of feet |
| Left wing tip  | (1.404, −0.063, −0.350) | Max +X |
| Right wing tip | (−1.404, −0.063, −0.350) | Max −X |

### Canopy (Ibex UL) — for reference
| Landmark | GLB Position | Description |
|----------|-------------|-------------|
| Bridle top | (0, 4.672, −0.848) | Bridle attachment |
| Center cell LE | max +Z on center rib | Leading edge |
| Center cell TE | min +Z on center rib | Trailing edge |

## Aerodynamic Reference Points

In the wingsuit model, key chord-fraction positions from `polar-data.ts`:
- **CG at 40% chord** (`A5_CG_XC = 0.40`)
- **System chord = 1.8m** (`A5_SYS_CHORD`)
- Leading edge = 0% chord = max +Z (GLB) = min −Y (Blender)
- Trailing edge = 100% chord = min −Z (GLB) = max +Y (Blender)
- Chord axis runs along **Z in GLB / −Y in Blender** (head-to-foot direction)

## Notes

- The `.3dm` contains precise manufacturing measurements — these are ground truth for chord lengths and rib shapes
- The GLB mesh is a visual approximation that should be refined to match the pattern data
- When the model is loaded in Three.js, `model-loader.ts` handles the GLB → scene transform
- `model-registry.ts` defines all physical dimensions, scale factors, and axis mappings
- Any changes to the model must preserve the axis convention or update `model-registry.ts` accordingly
