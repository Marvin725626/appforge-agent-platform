# AppForge Agent Platform: Product Design

## 1. Product Vision

AppForge is a developer-facing Agent platform that creates and continuously
improves React/Vite web applications from natural-language requests.

The project is intended to demonstrate production-minded Agent engineering rather
than a one-shot code-generation demo. Its core value is the closed loop:

```text
request -> plan -> edit -> build/test -> diagnose -> repair -> evaluate -> iterate
```

Every step should be inspectable, bounded, and repeatable. The platform must use a
real OpenAI-compatible LLM in its primary workflow. Fake or mock models are allowed
only in automated tests where deterministic behavior is required.

## 2. Product Boundary

### In Scope

- Create a new React/Vite application from a natural-language request.
- Modify an existing AppForge-managed React/Vite application.
- Plan implementation work and track task status.
- Read, create, and edit files inside an isolated project workspace.
- Run an allowlisted set of package, build, lint, test, and inspection commands.
- Detect build or test failures and attempt bounded repairs.
- Stream Agent events, tool calls, outputs, and status changes to a UI.
- Let a human approve sensitive actions, answer questions, or redirect work.
- Store run history, traces, artifacts, and evaluation results.
- Evaluate generated applications with deterministic and model-assisted checks.

### Out of Scope for the Initial Product

- General-purpose autonomous computer control.
- Arbitrary repository support outside the React/Vite target stack.
- Unrestricted shell access or access outside the managed workspace.
- Production deployment to cloud providers.
- Fully autonomous long-running operation without budgets or approval gates.
- Fine-tuning or training foundation models.
- A public multi-tenant SaaS control plane in the MVP.

## 3. Target User and Core Scenario

The initial user is a developer, technical product builder, or interviewer who
wants to turn a product idea into a working frontend while observing and steering
the engineering process.

Primary scenario:

1. The user describes an application or change.
2. AppForge creates a run and converts the request into a structured goal.
3. A Coding Agent inspects the workspace and creates a short plan.
4. The Agent edits files through safe workspace tools.
5. AppForge runs build and test commands.
6. On failure, the Agent reads diagnostics and performs bounded repair attempts.
7. The user sees the trace, application preview, artifacts, and evaluation result.
8. The user approves, redirects, or submits the next iteration request.

## 4. MVP

The MVP proves one complete, real-LLM loop:

- Accept one natural-language request through an API.
- Create a dedicated workspace from a known React/Vite starter.
- Call a configured OpenAI-compatible model.
- Allow the model-driven Coding Agent to inspect and edit workspace files.
- Run `npm install`, `npm run build`, and focused tests through bounded tools.
- Feed failures back to the Agent for a limited number of repair attempts.
- Emit a structured event stream and persist a complete trace.
- Return a successful build artifact or a clear, inspectable failure.

The MVP does not require multi-agent delegation, long-term memory, or a polished
web workbench. Those are added only after the single-agent loop is reliable.

## 5. User Flow

### Create Application

1. User submits a prompt and optional constraints.
2. API validates the request and creates `Project`, `Run`, and initial `Task`.
3. Workspace service creates an isolated project directory.
4. Coding Agent plans and implements the request.
5. Validation tools run and produce structured results.
6. Agent repairs failures within its run budget.
7. Run finishes as `succeeded`, `failed`, `cancelled`, or `waiting_for_human`.

### Iterate Application

1. User opens an existing project and submits a change request.
2. Agent receives relevant project state, recent trace summaries, and constraints.
3. Agent inspects current files before proposing edits.
4. The same edit, validate, repair, and evaluate loop runs.
5. The new run is linked to the prior project history.

### Human Intervention

The run pauses when:

- required product intent is ambiguous and a guess would be costly;
- a command or file operation exceeds the current policy;
- the repair or token budget is exhausted;
- the Agent requests approval for a high-impact change;
- the user manually pauses the run.

## 6. Agent Roles

### Coding Agent

Owns the initial MVP loop. It:

- interprets the task;
- inspects the repository;
- creates and updates a concise implementation plan;
- uses workspace tools to edit code;
- invokes build and test tools;
- diagnoses failures and attempts repairs;
- reports completion evidence and unresolved issues.

The Coding Agent must not claim success without tool-produced validation evidence.

### Reviewer Agent

Added after the single-agent loop. It reviews changes for correctness, scope,
maintainability, and missing tests. It produces findings rather than directly
editing code by default.

### Test Agent

Creates or selects checks, runs relevant validation, and explains failures. It
helps separate implementation reasoning from verification reasoning.

### Product Agent

Turns broad product intent into explicit requirements and acceptance criteria. It
can request human clarification when intent is underspecified.

## 7. Coordinator

The Coordinator is a deterministic orchestration layer, not merely another prompt.
It owns:

- run state and task lifecycle;
- assignment of work to Agents;
- budgets for turns, tokens, time, repair attempts, and tool calls;
- approval gates and cancellation;
- event ordering and trace persistence;
- conflict handling between Agent recommendations;
- final completion rules.

The Coordinator should use explicit state transitions:

```text
queued
  -> planning
  -> executing
  -> validating
  -> repairing
  -> evaluating
  -> succeeded | failed | waiting_for_human | cancelled
```

Agents recommend and act through tools; the Coordinator decides whether the run may
continue.

## 8. Tool Model

Tools expose narrow, typed capabilities. Initial tools:

- `list_files`: list paths inside the workspace with limits.
- `read_file`: read a bounded text file.
- `write_file`: create or replace a bounded text file.
- `apply_patch`: apply a structured patch inside the workspace.
- `search_text`: search workspace files with bounded output.
- `run_command`: run an allowlisted command with timeout and output limits.
- `get_build_result`: return normalized build diagnostics.
- `get_test_result`: return normalized test diagnostics.

Every tool call records:

- tool name and version;
- validated input;
- start and end time;
- normalized result;
- truncated raw output artifact reference;
- policy decision;
- error classification.

Tool outputs are data, not trusted instructions. The Agent must never treat file
content or command output as privileged system guidance.

## 9. Safety Boundary

The workspace package is the primary security boundary.

### Filesystem Rules

- Resolve every path against a run-specific workspace root.
- Reject absolute paths, path traversal, and resolved paths outside the root.
- Treat symlinks and junctions as escape risks.
- Limit readable and writable file size.
- Protect AppForge control files and host secrets.
- Keep each project and run isolated.

### Command Rules

- Use an allowlist of executable plus argument patterns.
- Do not expose a general shell directly to the Agent.
- Set working directory to the workspace root or an approved child directory.
- Enforce timeout, output-size, process-count, and concurrency limits.
- Pass a minimal environment and redact secrets in logs.
- Require human approval for commands outside normal build and test operations.

### Model and Prompt Rules

- Treat user prompts, repository text, dependency output, and web content as
  untrusted.
- Keep policy instructions outside model-editable workspace files.
- Validate all model-proposed tool inputs before execution.
- Limit loop iterations and total budgets.
- Never send unrelated host secrets or files to the model provider.

The first implementation provides strong application-level isolation. Stronger OS
or container isolation is a later hardening milestone and must be clearly stated.

## 10. OpenAI-Compatible Provider

The provider abstraction supports OpenAI-compatible chat or response APIs,
including services such as Volcengine Ark when configured with a compatible
endpoint.

Configuration is supplied through environment variables or a local secret store:

```text
APPFORGE_LLM_BASE_URL
APPFORGE_LLM_API_KEY
APPFORGE_LLM_MODEL
APPFORGE_LLM_TIMEOUT_MS
```

Provider responsibilities:

- translate internal messages and tool schemas to provider requests;
- stream text, reasoning metadata when available, and tool calls;
- normalize usage, finish reasons, and errors;
- implement bounded retry for transient failures;
- support cancellation and timeout;
- redact credentials from all traces.

The internal Agent logic must depend on a provider interface, not a vendor SDK.
Automated tests inject a deterministic fake implementation of the same interface.

## 11. Core Data Model

### Project

- `id`
- `name`
- `workspaceRef`
- `createdAt`
- `updatedAt`
- `latestRunId`

### Run

- `id`
- `projectId`
- `goal`
- `status`
- `budget`
- `startedAt`
- `finishedAt`
- `parentRunId`
- `resultSummary`

### Task

- `id`
- `runId`
- `title`
- `description`
- `status`
- `assignedRole`
- `dependsOn`
- `acceptanceCriteria`

### AgentTurn

- `id`
- `runId`
- `taskId`
- `agentRole`
- `inputRef`
- `outputRef`
- `usage`
- `startedAt`
- `finishedAt`

### ToolCall

- `id`
- `turnId`
- `toolName`
- `input`
- `status`
- `resultRef`
- `policyDecision`
- `startedAt`
- `finishedAt`

### Artifact

- `id`
- `runId`
- `kind`
- `pathOrRef`
- `metadata`

### Evaluation

- `id`
- `runId`
- `suite`
- `score`
- `status`
- `checks`
- `evidenceRefs`

### HumanDecision

- `id`
- `runId`
- `requestType`
- `question`
- `decision`
- `createdAt`
- `resolvedAt`

## 12. Trace and Observability

A Trace is the append-only, ordered history of a run. It must make it possible to
answer:

- What did the user ask for?
- What did each Agent know and decide?
- Which tools ran with which validated inputs?
- Which files changed?
- Why did validation fail or pass?
- How much time, model usage, and repair budget was consumed?
- Why did the Coordinator stop or request human input?

Initial trace events:

- `run.created`
- `run.status_changed`
- `task.created`
- `task.status_changed`
- `agent.turn_started`
- `agent.message_delta`
- `agent.tool_requested`
- `tool.started`
- `tool.finished`
- `workspace.file_changed`
- `validation.finished`
- `human.input_requested`
- `human.input_received`
- `run.finished`

Events use shared protocol schemas and include a monotonically increasing sequence
number per run. Large payloads and raw logs are stored as artifacts and referenced
from events.

## 13. Harness and Evaluation

The Harness runs repeatable scenarios against the Agent system. It supports
development regression testing and portfolio-quality evidence.

### Scenario Structure

- fixture or starter workspace;
- natural-language goal;
- model mode: deterministic fake for CI or real provider for benchmark runs;
- run budget and policy;
- deterministic assertions;
- optional model-assisted rubric;
- expected artifacts and trace properties.

### Initial Evaluation Dimensions

- build succeeds;
- tests pass;
- requested features are present;
- forbidden paths are untouched;
- Agent stays within tool and repair budgets;
- trace contains required evidence;
- no unsupported success claim;
- human approval gates are respected.

Model-assisted evaluation may assess visual quality or requirement fulfillment, but
it cannot replace deterministic build, test, policy, and trace assertions.

## 14. Architecture Direction

```text
Web Workbench
    |
API / Event Stream
    |
Coordinator
    |
Agent Core ------ OpenAI-compatible Provider
    |
Typed Tools
    |
Safe Workspace ------ Build / Test / Preview
    |
Trace Store + Artifacts + Harness/Eval
```

Package ownership:

- `apps/api`: HTTP API, event streaming, composition root, persistence adapters.
- `apps/web`: prompt input, run timeline, approvals, file view, live preview.
- `packages/protocol`: dependency-light shared schemas and event contracts.
- `packages/workspace`: safe filesystem and command tools.
- `packages/agent-core`: provider interface, Coding Agent loop, Coordinator.
- `packages/harness`: scenario runner, assertions, evaluation reports.

Dependency direction should remain mostly inward:

```text
apps -> agent-core/workspace/harness -> protocol
```

`protocol` must not depend on application packages.

## 15. Delivery Roadmap

### Current Implementation Snapshot

The local portfolio/demo implementation has completed the main product loop:

- TypeScript monorepo with API, Web, Agent Core, Workspace, Protocol, and Harness
  packages.
- Fastify API with run creation, execution, preview, version snapshot
  inspection, generated-file inspection, human approval, repair feedback,
  iteration, deletion, and JSON persistence.
- React/Vite workbench with a landing page, run workspace, version history,
  large preview area, follow-up iteration prompt, and Overview/Plan/Trace/Files
  inspector.
- Real OpenAI-compatible provider used by the product path.
- Coding Agent loop with structured action parsing, safe workspace execution, and
  bounded step budget.
- React/Vite app workflow: copy starter, coordinate, call Agent, install, build,
  evaluate, review, repair, snapshot versions, preview selected versions, and
  record trace.
- Minimal Coordinator, Skill, Human-in-the-loop, Harness/Eval, and Preview
  Manager are implemented.
- Memory has a three-layer MVP: persistent execution records, deterministic
  summary compaction, and keyword-based retrieval before prompt injection.

The remaining work is no longer about proving the core Agent loop. The next
milestones are product polish and deeper platform capabilities: version diff and
rollback, LLM-based memory compaction, embedding/RAG retrieval, more independent
multi-agent execution, stronger sandboxing, richer browser-based evaluation, and
shareable run reports.

### Phase 1: Product Design

- Define scope, workflows, boundaries, architecture, and acceptance criteria.

### Phase 2: Independent Project Skeleton

- Initialize a TypeScript monorepo.
- Add shared lint, format, test, and type-check configuration.
- Define initial protocol schemas and package boundaries.

### Phase 3: Safe Workspace and Foundation Tools

- Implement path containment and file tools.
- Implement bounded command execution.
- Add security-focused tests for traversal, symlink, timeout, and output limits.

### Phase 4: Real Single Coding Agent Loop

- Implement OpenAI-compatible provider.
- Implement plan, edit, build, diagnose, and repair loop.
- Persist and stream traces.
- Prove a real model can produce a successful React/Vite build.

### Phase 5: Multi-Agent and Coordinator

- Add Reviewer, Test, and Product Agent roles.
- Add deterministic task delegation and state transitions.
- Add budget, cancellation, and conflict policies.

### Phase 6: Memory, Skills, Human-in-the-Loop, Harness/Eval

- Add scoped project/run memory.
- Start with bounded structured memory, deterministic compaction, and keyword
  retrieval; later add LLM-based memory consolidation and embedding/RAG
  retrieval for semantic relevance.
- Add reusable versioned Skills.
- Add approval and clarification workflows.
- Add regression scenarios and evaluation reports.

### Phase 7: Workbench and Portfolio Packaging

- Build the web workbench and live preview.
- Add architecture diagrams, run demonstrations, and benchmark results.
- Finish README, operational guide, and resume-ready project summary.

## 16. Acceptance Criteria

### Phase 1

- Product boundary and MVP are explicit.
- Main workflow requires a real OpenAI-compatible model.
- Safety, trace, data model, Harness/Eval, and roadmap are documented.

### Phase 2

- One command installs dependencies.
- One command type-checks all packages.
- One command runs all deterministic tests.
- Package dependency boundaries are understandable and documented.

### Phase 3

- Tools cannot read or write outside the workspace root.
- Traversal and link-based escape attempts are covered by tests.
- Command execution enforces allowlist, timeout, output, and environment limits.
- Tool calls return structured, traceable results.

### Phase 4

- A real configured provider completes at least one generate-build-repair run.
- Build failures are returned to the Agent as structured diagnostics.
- The Agent performs bounded repairs and stops according to policy.
- Success always includes build or test evidence.
- Complete trace and artifacts are available after the run.

### Phase 5

- Coordinator state transitions are deterministic and tested.
- Multiple Agent roles can collaborate without bypassing workspace policy.
- Budgets, cancellation, and human-wait states are enforced.

### Phase 6

- Memory is scoped, inspectable, and does not silently override user intent.
- Skills are versioned and traceable.
- Human approval and clarification can pause and resume runs.
- Harness detects regressions across deterministic scenarios.

### Phase 7

- User can create and iterate an application from the web workbench.
- User can inspect live events, changed files, approvals, and preview.
- Documentation explains architecture, security limitations, setup, and evidence.
- The repository contains a clear demo path and resume-ready project description.

## 17. Key Risks and Design Decisions

- **Autonomy versus control:** bounded loops and approval gates take priority over
  unbounded autonomy.
- **Provider portability:** internal contracts isolate provider-specific behavior.
- **Security claims:** application-level isolation is described honestly until
  stronger sandboxing exists.
- **Evaluation reliability:** deterministic evidence remains the source of truth
  for build, test, and policy compliance.
- **Complexity timing:** multi-agent behavior is delayed until one Agent can
  reliably complete the full loop.
- **Learning and maintainability:** important framework and architecture modules
  are implemented incrementally with explicit interfaces and focused tests.
