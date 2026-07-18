# AppForge 当前状态

这份文档记录当前项目已经做到哪里，以及面试/演示时应该怎么讲。

## 已完成主线

```text
目标
  -> 创建 run
  -> Coordinator 生成计划和角色分工
  -> 调用真实 OpenAI-compatible LLM
  -> 解析结构化 Agent action
  -> 在安全 workspace 内写文件
  -> 安装依赖
  -> 构建 React/Vite 应用
  -> 静态 Harness/Eval
  -> Playwright Browser Eval
  -> Reviewer 审查
  -> 必要时自动修复
  -> 保存 trace/result/files/memory/version snapshot
  -> 实时预览
  -> Run Report
  -> 后续需求继续迭代
```

## 已实现模块

- `apps/api`：Fastify API、Run 编排、JSON 持久化、版本快照、三层 Memory、Preview Manager、Browser Harness 注入、Run Report。
- `apps/web`：React 工作台，包含首页、Run Workspace、版本历史、实时预览、Browser Checks、文件查看、Trace、Report 和继续迭代输入框。
- `packages/agent-core`：OpenAI-compatible provider、Coding Agent、Agent loop、Coordinator、Skill。
- `packages/workspace`：安全路径处理、文件操作、allowlisted command execution。
- `packages/protocol`：共享 Zod Schema 和协议类型。
- `packages/harness`：静态确定性评估和 Playwright 浏览器行为评估。
- `tests/fixtures/vite-react-starter`：每个 Run 会复制的 React/Vite starter。

## 真实能力

- 产品主链路调用真实 LLM。
- 生成代码会写进真实 workspace。
- `npm install` 和 `npm run build` 会真实执行。
- Browser Eval 会启动真实 Vite preview，并用 Playwright 检查页面行为。
- Browser Eval 失败会进入自动修复闭环，并把失败原因写进 repair context。
- Memory 会保存结构化执行经验、压缩长期 summary，并按当前 goal 检索相关经验。
- Run Report 会汇总执行证据，方便面试和作品展示。
- Fake/Mock 只用于自动化测试。

## 演示路线

1. 加载本地工具：

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   . .\scripts\use-local-tools.ps1
   ```

2. 启动后端：

   ```powershell
   npm run dev:api
   ```

3. 另开终端启动前端：

   ```powershell
   npm run dev:web
   ```

4. 打开 `http://127.0.0.1:5173`。

5. 输入目标，例如：

   ```text
   创建一个介绍温州的中文页面，包含美食、景点和交通信息。
   ```

6. 执行 Run，并展示：

   - 中间的大面积实时预览；
   - Preview 下方的 Browser Checks；
   - 左侧 v1/v2/v3 版本快照；
   - 右侧 Plan、Trace、Report、Files；
   - Trace 中的 install、build、eval、browser eval、review；
   - Report 中的面试可讲总结；
   - 成功后继续输入修改需求并生成新版本。

## 当前限制

- 版本系统已支持快照和指定版本预览，但还没有 diff 和 rollback。
- Memory 已完成三层 MVP，但 LLM 压缩和 embedding/RAG 检索仍是后续增强。
- 多 Agent 目前主要体现在 Coordinator 的角色分工，多个独立 LLM 子 Agent 仍是后续路线。
- 当前使用 JSON 文件做本地持久化，不是生产数据库。
- Workspace 是应用层安全边界，还没有容器级沙箱。
- Browser Harness 已支持行为检查，但截图对比、可访问性检查、视觉质量评估仍待增强。

## 下一步增强

1. 版本 diff 和 rollback。
2. LLM/RAG Memory 升级。
3. 更真实的多 Agent 执行。
4. 图片 Asset Tool 与 MCP 适配层：支持受控图片搜索或生成，校验来源、
   MIME 类型、文件大小和超时，并将安全资产保存到 workspace 的
   `public/assets`；内部 Provider 接口与 MCP 解耦。
5. Browser Harness 增强：截图对比、可访问性、更多目标场景。
6. Share/export：Run Report、截图、产物导出，用于简历和面试展示。
