# AppForge 当前状态

这份文档用于记录当前项目进度、演示路线和后续增强项。它比产品设计文档更贴近“现在代码已经做到哪里”。

## 已完成主线

核心产品链路已经跑通：

```text
输入目标
  -> 创建 Run
  -> Coordinator 生成计划和角色分工
  -> 调用真实 OpenAI-compatible LLM
  -> 解析结构化 Agent action
  -> 在安全 Workspace 内写文件
  -> 安装依赖
  -> 构建生成的 React/Vite 应用
  -> Harness/Eval 评估
  -> Reviewer 审查
  -> 必要时自动修复
  -> 保存 trace/result/files/memory/version snapshot
  -> 在 Web 工作台预览
  -> 输入后续修改需求继续迭代
```

## 已实现模块

- `apps/api`：Fastify API、Run 编排、JSON 持久化、版本快照、三层 Memory MVP、预览进程管理。
- `apps/web`：React 工作台，包含首页、Run Workspace、版本历史、实时预览、文件查看、Trace 和继续迭代输入框。
- `packages/agent-core`：OpenAI-compatible provider、Coding Agent、Agent loop、Coordinator、Skill、Memory、Reviewer、React app runner。
- `packages/workspace`：安全路径处理、文件操作、allowlisted command execution。
- `packages/protocol`：共享 Zod Schema 和协议类型。
- `packages/harness`：对生成应用进行确定性检查。
- `tests/fixtures/vite-react-starter`：每个 Run 创建时复制的 React/Vite starter。

## 演示路线

1. 加载本地 Node 工具：

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   . .\scripts\use-local-tools.ps1
   ```

2. 启动后端：

   ```powershell
   npm run dev:api
   ```

3. 另开一个终端启动前端：

   ```powershell
   npm run dev:web
   ```

4. 打开 `http://127.0.0.1:5173`。

5. 输入一个目标，例如：

   ```text
   创建一个介绍温州的中文页面，包含美食、景点和交通信息。
   ```

6. 创建 Run 并执行。

7. 进入 Workspace 后展示：

   - 中间的大面积实时预览；
   - 左侧的 v1/v2/v3 版本快照；
   - 右侧的 Plan、Trace、Files；
   - 需要人工介入时的 Approve / Request Repair；
   - 成功后继续输入后续修改需求并生成新版本。

## 哪些是真实的

- 产品主链路调用真实 LLM。
- 生成代码会写入真实 Workspace。
- `npm install` 和 `npm run build` 会真实执行。
- 预览会启动真实 Vite dev process。
- 版本历史会保存生成应用的文件快照。
- Memory 会写入本地 JSON 文件，压缩成长期 summary，并按当前 goal 检索相关经验后注入有界上下文。
- Fake/Mock 只用于自动化测试。

## 当前限制

- 版本系统已经支持快照和指定版本预览，但还没有 diff 和 rollback。
- Memory 已经完成三层 MVP：Persistent Memory、Summary Memory、Keyword Retrieval Memory。LLM 压缩和 embedding/RAG 检索仍是后续增强。
- 多 Agent 目前主要体现在 Coordinator 的角色分工，真正多个 LLM 子 Agent 独立执行还在后续路线。
- 当前使用 JSON 文件做本地持久化，不是生产数据库。
- Workspace 是应用层安全边界，还没有容器级沙箱。

## 下一步增强

1. 版本 diff 和 rollback：对比 v1/v2/v3，并允许恢复旧版本。
2. LLM/RAG Memory：用 LLM 提升长期总结质量，并用 embedding/RAG 替代或增强关键词检索。
3. 更真实的多 Agent：planner、coder、reviewer、test agent 分开对话和协作。
4. 浏览器行为评估：用类似 Playwright 的方式检查生成 UI 是否真的可用。
5. 分享和导出：保存 Run Report、截图、产物，方便做简历和面试展示。
