import { describe, expect, it } from "vitest";

import {
    classifyNavigationRequest,
    shouldUseParallelCodingAgents,
} from "./run-react-app-agent.js";

describe("parallel coding selection", () => {
    it("uses parallel agents for a real UTF-8 routed Wenzhou introduction request", () => {
        const request = "我想要一个介绍温州的界面并且可以跳转";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("routes");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("uses parallel agents for the routed Wenzhou introduction request", () => {
        const request = "我想要一个介绍温州的界面并且可以跳转";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("routes");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("recognizes a longer Chinese URL-navigation sentence as routed", () => {
        const request =
            "创建完整精美的温州介绍界面，包含首页、文化和行程页面，并且可以通过真实 URL 跳转";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("routes");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("uses one page-scoped Coding API for an ordinary Wenzhou page", () => {
        const request = "做一个介绍温州的界面";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("none");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("keeps a complex single webpage as one page-scoped Coding API", () => {
        const request = "做一个复杂的多板块温州门户界面";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("none");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("uses the page-scoped path for a simple fresh webpage without adding parallel work", () => {
        const request = "做一个简单的温州介绍页面";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("none");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("keeps same-document section navigation on one coding agent", () => {
        const request = "点击导航跳到页面内对应板块";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("in-page");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(false);
    });

    it("uses parallel agents for a simple SPA with three URL pages", () => {
        const request =
            "Build a simple SPA with three URL paths and three pages: home, places, and food.";
        const navigationKind = classifyNavigationRequest(request);

        expect(navigationKind).toBe("routes");
        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: true,
            }),
        ).toBe(true);
    });

    it("keeps continuation runs on one coding agent", () => {
        const request = "做一个复杂的多页面温州门户";
        const navigationKind = classifyNavigationRequest(request);

        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: false,
                enabled: true,
            }),
        ).toBe(false);
    });

    it("keeps all requests on one coding agent when parallel coding is disabled", () => {
        const request = "做一个复杂的多页面温州门户";
        const navigationKind = classifyNavigationRequest(request);

        expect(
            shouldUseParallelCodingAgents({
                request,
                navigationKind,
                resetWorkspace: true,
                enabled: false,
            }),
        ).toBe(false);
    });
});
