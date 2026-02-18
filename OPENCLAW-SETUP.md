# OpenClaw Setup — Polar Project

## Overview

OpenClaw is our AI operations layer. It gives Polar Claw (the agent) autonomous access to the workspace — file editing, shell commands, browser, and messaging.

**Repo:** <https://github.com/openclaw/openclaw>
**Docs:** <https://docs.openclaw.ai/>

---

## Current Infrastructure

| Component | Details |
|---|---|
| Host | Windows 11 laptop + WSL2 (Ubuntu) |
| Gateway | `127.0.0.1:18789` (loopback), systemd user service |
| Model | `github-copilot/claude-opus-4.6` via GitHub Copilot subscription |
| Workspace | `/mnt/c/dev/polar` (Windows: `C:\dev\polar`) |
| Access | VS Code + WebChat dashboard (`http://127.0.0.1:18789/`) |
| Logs | `/tmp/openclaw/openclaw-YYYY-MM-DD.log` |

### Filesystem Layout

| What | Where | Why |
|---|---|---|
| OpenClaw install | `~/openclaw` (Linux FS) | Node.js perf — fast I/O for node_modules |
| OpenClaw config | `~/.openclaw/` (Linux FS) | Gateway config, auth, skills |
| Polar workspace | `/mnt/c/dev/polar` (Windows FS) | Shared with VS Code on Windows side |

**Rule:** OpenClaw's own code and config stay in Linux FS. Project workspaces live on Windows FS for VS Code access.

---

## Daily Use

### WebChat Dashboard (primary)

Open in any browser:
```
http://127.0.0.1:18789/
```

The gateway runs as a systemd service in WSL2. After a Windows reboot, just open any WSL terminal — systemd auto-starts the gateway.

### Useful Commands (WSL terminal)

| Command | What it does |
|---|---|
| `openclaw gateway status` | Check if gateway is running |
| `systemctl --user restart openclaw-gateway` | Restart gateway |
| `openclaw models list` | Show current model |
| `openclaw models set <model>` | Switch model |
| `openclaw dashboard` | Open WebChat in browser |
| `openclaw status` | Full system status + sessions |

---

## Organization

| Role | Who |
|---|---|
| Founder & Domain Expert | Hartman — pro wingsuit BASE jumper, computer engineer, AI orchestrator |
| CEO / Agent | Polar Claw 🐻‍❄️ — engineering orchestration, context management, sub-agent coordination |

Currently a two-person operation. As the project scales, sub-agents will be spun up for specialized engineering work (aero research, code development, testing).

---

## Integration with VS Code Copilot

| | VS Code Copilot | OpenClaw (Polar Claw) |
|---|---|---|
| **When** | At the desk, interactive coding | Async tasks, autonomous multi-step work |
| **Control** | You guide each step | Agent runs autonomously |
| **Context** | Current file + conversation | Full workspace + all planning docs |
| **Strength** | Precise interactive edits | Autonomous implementation, testing, orchestration |

Both use the same GitHub Copilot subscription for model access.

---

## Emergency Shutdown

```bash
# Stop the gateway immediately
systemctl --user stop openclaw-gateway

# Prevent auto-start on next WSL boot
systemctl --user disable openclaw-gateway

# Nuclear option — kill the process directly
kill $(pgrep -f openclaw-gatewa)
```

### Restart When Ready

```bash
systemctl --user enable openclaw-gateway
systemctl --user start openclaw-gateway
```

---

## Future Expansion

- **WhatsApp** — voice memo → agent pipeline (connected, not yet configured)
- **Additional channels** — Telegram, Discord (as needed)
- **Multi-device** — Android phone (voice capture), Meta Quest VR (TBD)
- **Sub-agents** — Specialized agents for aero research, code dev, testing
- **Skills** — ElevenLabs TTS, OpenAI image gen, custom polar-dev skill
