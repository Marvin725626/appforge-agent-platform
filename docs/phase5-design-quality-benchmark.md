# Phase 5.1 — Design Quality Benchmark

Phase 5.1 adds an offline-first quality benchmark for the schema-driven stable page generator. It does not change the production generation state machine.

## Coverage

The benchmark includes 24 prompts: three prompts for each supported application type.

- game
- dashboard
- product
- commerce
- editorial
- institution
- portfolio
- custom

Each case records the expected application type, required concepts, recommended section kinds, density, and surface strategy.

## Scoring

Every generated page receives a 0–100 score across five dimensions:

1. Requirement coverage — 25 points
2. Content quality — 20 points
3. Visual hierarchy — 20 points
4. Template distinctiveness — 15 points
5. Responsive behavior and accessibility — 20 points

The default case threshold is 75. The suite gate requires at least a 95% pass rate and an average score of at least 82.

## Commands

Run the deterministic offline benchmark:

```bash
npm run benchmark:design
```

Run a limited real-model benchmark using the configured `.env`:

```bash
npm run benchmark:design:ai --workspace @appforge/api -- --limit=3
```

Use `--strict` to return a non-zero process exit code when the suite gate fails:

```bash
npm run benchmark:design:ai --workspace @appforge/api -- --limit=3 --strict
```

Reports are written to:

```text
artifacts/design-benchmark/design-quality-report.json
artifacts/design-benchmark/design-quality-report.md
```

The `artifacts/` directory remains ignored by Git.

## Fallback diversity

Fallback template selection is deterministic but no longer always chooses the first template. It hashes the normalized goal and chooses a type-compatible variant. This lets the offline benchmark exercise multiple templates without adding model calls or randomness.

## Current boundary

This benchmark evaluates the generated content model and deterministic renderer source. It does not yet launch 24 browser sessions. Browser-based screenshots, computed styles, contrast sampling, and cross-page visual similarity belong to Phase 5.2.
