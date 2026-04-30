# Meeting Notes Convention

## Purpose
Keep Polar Claw (CEO agent) informed about work done in other sessions
(VS Code Copilot, sub-agents, etc.) so organizational context stays current.

## How It Works

At the end of each working session with an AI agent, ask it to write a
meeting summary. Use this prompt (or similar):

> Write a meeting summary of our session to `memory/meetings/YYYY-MM-DD-topic.md`
> following the template in `memory/meetings/TEMPLATE.md`.

### File naming
```
memory/meetings/YYYY-MM-DD-topic.md
```
Examples:
- `2026-02-18-model-geometry-measurements.md`
- `2026-02-19-canopy-scale-refactor.md`
- `2026-02-19-output-schema-design.md`

Multiple meetings on the same day: use different topic slugs.

### What Polar Claw does with these
- Reads new entries on session start (via memory_search)
- Updates MEMORY.md with key decisions and status changes
- Flags conflicts or questions back to Hartman

### When to skip
- Trivial changes (typo fixes, formatting)
- Already communicated via WhatsApp message

### When to always write one
- Architectural decisions
- File structure changes
- New constants, position changes, or tuning values
- Anything that changes how the system works
