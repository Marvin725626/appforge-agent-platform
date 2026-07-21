# Phase 5.2b — Multi-Viewport Visual Quality Gate

Phase 5.2b adds a browser-backed visual quality matrix without changing the stable schema-driven generation path.

## Viewports

Every visual page is evaluated at:

- 375 × 812 — mobile
- 768 × 1024 — tablet
- 1280 × 800 — desktop
- 1440 × 900 — wide desktop

## Checks

Each viewport reports:

1. page-level horizontal overflow;
2. critical overlap between visible headings, landmarks, and controls;
3. horizontal clipping of visible headings, controls, and layout landmarks;
4. sampled WCAG text contrast;
5. usable button-like control targets;
6. excessively small visible text.

Local table scrollers are allowed. A page-wide scrollbar is not.

## Artifacts

Run screenshots are written outside the generated workspace so they do not pollute the workspace diff or saved application version:

```text
apps/api/.appforge/artifacts/<run-id>/visual-evaluation/attempt-<n>/
  mobile-375x812.png
  tablet-768x1024.png
  desktop-1280x800.png
  wide-1440x900.png
```

The raw run result also contains a `browserEval.visualReport` object with per-viewport metrics and screenshot paths.

## Status behavior

Visual-only failures are advisory:

```text
build/typecheck/runtime PASS + visual matrix FAIL
→ waiting_for_human
→ preserve the runnable draft and screenshots
```

Runtime, build, typecheck, or root-render failures remain blocking and may enter repair or rollback handling.

## UI

When developer panels are enabled, the workspace shows a four-viewport summary with overflow, overlap, contrast, and target-size metrics.
