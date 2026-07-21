# Phase 5.2 — Application-Type Visual Contract

This slice makes dashboard generation operational rather than promotional.

## Dashboard policy

- Dashboard pages do not request an AI hero image.
- The first viewport uses a compact operational overview.
- CPU, memory, and request latency are guaranteed in the metrics section.
- Health, online nodes/services, alerts, and refresh cadence are guaranteed in the summary band.
- Data table, status/alert content, and workflow timeline are preserved as required dashboard sections.

## Browser checks

The browser evaluator adds three dashboard-only checks:

1. operational overview is visible above the fold;
2. CPU, memory, and latency are visible above the fold;
3. no image or figure dominates more than 22% of the first viewport.

These checks are visual advisory gates. When engineering gates pass but only these checks fail, the draft is preserved for `waiting_for_human` instead of entering free-form repair or being rolled back.

## Commands

```powershell
npm test --workspace @appforge/api -- `
  src/application-visual-policy.test.ts `
  src/stable-page-content.test.ts `
  src/stable-react-page-generator.test.ts `
  src/review-react-app-agent.test.ts

npm test --workspace @appforge/harness -- `
  src/index.test.ts -t "dashboard above-fold visual contract"

npm run benchmark:design
npm run build
```
