import { describe, expect, it } from "vitest";

import { isTaskAppGoal } from "./index.js";

describe("V9.4.2.2.1 requirement-driven task-app browser profile", () => {
  it("does not classify an Agent SaaS product website as a task application", () => {
    expect(
      isTaskAppGoal(
        "制作一个面向开发团队的 AI Agent SaaS 产品网站。首页展示创建 Agent、连接工具、执行任务和查看运行结果的完整流程。",
      ),
    ).toBe(false);
  });

  it("does not classify an English developer product site from an incidental task mention", () => {
    expect(
      isTaskAppGoal(
        "Build a developer product website that explains how agents execute tasks and exposes docs, API, monitoring, and pricing.",
      ),
    ).toBe(false);
  });

  it("does not classify an editorial website because it contains a list", () => {
    expect(
      isTaskAppGoal(
        "Build a city culture website with a list of exhibitions, stories, routes, and visitor information.",
      ),
    ).toBe(false);
  });

  it.each([
    "Build a task manager application with an input and an add-task control.",
    "Create a task list app where users can add, complete, and delete tasks.",
    "制作一个任务管理应用，可以添加任务、完成任务和删除任务。",
    "制作一个待办清单，用户可以输入任务并提交。",
  ])("keeps real task applications under the strict interaction contract: %s", (goal) => {
    expect(isTaskAppGoal(goal)).toBe(true);
  });

  it("does not enable the task contract for an empty or missing goal", () => {
    expect(isTaskAppGoal(undefined)).toBe(false);
    expect(isTaskAppGoal("")).toBe(false);
  });
});
