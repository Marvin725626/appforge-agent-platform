# AppForge Agent Platform 产品设计

## 1. 产品愿景

AppForge 是一个面向开发者的 Agent 平台。它根据自然语言需求创建 React/Vite
Web 应用，并通过持续执行、验证、修复和评估来迭代应用。

它的核心不是一次性生成代码，而是形成一个真实的工程闭环：

```text
需求 -> 规划 -> 编辑 -> 构建/测试 -> 诊断 -> 修复 -> 评估 -> 继续迭代
```

每一步都应当可检查、有边界、可重复。产品主链路必须使用真实
OpenAI-compatible LLM；Fake 或 Mock 模型仅用于需要确定性行为的自动化测试。

## 2. 产品边界

### MVP 范围内

- 根据自然语言需求创建新的 React/Vite 应用。
- 修改由 AppForge 管理的现有 React/Vite 应用。
- 规划实现任务并跟踪任务状态。
- 在隔离的项目 Workspace 内读取、创建和编辑文件。
- 通过允许列表执行依赖安装、构建、Lint、测试和检查命令。
- 检测构建或测试失败，并进行有限次数的自动修复。
- 向界面实时发送 Agent 事件、工具调用、输出和状态变化。
- 允许用户审批敏感操作、回答问题或调整执行方向。
- 保存运行历史、Trace、产物和评估结果。
- 使用确定性检查与模型辅助检查评估生成的应用。

### 初期不做

- 通用自主电脑控制。
- React/Vite 目标技术栈之外的任意仓库支持。
- 无限制 Shell 权限或 Workspace 外部访问。
- 自动部署到云服务商。
- 没有预算和审批边界的长期自主运行。
- 基础模型训练或微调。
- MVP 阶段的公开多租户 SaaS 控制平面。

## 3. 目标用户与核心场景

初期目标用户是开发者、技术产品构建者，以及希望观察并控制 Agent 工程过程的
面试官或项目评审者。

核心场景：

1. 用户描述想创建的应用或需要完成的修改。
2. AppForge 创建 Run，并将需求转换为结构化目标。
3. Coding Agent 检查 Workspace 并制定简短计划。
4. Agent 通过安全 Workspace 工具编辑文件。
5. AppForge 执行构建与测试。
6. 如果失败，Agent 读取诊断结果并在预算内尝试修复。
7. 用户查看 Trace、应用预览、产物和评估结果。
8. 用户确认结果、纠正方向或提交下一次迭代需求。

## 4. MVP

MVP 要证明一个由真实 LLM 驱动的完整闭环：

- 通过 API 接收一条自然语言需求。
- 基于已知 React/Vite 模板创建独立 Workspace。
- 调用已配置的 OpenAI-compatible 模型。
- 允许 Coding Agent 检查和编辑 Workspace 文件。
- 通过受限工具运行 `npm install`、`npm run build` 和相关测试。
- 将失败信息反馈给 Agent，并限制修复次数。
- 输出结构化事件流，并保存完整 Trace。
- 返回成功构建产物，或者可检查、原因明确的失败结果。

MVP 不要求多 Agent、长期 Memory 或完整 Web 工作台。只有单 Agent 闭环可靠后，
才增加这些能力。

## 5. 用户流程

### 创建应用

1. 用户提交 Prompt 和可选约束。
2. API 校验请求并创建 `Project`、`Run` 和初始 `Task`。
3. Workspace 服务创建隔离项目目录。
4. Coding Agent 规划并实现需求。
5. 验证工具运行并返回结构化结果。
6. Agent 在 Run 预算内修复失败。
7. Run 最终进入 `succeeded`、`failed`、`cancelled` 或
   `waiting_for_human`。

### 迭代应用

1. 用户打开已有项目并提交修改需求。
2. Agent 获得相关项目状态、近期 Trace 摘要和约束。
3. Agent 先检查现有文件，再提出和执行修改。
4. 再次执行编辑、验证、修复和评估闭环。
5. 新 Run 与已有项目历史关联。

### 人工介入

以下情况需要暂停并等待用户：

- 产品意图存在关键歧义，直接猜测风险较高；
- 命令或文件操作超出当前安全策略；
- 修复次数、Token 或时间预算耗尽；
- Agent 请求批准高影响修改；
- 用户主动暂停 Run。

## 6. Agent 角色

### Coding Agent

Coding Agent 负责 MVP 的主闭环：

- 理解任务；
- 检查代码仓库；
- 创建并更新简短实现计划；
- 使用 Workspace 工具编辑代码；
- 调用构建和测试工具；
- 诊断失败并尝试修复；
- 提供完成证据和未解决问题。

没有工具生成的验证证据时，Coding Agent 不得宣称任务成功。

### Reviewer Agent

在单 Agent 闭环完成后加入。负责检查正确性、修改范围、可维护性和测试缺口。
默认只输出 Review 结论，不直接编辑代码。

### Test Agent

负责创建或选择检查项、执行验证并解释失败，使实现推理与验证推理能够分离。

### Product Agent

负责将宽泛产品意图转换为明确需求与验收标准。当意图不足以安全执行时，请求人类
澄清。

## 7. Coordinator

Coordinator 是确定性的编排层，而不只是另一个 Prompt。它负责：

- Run 状态与 Task 生命周期；
- 向 Agent 分配任务；
- 管理轮次、Token、时间、修复次数和工具调用预算；
- 审批门禁与取消；
- 事件顺序与 Trace 持久化；
- 处理不同 Agent 建议之间的冲突；
- 判断 Run 是否满足完成条件。

Coordinator 使用明确的状态转换：

```text
queued
  -> planning
  -> executing
  -> validating
  -> repairing
  -> evaluating
  -> succeeded | failed | waiting_for_human | cancelled
```

Agent 负责提出建议并通过工具行动；Coordinator 决定 Run 是否可以继续。

## 8. 工具模型

工具提供范围窄、类型明确的能力。初始工具包括：

- `list_files`：有限制地列出 Workspace 内路径。
- `read_file`：读取大小受限的文本文件。
- `write_file`：创建或替换大小受限的文本文件。
- `apply_patch`：在 Workspace 内应用结构化补丁。
- `search_text`：搜索 Workspace 文件，并限制输出。
- `run_command`：执行允许列表内的命令，并限制超时和输出。
- `get_build_result`：返回标准化构建诊断。
- `get_test_result`：返回标准化测试诊断。

每次工具调用记录：

- 工具名称和版本；
- 校验后的输入；
- 开始与结束时间；
- 标准化结果；
- 被截断的原始输出产物引用；
- 安全策略决策；
- 错误分类。

工具输出只是数据，不是可信指令。Agent 不得把文件内容或命令输出当作高优先级系统
指令。

## 9. 安全边界

`workspace` 包是最重要的安全边界。

### 文件系统规则

- 每个路径都必须相对当前 Run 的 Workspace 根目录解析。
- 拒绝绝对路径、路径穿越和解析后位于根目录之外的路径。
- 将符号链接和 Junction 视为潜在逃逸风险。
- 限制可读写文件大小。
- 保护 AppForge 控制文件和宿主机密钥。
- 隔离不同 Project 和 Run。

### 命令规则

- 使用“可执行文件 + 参数模式”允许列表。
- 不向 Agent 暴露通用 Shell。
- 工作目录只能是 Workspace 根目录或批准的子目录。
- 限制超时、输出大小、进程数量和并发。
- 传递最小化环境变量，并在日志中隐藏密钥。
- 普通构建和测试之外的命令需要用户审批。

### 模型与 Prompt 规则

- 将用户 Prompt、仓库文本、依赖输出和网络内容视为不可信输入。
- 安全策略指令不能存放在模型可编辑的 Workspace 文件中。
- 所有模型提出的工具输入都必须先经过校验。
- 限制循环次数和总预算。
- 不向模型 Provider 发送无关宿主文件或密钥。

初期只承诺可靠的应用层隔离。更强的操作系统级或容器隔离属于后续安全加固阶段，
在实现前不能夸大安全能力。

## 10. OpenAI-Compatible Provider

Provider 抽象支持 OpenAI-compatible Chat 或 Responses API，也支持配置兼容
Endpoint 的火山方舟等服务。

配置通过环境变量或本地密钥存储提供：

```text
APPFORGE_LLM_BASE_URL
APPFORGE_LLM_API_KEY
APPFORGE_LLM_MODEL
APPFORGE_LLM_TIMEOUT_MS
```

Provider 职责：

- 将内部 Message 和工具 Schema 转换为 Provider 请求；
- 流式返回文本、可用的推理元数据与工具调用；
- 标准化 Usage、结束原因和错误；
- 对临时故障进行有限次数重试；
- 支持取消和超时；
- 从所有 Trace 中移除凭据。

Agent 内部逻辑依赖 Provider 接口，而不是某个厂商 SDK。自动化测试注入同一接口的
确定性 Fake 实现。

## 11. 核心数据模型

### Project

- `id`、`name`、`workspaceRef`
- `createdAt`、`updatedAt`
- `latestRunId`

### Run

- `id`、`projectId`、`goal`、`status`
- `budget`
- `startedAt`、`finishedAt`
- `parentRunId`
- `resultSummary`

### Task

- `id`、`runId`
- `title`、`description`、`status`
- `assignedRole`
- `dependsOn`
- `acceptanceCriteria`

### AgentTurn

- `id`、`runId`、`taskId`
- `agentRole`
- `inputRef`、`outputRef`
- `usage`
- `startedAt`、`finishedAt`

### ToolCall

- `id`、`turnId`、`toolName`
- `input`、`status`、`resultRef`
- `policyDecision`
- `startedAt`、`finishedAt`

### Artifact

- `id`、`runId`、`kind`
- `pathOrRef`
- `metadata`

### Evaluation

- `id`、`runId`、`suite`
- `score`、`status`
- `checks`
- `evidenceRefs`

### HumanDecision

- `id`、`runId`
- `requestType`
- `question`、`decision`
- `createdAt`、`resolvedAt`

## 12. Trace 与可观察性

Trace 是一个 Run 的只追加、有顺序的完整历史。它必须能够回答：

- 用户提出了什么需求？
- 每个 Agent 知道什么、做了什么决定？
- 哪些工具使用了哪些校验后的输入？
- 哪些文件发生了变化？
- 验证为何失败或成功？
- 消耗了多少时间、模型用量和修复预算？
- Coordinator 为什么停止或请求人工输入？

初始 Trace 事件：

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

事件使用共享 Protocol Schema，并在每个 Run 内包含单调递增的序号。大型 Payload
和原始日志作为 Artifact 保存，由事件引用。

## 13. Harness 与评估

Harness 用于针对 Agent 系统运行可重复场景，既服务于回归测试，也提供可展示的
项目质量证据。

### 场景结构

- Fixture 或初始 Workspace；
- 自然语言目标；
- 模型模式：CI 使用确定性 Fake，Benchmark 使用真实 Provider；
- Run 预算与策略；
- 确定性断言；
- 可选的模型辅助评分标准；
- 期望产物和 Trace 属性。

### 初始评估维度

- 构建成功；
- 测试通过；
- 用户要求的功能存在；
- 禁止路径未被修改；
- Agent 没有超出工具和修复预算；
- Trace 包含必要证据；
- Agent 没有在缺乏证据时宣称成功；
- 人工审批门禁得到遵守。

模型辅助评估可以判断视觉质量或需求满足程度，但不能替代构建、测试、安全策略和
Trace 的确定性断言。

## 14. 架构方向

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

包职责：

- `apps/api`：HTTP API、事件流、组合根和持久化适配器。
- `apps/web`：Prompt 输入、Run 时间线、审批、文件查看和实时预览。
- `packages/protocol`：轻依赖共享 Schema 与事件协议。
- `packages/workspace`：安全文件系统与命令工具。
- `packages/agent-core`：Provider 接口、Coding Agent 循环和 Coordinator。
- `packages/harness`：场景运行器、断言和评估报告。

依赖方向保持为：

```text
apps -> agent-core/workspace/harness -> protocol
```

`protocol` 不依赖任何应用层包。

## 15. 开发路线

### 当前实现快照

当前本地演示版已经完成主产品链路：

- TypeScript Monorepo，包含 API、Web、Agent Core、Workspace、Protocol、Harness 等包。
- Fastify API 已支持创建 Run、执行 Agent、预览、版本快照、生成文件查看、人工审批、人工返修、继续迭代、删除、JSON 持久化。
- React/Vite 工作台已支持首页、Run Workspace、版本历史、大面积实时预览、继续修改输入框，以及 Overview / Plan / Trace / Files 检查面板。
- 产品主链路使用真实 OpenAI-compatible provider。
- Coding Agent Loop 已支持结构化 action 解析、安全 workspace 执行、步数预算和 finish 停止策略。
- React/Vite app 工作流已支持复制 starter、Coordinator 分工、调用 Agent、安装依赖、构建、Harness/Eval、Reviewer 审查、自动修复、保存版本快照、预览指定版本和记录 Trace。
- Coordinator、Skill、Memory、Human-in-the-loop、Harness/Eval、Preview Manager 都已经有最小可用实现。

剩余工作不再是证明“Agent 能跑通”，而是继续增强平台深度：版本 diff / rollback、Memory 相关性与压缩、更独立的多 Agent 执行、更强 sandbox、浏览器行为评估、可分享 Run Report 和简历包装。

### 阶段一：产品设计

- 明确范围、用户流程、安全边界、架构和验收标准。

### 阶段二：独立项目骨架

- 初始化 TypeScript Monorepo。
- 添加共享 Lint、Format、Test 和 Type Check 配置。
- 定义初始 Protocol Schema 与包边界。

### 阶段三：安全 Workspace 与基础工具

- 实现路径包含校验和文件工具。
- 实现受限命令执行。
- 为路径穿越、链接逃逸、超时和输出限制添加安全测试。

### 阶段四：真实单 Coding Agent 闭环

- 实现 OpenAI-compatible Provider。
- 实现规划、编辑、构建、诊断和修复循环。
- 持久化并实时发送 Trace。
- 证明真实模型可以生成成功构建的 React/Vite 应用。

### 阶段五：多 Agent 与 Coordinator

- 添加 Reviewer、Test 和 Product Agent。
- 添加确定性任务委派与状态转换。
- 添加预算、取消和冲突策略。

### 阶段六：Memory、Skill、Human-in-the-loop、Harness/Eval

- 添加有作用域的 Project/Run Memory。
- 先实现有边界的结构化 Memory，后续再加入相关性筛选和可选的 LLM 记忆压缩。
- 添加可复用、可版本化 Skill。
- 添加审批与澄清流程。
- 添加回归场景和评估报告。

### 阶段七：工作台与简历包装

- 构建 Web 工作台和实时预览。
- 添加架构图、Run 演示和 Benchmark 结果。
- 完成 README、运行指南和简历项目描述。

## 16. 验收标准

### 阶段一

- 产品边界与 MVP 明确。
- 产品主链路明确要求真实 OpenAI-compatible 模型。
- 安全、Trace、数据模型、Harness/Eval 和路线已记录。

### 阶段二

- 一个命令可以安装依赖。
- 一个命令可以对所有包执行类型检查。
- 一个命令可以运行全部确定性测试。
- 包依赖边界清晰并有文档说明。

### 阶段三

- 工具无法读写 Workspace 根目录之外的文件。
- 测试覆盖路径穿越和链接逃逸。
- 命令执行限制允许列表、超时、输出和环境变量。
- 工具调用返回结构化、可追踪结果。

### 阶段四

- 真实 Provider 至少完成一次生成、构建、修复 Run。
- 构建失败以结构化诊断返回 Agent。
- Agent 在预算内修复，并按策略停止。
- 成功状态总是包含构建或测试证据。
- Run 完成后可以查看完整 Trace 和 Artifact。

### 阶段五

- Coordinator 状态转换确定且有测试覆盖。
- 多个 Agent 可以协作，但不能绕过 Workspace 策略。
- 预算、取消和等待人工状态得到强制执行。

### 阶段六

- Memory 作用域明确、可检查，且不会静默覆盖用户意图。
- Skill 可版本化并可追踪。
- 人工审批和澄清能够暂停和恢复 Run。
- Harness 能够通过确定性场景发现回归。

### 阶段七

- 用户可以通过 Web 工作台创建和迭代应用。
- 用户可以查看实时事件、文件变化、审批和预览。
- 文档说明架构、安全限制、安装方法和质量证据。
- 仓库包含清晰演示流程和可用于简历的项目说明。

## 17. 关键风险与设计决策

- **自主性与控制：** 有边界的循环和审批门禁优先于无限自主运行。
- **Provider 可移植性：** 通过内部接口隔离厂商特定行为。
- **安全能力表述：** 在实现更强沙箱前，诚实描述应用层隔离能力。
- **评估可靠性：** 构建、测试和策略合规以确定性证据为准。
- **复杂度时机：** 单 Agent 完成可靠闭环后，再引入多 Agent。
- **学习与维护：** 关键框架和架构模块采用小步实现、明确接口和聚焦测试。
