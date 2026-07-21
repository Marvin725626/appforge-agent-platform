import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DESIGN_BENCHMARK_PROMPTS } from "./design-benchmark-prompts.js";
import { deriveStableLayoutFamily } from "./layout-family-policy.js";
import {
  StablePageContentSchema,
  type StablePageContent,
  type StableTemplateVariant,
} from "./stable-page-content.js";

const policySourceUrl = new URL("./layout-family-policy.ts", import.meta.url);

const promptById = new Map(
  DESIGN_BENCHMARK_PROMPTS.map((prompt) => [prompt.id, prompt.prompt]),
);

function benchmarkPrompt(id: string): string {
  const prompt = promptById.get(id);
  if (!prompt) throw new Error(`Missing benchmark prompt: ${id}`);
  return prompt;
}

function createContaminatedContent(
  applicationType: StablePageContent["applicationType"],
  templateVariant: StableTemplateVariant,
  prompt: string,
): StablePageContent {
  return StablePageContentSchema.parse({
    version: 1,
    applicationType,
    templateVariant,
    theme: {
      palette: applicationType === "institution"
        ? "forest-lime"
        : applicationType === "portfolio"
          ? "crimson-night"
          : "ocean-cyan",
      fontPair: applicationType === "portfolio" ? "geometric-sans" : "system-modern",
      density: "compact",
    },
    brand: {
      name: applicationType === "institution"
        ? "PUBLIC KNOWLEDGE"
        : applicationType === "portfolio"
          ? "SELECTED WORK"
          : "SIGNAL OPERATIONS",
      kicker: "PUBLIC IMAGE STATUS",
      title: "稳定页面默认标题",
      summary: prompt,
      primaryAction: "查看内容",
      secondaryAction: "了解详情",
      statusLabel: "PUBLIC ACCESS",
    },
    hero: {
      imagePrompt: "Create a polished public hero image with gallery, alert and status signals.",
      imageAlt: "公共主题视觉图像",
      stats: [
        { label: "全局健康", value: "稳定" },
        { label: "在线节点", value: "284 / 300" },
        { label: "活动告警", value: "18" },
        { label: "刷新频率", value: "10s" },
      ],
    },
    sections: [
      {
        id: "metrics",
        kind: "metrics",
        eyebrow: "SECTION 01",
        title: "关键指标",
        description: "通用指标、健康状态与告警摘要。",
        items: [
          {
            title: "CPU 使用率",
            meta: "阈值 75%",
            description: "通用处理器指标。",
            value: "68%",
            status: "正常",
          },
          {
            title: "活动告警",
            meta: "实时",
            description: "通用告警与状态。",
            value: "18",
            status: "关注",
          },
        ],
      },
      {
        id: "table",
        kind: "data-table",
        eyebrow: "SECTION 02",
        title: "运行明细",
        description: "实例、队列、流程与记录。",
        items: [
          {
            title: "实例记录",
            meta: "PUBLIC",
            description: "通用 public service 表格记录。",
            value: "READY",
            status: "ACTIVE",
          },
          {
            title: "流程记录",
            meta: "IMAGE",
            description: "通用 gallery visual image 流程。",
            value: "VERIFIED",
            status: "NORMAL",
          },
        ],
      },
      {
        id: "timeline",
        kind: "timeline",
        eyebrow: "SECTION 03",
        title: "活动时间线",
        description: "公共项目、经历与行动节点。",
        items: [
          {
            title: "项目节点",
            meta: "01",
            description: "通用项目与计划。",
            value: "Q1",
            status: "DONE",
          },
          {
            title: "行动节点",
            meta: "02",
            description: "通用行动与服务。",
            value: "Q2",
            status: "NEXT",
          },
        ],
      },
      {
        id: "features",
        kind: "feature-list",
        eyebrow: "SECTION 04",
        title: "核心能力",
        description: "公共服务、视觉作品和系统能力。",
        items: [
          {
            title: "PUBLIC SERVICE",
            meta: "VISUAL",
            description: "Generic public gallery image capability.",
            value: "ON",
            status: "READY",
          },
          {
            title: "ALERT STATUS",
            meta: "SYSTEM",
            description: "Generic alert, system and workflow capability.",
            value: "ON",
            status: "READY",
          },
        ],
      },
    ],
    footer: {
      statement: `当前目标 · ${prompt}`,
      links: ["概览", "核心内容", "联系"],
    },
  });
}

const ROUTE_CASES = [
  [
    "dashboard-operations",
    "dashboard",
    "sidebar-console",
    "operations-console",
    "data-region",
  ],
  [
    "dashboard-infrastructure",
    "dashboard",
    "sidebar-console",
    "infrastructure-topology",
    "map-list-hybrid",
  ],
  [
    "dashboard-clinical",
    "dashboard",
    "report-board",
    "incident-command",
    "workflow-lane",
  ],
  [
    "institution-laboratory",
    "institution",
    "research-report",
    "research-institute",
    "split-narrative",
  ],
  [
    "institution-public-health",
    "institution",
    "institution-portal",
    "public-service-portal",
    "workflow-lane",
  ],
  [
    "institution-foundation",
    "institution",
    "institution-portal",
    "foundation-program",
    "timeline-lane",
  ],
  [
    "portfolio-product-designer",
    "portfolio",
    "case-study",
    "case-study-rail",
    "editorial-rail",
  ],
  [
    "portfolio-photographer",
    "portfolio",
    "case-study",
    "gallery-portfolio",
    "gallery-wall",
  ],
  [
    "portfolio-engineer",
    "portfolio",
    "resume-story",
    "resume-story",
    "timeline-lane",
  ],
] as const;

describe("V9.4.2 weighted user-goal layout routing", () => {
  it("contains the weighted-intent routing contract", async () => {
    const source = await readFile(policySourceUrl, "utf8");
    expect(source).toContain("APPFORGE_PHASE4_WEIGHTED_INTENT_ROUTING_V9_4_2");
    expect(source).toContain("function goalEvidence(");
    expect(source).toContain("resolveWeightedIntentCandidate");
    expect(source).toContain('selection=${selection}');
  });

  it.each(ROUTE_CASES)(
    "routes %s to %s / %s despite generic generated boilerplate",
    (id, applicationType, templateVariant, expectedFamily, expectedPrimitive) => {
      const content = createContaminatedContent(
        applicationType,
        templateVariant,
        benchmarkPrompt(id),
      );
      const result = deriveStableLayoutFamily(content);

      expect(result.family).toBe(expectedFamily);
      expect(result.primaryPrimitive).toBe(expectedPrimitive);
      expect(result.evidence).toContain("selection=weighted-goal-intent");
    },
  );
});
