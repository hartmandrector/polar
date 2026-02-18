# Tool Notes — Polar Visualizer Workspace

## Build

- TypeScript strict mode, `npx tsc --noEmit` for type checking
- Vite for dev server (`npm run dev` → localhost:5173) and bundling
- vitest for testing (`npx vitest run` — 141+ tests must pass)
- Always run both tsc and vitest after any change

## Git

- Single branch (master), remote: github.com/hartmandrector/polar
- Commit after each logical unit of work
- Run tests before committing
- Use descriptive commit messages referencing the phase/feature

## File Locations

- Source: `polar-visualizer/src/`
- Tests: `polar-visualizer/src/tests/`
- Docs: project root (`*.md`)
- Models: `polar-visualizer/public/models/` (GLB files)
- Config: `polar-visualizer/tsconfig.json`, `polar-visualizer/vite.config.ts`

## Working with Windows Filesystem

- Workspace is at `/mnt/c/dev/polar` (Windows: `c:\dev\polar`)
- File edits are cross-filesystem — individual reads/writes are fine
- Do NOT run `npm install` or `pnpm install` on `/mnt/c/` — use Windows side for that
- `node_modules` was installed on the Windows side — native binaries (rollup, esbuild) won't work from WSL
- **`npx tsc --noEmit` works from WSL** (pure JS, no native binaries)
- **`npx vitest run` does NOT work from WSL** — rollup's native module fails cross-platform
- To run tests: use a Windows terminal (`cmd` or PowerShell), `cd c:\dev\polar\polar-visualizer`, then `npx vitest run`
- If tests can't be run (no Windows terminal access), at minimum run `npx tsc --noEmit` from WSL to verify type correctness

## Planning Documents

| Document | Purpose |
|---|---|
| `WINGSUIT-SEGMENTS.md` | Wingsuit 6-segment model — phases, checklists, tuning notes |
| `CONTINUOUS-POLAR.md` | Continuous polar architecture — segment math, interfaces |
| `POLAR-VISUALIZER.md` | Visualizer architecture — coordinate systems, rendering |
| `OPENCLAW-SETUP.md` | OpenClaw setup plan and workflow |
| `README.md` | Project overview |

## Conventions

- NED coordinate system for all physics
- Chord-fraction positions via `a5xc()` helper
- CP rendering uses negated offset in `vectors.ts`
- Check phase checklists in WINGSUIT-SEGMENTS.md before starting work
- Mark checklist items ✅ when completed
