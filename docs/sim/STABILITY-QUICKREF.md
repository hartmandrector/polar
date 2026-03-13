# Stability Analysis — Quick Reference

## Commands

```bash
cd polar-visualizer
```

### Run analysis (terminal + HTML report)
```bash
npx tsx scripts/eigenvalue-analysis.ts a5segments        # wingsuit sweep
npx tsx scripts/eigenvalue-analysis.ts ibexul             # canopy sweep
npx tsx scripts/eigenvalue-analysis.ts a5segments 35      # single speed (includes A matrix)
```

### Save baseline (before tuning)
```bash
npx tsx scripts/eigenvalue-analysis.ts a5segments --save-baseline
npx tsx scripts/eigenvalue-analysis.ts ibexul --save-baseline
```

### Compare against baseline (after tuning)
```bash
npx tsx scripts/eigenvalue-analysis.ts a5segments --compare
```

### Flags
| Flag | Effect |
|------|--------|
| `--save-baseline` | Save current run as baseline JSON |
| `--compare` | Overlay baseline in terminal + HTML |
| `--no-html` | Skip HTML report |
| `--no-print` | Skip terminal output |

### Available polars
| Name | Type | Segments |
|------|------|----------|
| `a5segments` | Wingsuit (Aura 5) | 6 |
| `ibexul` | Canopy (Ibex UL) | 16 |
| `slicksin` | Slick (skydiver) | — |
| `aurafive` | ⚠️ Single-body, no segments — use `a5segments` |

## Outputs

| File | Location |
|------|----------|
| Terminal | stdout |
| JSON (latest) | `scripts/results/<polar>-latest.json` |
| JSON (baseline) | `scripts/results/<polar>-baseline.json` |
| HTML report | `scripts/results/<polar>-report.html` |

## Tuning Workflow

1. `--save-baseline` → lock current state
2. Edit coefficients in `src/polar/polar-data.ts`
3. `--compare` → see what changed (terminal deltas + HTML overlay)
4. Repeat until trim conditions and modes match GPS data
5. `--save-baseline` → lock new state

## Detailed Analysis

See `docs/sim/STABILITY-ANALYSIS.md` for mode interpretation, physical meaning, and gamepad filter recommendations.
