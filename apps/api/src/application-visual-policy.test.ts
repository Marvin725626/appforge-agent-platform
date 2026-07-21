import { describe, expect, it } from "vitest";

import {
    getStableMediaPolicy,
    shouldGenerateStableHeroImage,
} from "./application-visual-policy.js";

describe("application visual policy", () => {
    it("keeps operational dashboards data-first instead of generating a marketing hero image", () => {
        expect(shouldGenerateStableHeroImage("dashboard")).toBe(false);
        expect(getStableMediaPolicy("dashboard")).toMatchObject({
            aboveFoldMode: "operational-overview",
            preferredMedia: expect.arrayContaining([
                "health-summary",
                "metric-strip",
                "status-table",
            ]),
        });
    });

    it("still allows visual hero media for product and commerce pages", () => {
        expect(shouldGenerateStableHeroImage("product")).toBe(true);
        expect(shouldGenerateStableHeroImage("commerce")).toBe(true);
    });
});
