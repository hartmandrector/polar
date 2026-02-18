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
| Gateway | `127.0.0.1:18789` (loopback), run manually via WSL |
| Model | `github-copilot/claude-opus-4.6` via GitHub Copilot subscription |
| Workspace | `/mnt/c/dev/polar` (Windows: `C:\dev\polar`) |
| Access | VS Code Simple Browser with token param |
| Logs | `/tmp/openclaw/openclaw-YYYY-MM-DD.log` |
| Config | `~/.openclaw/openclaw.json` (Linux FS) |

### Filesystem Layout

| What | Where | Why |
|---|---|---|
| OpenClaw install | `~/openclaw` (Linux FS) | Node.js perf — fast I/O for node_modules |
| OpenClaw config | `~/.openclaw/` (Linux FS) | Gateway config, auth, skills |
| Polar workspace | `/mnt/c/dev/polar` (Windows FS) | Shared with VS Code on Windows side |

**Rule:** OpenClaw's own code and config stay in Linux FS. Project workspaces live on Windows FS for VS Code access.

---

## Starting the Gateway (do this every session)

The gateway does **not** auto-start. The systemd user service is unreliable (port fails to bind). Instead, start the gateway manually each session with a single command.

### Step 1 — Start gateway in a background terminal

From VS Code Copilot or a PowerShell terminal, run:

```powershell
wsl -d Ubuntu -- bash -lc "/usr/bin/node /home/hartmanr/openclaw/dist/index.js gateway --port 18789"
```

Run this as a **background** terminal (in Copilot: `isBackground: true`) so it stays alive. The gateway process must keep running — if the terminal dies, the gateway dies.

Wait for the log line:
```
[gateway] listening on ws://127.0.0.1:18789 (PID xxx)
```

### Step 2 — Open the dashboard with token

The gateway requires an auth token. Open the Simple Browser at:

```
http://127.0.0.1:18789/?token=4c92d5b0d66f7b62143f292948dee5f9674880d0b9022877
```

**Do not** open `http://127.0.0.1:18789/` without the token — it will fail with "unauthorized: gateway token missing".

### That's it — two steps

No systemd, no multiple terminals, no retries. One background command + one URL.

---

## Copilot Agent Instructions

When the user asks to "start OpenClaw" or "connect to OpenClaw", do exactly this:

1. Run the gateway command in a **background** terminal (`isBackground: true`):
   ```
   wsl -d Ubuntu -- bash -lc "/usr/bin/node /home/hartmanr/openclaw/dist/index.js gateway --port 18789"
   ```
2. Wait a few seconds, then check the terminal output for `[gateway] listening on ws://127.0.0.1:18789`.
3. Open Simple Browser at `http://127.0.0.1:18789/?token=4c92d5b0d66f7b62143f292948dee5f9674880d0b9022877`
4. Done.

**Do not:**
- Use `systemctl` (the systemd service doesn't bind the port reliably)
- Background with `&` inside the bash command (the process dies when bash exits)
- Open the dashboard without the `?token=` query parameter
- Spawn multiple terminals to "test" the connection

---

## Daily Use

### Dashboard URL (bookmark this)

```
http://127.0.0.1:18789/?token=4c92d5b0d66f7b62143f292948dee5f9674880d0b9022877
```

### Useful Commands (WSL terminal)

| Command | What it does |
|---|---|
| `openclaw status` | Full system status + sessions |
| `openclaw models list` | Show current model |
| `openclaw models set <model>` | Switch model |

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

## Stopping the Gateway

The gateway is just a foreground Node.js process in a VS Code terminal. To stop it:

- **Kill the terminal** in VS Code, or
- **Ctrl+C** in the terminal, or:

```bash
# From WSL
kill $(pgrep -f "openclaw.*gateway")
```

To restart: just run the startup command again (Step 1 above).

### Token Reference

The gateway token lives in `~/.openclaw/openclaw.json` under `gateway.auth.token`. If the token changes, update the dashboard URL accordingly.

---

## Future Expansion

- **WhatsApp** — voice memo → agent pipeline (connected, not yet configured)
- **Additional channels** — Telegram, Discord (as needed)
- **Multi-device** — Android phone (voice capture), Meta Quest VR (TBD)
- **Sub-agents** — Specialized agents for aero research, code dev, testing
- **Skills** — ElevenLabs TTS, OpenAI image gen, custom polar-dev skill
