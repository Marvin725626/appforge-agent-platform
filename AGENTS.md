# AppForge Codex Working Rules

## Instruction Priority

- Follow the current task prompt first.
- Use this file for repository-wide working rules.
- Ask for clarification only when the requested scope is genuinely ambiguous.

## Stable Modules

- Phase 3.5.1 and Phase 4.1 are stable.
- Do not modify stable modules unless the current task explicitly requires it.
- Preserve behavior outside the requested scope.
- Make the smallest coherent change.
- Do not refactor unrelated code.

## Context and Token Control

- Do not scan or summarize the entire repository.
- Search for exact symbols before opening files.
- Read only relevant code ranges around search results.
- Do not reopen files already inspected unless necessary.
- Avoid reading README files, historical files, generated artifacts, and unrelated tests.
- Prefer modifying existing functions over creating new abstraction layers.
- Do not add dependencies unless strictly required.
- Stop investigating once enough evidence exists to implement the requested change.

## Testing

- Run targeted tests while implementing.
- Do not repeatedly run the complete test suite.
- Run full typecheck and tests once after targeted tests pass.
- Do not rerun passing tests without a concrete reason.
- Do not run npm install unless dependency manifests changed.

## Change Discipline

- Do not perform repository-wide formatting.
- Do not rename unrelated symbols or files.
- Do not modify Focused Edit, Requirement Ledger, Browser Probe, or DesignPlan unless explicitly requested.
- Do not rewrite large existing files for a small localized change.
- Do not add new agents or frameworks unless the task requires them.

## Final Response

Return only:

- Changed files
- Test results
- Remaining limitations

Do not provide a long architecture summary.
