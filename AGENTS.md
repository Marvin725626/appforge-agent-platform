# AppForge Codex Working Rules

## Scope

- Phase 3.5.1 and Phase 4.1 are stable.
- Do not modify stable modules unless the current task explicitly requires it.
- Make the smallest coherent change.
- Do not refactor unrelated code.

## Context and Token Control

- Do not scan or summarize the whole repository.
- Search for exact symbols before opening files.
- Read only the relevant code ranges around search results.
- Do not reopen files already inspected unless necessary.
- Avoid reading README, historical files, generated artifacts, and unrelated tests.
- Prefer modifying existing functions over adding new abstraction layers.
- Do not add dependencies unless strictly required.

## Testing

- Run targeted tests while implementing.
- Do not repeatedly run the complete test suite.
- Run full typecheck and tests once after targeted tests pass.
- Do not rerun passing tests without a concrete reason.

## Changes

- Do not perform repository-wide formatting.
- Do not rename unrelated symbols or files.
- Do not modify Focused Edit, Requirement Ledger, Browser Probe, or DesignPlan unless explicitly requested.
- Preserve existing behavior outside the requested scope.

## Response

Return only:

- Changed files
- Test results
- Remaining limitations

Do not provide a long architecture summary.