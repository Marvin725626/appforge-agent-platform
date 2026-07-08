# AppForge Architecture

AppForge is a local-first Agent platform for generating, validating, repairing,
previewing, and iterating React/Vite apps from natural language.

The system is intentionally split into three layers:

- **Workbench layer:** user-facing React UI for creating runs, previewing apps,
  inspecting trace/files/report, and submitting follow-up changes.
- **Orchestration layer:** Fastify API that owns run state, workspace creation,
  execution, versions, memory, preview, and report generation.
- **Agent execution layer:** real OpenAI-compatible LLM calls, safe workspace
  tools, deterministic eval, browser eval, review, and bounded repair.

## System Diagram

```mermaid
flowchart TD
    User["User"] --> Web["apps/web React workbench"]
    Web --> API["apps/api Fastify API"]

    subgraph APIBoundary["API orchestration"]
      API --> Repo["Run/result repository"]
      API --> Versions["Version snapshots"]
      API --> Memory["Memory repository"]
      API --> Coordinator["Coordinator"]
      API --> Runner["runReactAppAgent"]
      API --> Preview["Vite preview manager"]
      API --> Report["Run report builder"]
    end

    subgraph AgentBoundary["Agent execution"]
      Runner --> Skill["React/Vite skill"]
      Runner --> AgentLoop["Coding Agent loop"]
      AgentLoop --> Provider["OpenAI-compatible provider"]
      AgentLoop --> Workspace["Safe workspace tools"]
      Runner --> Harness["Deterministic Harness/Eval"]
      Runner --> BrowserHarness["Playwright Browser Harness"]
      Runner --> Review["Reviewer"]
    end

    Workspace --> Generated["Generated React/Vite app"]
    Preview --> Generated
    Preview --> BrowserHarness
    Repo --> Report
    Versions --> Report
    Memory --> Report
```

## Execution Loop

```mermaid
sequenceDiagram
    participant Web as Web Workbench
    participant API as Fastify API
    participant Agent as Coding Agent
    participant LLM as OpenAI-compatible LLM
    participant WS as Safe Workspace
    participant Eval as Harness/Eval
    participant Browser as Browser Harness
    participant Report as Run Report

    Web->>API: POST /runs
    API->>WS: Create isolated workspace
    Web->>API: POST /runs/:id/execute
    API->>Agent: Goal + skill + memory + coordination
    Agent->>LLM: Request structured action
    LLM-->>Agent: write_file / run_command / finish
    Agent->>WS: Execute validated action
    API->>WS: npm install + npm run build
    API->>Eval: Run deterministic checks
    API->>Browser: Run browser behavior checks
    API->>Agent: Repair with failure context if needed
    API->>Report: Aggregate trace, eval, browser, files, memory
    Web->>API: GET /runs/:id/report
    Report-->>Web: Portfolio-ready run summary
```

## Security Boundaries

- Model output is parsed as untrusted structured data.
- Workspace file operations are resolved inside a run-specific root.
- Command execution is allowlisted and bounded by timeout/output limits.
- Repair loops are bounded by `maxRepairAttempts`.
- Browser evaluation runs against a managed preview URL.
- Memory injection is bounded by relevance, entry count, and character budget.

## Why This Is More Than a Demo

AppForge does not stop at generating code. It records the evidence needed to
trust or reject a result:

- build result;
- deterministic eval checks;
- browser behavior checks;
- review decision;
- repair attempts;
- trace events;
- version snapshots;
- generated files;
- memory records;
- run report.

That evidence chain is what makes the platform explainable in a portfolio or
interview setting.
