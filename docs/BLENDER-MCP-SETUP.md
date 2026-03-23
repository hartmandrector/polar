# Blender MCP Setup — Polar Visualizer

AI-assisted 3D modeling for wingsuit/canopy/pilot GLB models via VS Code Copilot + BlenderMCP.

## Prerequisites

- **Blender 4.0+** (free: blender.org/download)
- **VS Code + GitHub Copilot** (already installed)
- **uv** package manager:
  ```powershell
  # Windows PowerShell
  powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  # Add to PATH
  $localBin = "$env:USERPROFILE\.local\bin"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$localBin", "User")
  ```

## Install BlenderMCP

### 1. Blender Addon

- Download `addon.py` from [github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)
- Blender → Edit → Preferences → Add-ons → Install → select `addon.py`
- Enable "BlenderMCP"
- In 3D Viewport, press N → BlenderMCP tab → **Connect**

### 2. VS Code MCP Server

Create/edit `.vscode/mcp.json` in the polar project root:

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

Copilot Chat will now see Blender tools. Verify: open Chat (Ctrl+Alt+I), click "Configure Tools" — you should see blender tools listed.

## Usage

With Blender open and the addon connected:

- **Copilot Chat**: ask naturally — "add an armature to the wingsuit with shoulder and elbow joints"
- **Code execution**: Copilot sends `bpy` Python to Blender via the MCP socket
- **Import models**: load existing GLBs from `polar-visualizer/public/models/`
- **Export**: File → Export → glTF 2.0 (.glb) back to `public/models/`

### Example Prompts

```
Import the wingsuit model from public/models/wingsuit.glb
Add an armature with spine, shoulder, elbow, and wrist bones
Constrain arm sweep to ±30 degrees
Create a canopy with 7 ribs and add shape keys for brake deflection
Export as GLB to public/models/wingsuit-rigged.glb
```

## Architecture

```
VS Code Copilot Chat
  │  MCP Protocol (stdio)
  ▼
BlenderMCP Server (uvx blender-mcp)
  │  TCP Socket (localhost:9876)
  ▼
Blender Addon (addon.py)
  │  bpy API (main thread)
  ▼
Blender
```

## OpenClaw Bridge (Future)

The Blender addon socket on `localhost:9876` accepts JSON commands directly. OpenClaw can send bpy scripts via raw TCP for remote/async model work without VS Code open. Not yet implemented.

## Relevant Models

| Model | Path | Notes |
|-------|------|-------|
| Wingsuit | `public/models/wingsuit.glb` | Current static model, needs rigging |
| Slick pilot | `public/models/slick.glb` | Post-unzip pilot |
| Tracking suit | `public/models/tracking.glb` | If exists |
| Canopy | `public/models/canopy.glb` | 7-cell paraglider |

## Goals

1. **Skeleton/armature system** — joints for wing sweep, arm position, leg spread
2. **In-flight configurations** — shape keys or bone constraints for flight poses
3. **Canopy rigging** — brake deflection, weight shift deformation
4. **Aerodynamic surfaces** — visual reference geometry matching segment model
5. **Vehicle assembly** — degrees of freedom between components (riser pivot, etc.)
6. **Model quality improvements** — better geometry for wingsuit, slick, tracking suit
