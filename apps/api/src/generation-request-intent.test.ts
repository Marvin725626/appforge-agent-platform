import { describe, expect, it } from "vitest";

import {
    isExplicitRegenerationPrompt,
    isFreshPageGenerationRequest,
    isFullApplicationCreationRequest,
} from "./generation-request-intent.js";

describe("generation request intent", () => {
    it.each([
        "做一个瓦罗兰特专题页，要像游戏官网和战术 HUD",
        "生成一个服务器运行监控后台，包含 CPU、内存、请求延迟和告警列表",
        "帮我创建一个介绍温州的文化网页",
        "整体重做首页，换成高密度运维控制台",
    ])("recognizes readable Chinese full-page generation: %s", (request) => {
        expect(isFreshPageGenerationRequest(request)).toBe(true);
        expect(isFullApplicationCreationRequest(request)).toBe(true);
        expect(isExplicitRegenerationPrompt(request)).toBe(true);
    });

    it.each([
        "把按钮文字改成提交",
        "赛前负载面板这个框有问题，调整一下",
        "顶部导航字太多，缩短成一行",
    ])("does not treat readable Chinese focused edits as full regeneration: %s", (request) => {
        expect(isFullApplicationCreationRequest(request)).toBe(false);
        expect(isExplicitRegenerationPrompt(request)).toBe(false);
    });

    it.each([
        "创建一个服务器运行监控后台，包含 CPU、内存和告警列表",
        "创建一个高密度运营数据后台",
        "生成一个销售数据看板",
        "设计一个运维控制台",
        "Build an operations console for SRE teams",
        "Create a sales dashboard with regional metrics",
    ])("recognizes full application generation: %s", (request) => {
        expect(isFreshPageGenerationRequest(request)).toBe(true);
        expect(isFullApplicationCreationRequest(request)).toBe(true);
        expect(isExplicitRegenerationPrompt(request)).toBe(true);
    });

    it.each([
        "创建一个新的告警列表模块，并保留其他内容",
        "增加一个仪表盘卡片",
        "把当前后台顶部颜色改成蓝色",
        "Add a dashboard card to the current page",
    ])("does not replace the whole application for a local edit: %s", (request) => {
        expect(isFullApplicationCreationRequest(request)).toBe(false);
        expect(isExplicitRegenerationPrompt(request)).toBe(false);
    });

    it("keeps explicit regeneration commands supported", () => {
        expect(isExplicitRegenerationPrompt("从头生成一个新的版本")).toBe(true);
        expect(isExplicitRegenerationPrompt("start over")).toBe(true);
    });
});
