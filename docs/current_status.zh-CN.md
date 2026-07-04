# AppForge 当前状态

这份文档用来记录当前项目进度、演示路线和后续增强项。它比产品设计文档更贴近“现在代码已经做到哪里”。

## 已完成主线

核心产品链路已经跑通：

```text
输入目标
  -> 创建 run
  -> Coordinator 生成计划和角色分工
  -> 调用真实 OpenAI-compatible LLM
  -> 解析结构化 Agent action
  -> 在安全 workspace 内写文件
  -> 安装依赖
  -> 构建生成的 React/Vite 应用
  -> Harness 评估
  -> Reviewer 审查
  -> 必要时自动修复
  -> 保存 trace/result/files/memory
  -> 在 Web 工作台预览
```

## 已实现模块

- `apps/api`：Fastify API、run 编排、JSON 持久化、预览进程管理。
- `apps/web`：React 工作台，包含首页和 run workspace。
- `packages/agent-core`：OpenAI-compatible provider、Coding Agent、Agent loop、Coordinator、Skill、Memory、Reviewer、React app runner。
- `packages/workspace`：安全路径处理、文件操作、allowlisted command execution。
- `packages/protocol`：共享 Zod schema 和协议类型。
- `packages/harness`：对生成应用进行确定性检查。
- `tests/fixtures/vite-react-starter`：每个 run 创建时复制的 React/Vite starter。

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

6. 创建 run 并执行。

7. 进入 workspace 后展示：

   - 中间的大面积实时预览；
   - 左侧的版本尝试；
   - 右侧的 Plan、Trace、Files；
   - 如果需要人工介入，可以展示 Approve 和 Request Repair。

## 哪些是真实的

- 产品主链路调用真实 LLM。
- 生成代码会写入真实 workspace。
- `npm install` 和 `npm run build` 会真实执行。
- 预览会启动真实 Vite dev process。
- Fake/Mock 只用于自动化测试。

## 当前限制

- Version History 目前表示同一个 run 里的 attempts，还不是真正的 v1/v2/v3 应用版本。
- Memory 现在是结构化和有边界的，但还没有相关性排序、向量检索和压缩。
- 多 Agent 目前主要体现在 Coordinator 的角色分工，真正多个 LLM 子 Agent 独立执行还在后续路线。
- 当前使用 JSON 文件做本地持久化，不是生产数据库。
- workspace 是应用层安全边界，还没有容器级沙箱。

## 下一步增强

1. 真正的版本迭代：在已有 run/app 上继续修改，生成 v1/v2/v3 快照。
2. Memory 相关性和压缩：只选择和当前目标相关的记忆。
3. 更真实的多 Agent：planner、coder、reviewer、test agent 分开对话和协作。
4. 浏览器行为评估：用类似 Playwright 的方式检查生成 UI 是否真的可用。
5. 分享和导出：保存 run report、截图、产物，方便做简历和面试展示。
