import { configDefaults, defineConfig } from "vitest/config";

const appforgeGeneratedExcludes = [
    "**/.appforge-v9-backup/**",
    "**/V9_*_PAYLOAD/**",
    "**/.phase4-*-payload/**",
    "**/artifacts/**",
];

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, ...appforgeGeneratedExcludes],
    },
});
