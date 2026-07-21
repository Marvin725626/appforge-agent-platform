import type { ApplicationType } from "@appforge/protocol";

export type StableMediaPolicy = {
    heroImage: boolean;
    aboveFoldMode: "marketing-hero" | "operational-overview" | "editorial-cover";
    preferredMedia: readonly string[];
};

const DEFAULT_POLICY: StableMediaPolicy = {
    heroImage: true,
    aboveFoldMode: "marketing-hero",
    preferredMedia: ["hero-image", "content-sections"],
};

const POLICIES: Partial<Record<ApplicationType, StableMediaPolicy>> = {
    dashboard: {
        heroImage: false,
        aboveFoldMode: "operational-overview",
        preferredMedia: [
            "health-summary",
            "metric-strip",
            "sparkline",
            "status-table",
            "workflow",
        ],
    },
    editorial: {
        heroImage: true,
        aboveFoldMode: "editorial-cover",
        preferredMedia: ["cover-image", "story", "quotes", "data"],
    },
};

export function getStableMediaPolicy(
    applicationType: ApplicationType,
): StableMediaPolicy {
    return POLICIES[applicationType] ?? DEFAULT_POLICY;
}

export function shouldGenerateStableHeroImage(
    applicationType: ApplicationType,
): boolean {
    return getStableMediaPolicy(applicationType).heroImage;
}
