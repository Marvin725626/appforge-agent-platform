# AppForge Current Status

This document summarizes the current implementation state for demo, resume, and
next-step planning.

## Completed Mainline

The core product loop is implemented:

```text
goal
  -> create run
  -> coordinate plan and roles
  -> call real OpenAI-compatible LLM
  -> parse structured Agent action
  -> write files in a safe workspace
  -> install dependencies
  -> build generated React/Vite app
  -> evaluate with Harness checks
  -> evaluate behavior with Playwright browser checks
  -> review result
  -> repair if needed
  -> store trace/result/files/memory/version snapshot
  -> preview in the web workbench
  -> iterate with follow-up prompts
```

## Implemented Modules

- `apps/api`: Fastify API, run orchestration, JSON persistence, version
  snapshots, three-layer memory MVP, preview manager.
- `apps/web`: React workbench with landing page, run workspace, version history,
  live preview, files, trace, and iteration prompt.
- `packages/agent-core`: OpenAI-compatible provider, Coding Agent, Agent loop,
  Coordinator, Skill, Memory, reviewer, and React app runner.
- `packages/workspace`: safe path handling, file operations, and allowlisted
  command execution.
- `packages/protocol`: shared Zod schemas and protocol types.
- `packages/harness`: deterministic checks and Playwright browser checks for
  generated apps.
- `tests/fixtures/vite-react-starter`: starter template copied into each run
  workspace.

## Demo Path

1. Load local tools:

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   . .\scripts\use-local-tools.ps1
   ```

2. Start the API:

   ```powershell
   npm run dev:api
   ```

3. Start the web app in another terminal:

   ```powershell
   npm run dev:web
   ```

4. Open `http://127.0.0.1:5173`.

5. Create a goal such as:

   ```text
   Create a Chinese landing page introducing Wenzhou, with sections for food,
   attractions, and transportation.
   ```

6. Execute the run.

7. Open the workspace and show:

  - live preview in the center;
  - Browser Checks under the preview;
  - v1/v2/v3 version snapshots on the left;
  - plan, trace, and generated files on the right;
  - repair feedback when a run needs human review;
  - follow-up prompt iteration after a successful generation.

## What Is Real

- The model provider is real in the product path.
- The generated code is written to a real workspace.
- `npm install` and `npm run build` are actually executed.
- Preview starts a real Vite dev process for the generated app or a selected
  version snapshot.
- Browser evaluation uses Playwright against that preview server and feeds
  failures into the automatic repair loop.
- Memory stores structured execution records, compacts them into long-term
  summaries, retrieves relevant records by keyword, and injects bounded context
  into later Agent runs.
- Test fakes are only used in automated tests.

## Known Limitations

- Version history now stores app snapshots, but diff and rollback are still
  planned.
- Memory relevance and compression are implemented as deterministic MVP
  strategies. LLM compaction and embedding/RAG retrieval are still planned.
- Multi-agent is represented by Coordinator assignments; fully independent LLM
  sub-agents are still planned.
- The app uses JSON files for local persistence, not a production database.
- The workspace boundary is application-level; container isolation is future
  hardening.

## Next Enhancements

1. Version diff and rollback: compare snapshots and restore an earlier version.
2. LLM/RAG memory upgrade: replace or augment rule-based compaction with LLM
   summarization, and replace keyword retrieval with embedding-based RAG.
3. Real multi-agent execution: planner, coder, reviewer, and test agents with
   separate turns.
4. Browser evaluation hardening: add screenshot comparison, accessibility checks,
   and more goal-specific browser scenarios.
5. Share/export: save run reports, screenshots, and artifacts for portfolio demos.

## End-to-End Demo Checklist

- Create a run from the web workbench.
- Execute the run and show real LLM-generated code.
- Show build, deterministic eval, browser eval, review, and trace evidence.
- Start preview and show Browser Checks under the live app.
- Submit a follow-up iteration and show a new version snapshot.
- Open generated files and explain the safe workspace boundary.
- Explain that fake providers are used only in tests; the product path uses the
  configured OpenAI-compatible provider.
