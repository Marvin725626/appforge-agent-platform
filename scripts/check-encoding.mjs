import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const SKIPPED_DIRECTORIES = new Set([
    ".git",
    ".npm-cache",
    "coverage",
    "dist",
    "node_modules",
]);

const CHECKED_EXTENSIONS = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".ts",
    ".tsx",
]);

const mojibakeTokens = [
    "\u93b4",
    "\u5a13",
    "\u68e3",
    "\u93c2",
    "\u741b",
    "\u9423",
    "\u6d93",
    "\u923c",
    "\u9225",
    "\ufffd",
    "\u00c3",
    "\u00c2",
];

const MOJIBAKE_PATTERN = new RegExp(
    `(?:${mojibakeTokens.map(escapeRegExp).join("|")})`,
    "u",
);

const ALLOWED_GARBLED_LINES = new Map([
    [
        "packages/harness/src/index.test.ts",
        new Set([
            "<h1>\u5a13\u2541\u7a9e\u6d60\u5b2c\u7c9b</h1>",
            "<p>\u93b4\u621e\u5142\u7455\u4f77\u7af4\u6d93\ue043\u7c99\u7f01\u5d86\u4fef\u5bb8\u70b5\u6b91\u9423\u5c84\u6f70</p>",
        ]),
    ],
]);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function* walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                yield* walk(path.join(directory, entry.name));
            }
            continue;
        }

        if (entry.isFile() && CHECKED_EXTENSIONS.has(path.extname(entry.name))) {
            yield path.join(directory, entry.name);
        }
    }
}

function toPosixRelative(filePath) {
    return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function isAllowed(relativePath, line) {
    const allowedLines = ALLOWED_GARBLED_LINES.get(relativePath);
    return allowedLines?.has(line.trim()) ?? false;
}

const failures = [];

for await (const filePath of walk(ROOT)) {
    const relativePath = toPosixRelative(filePath);
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/u);

    lines.forEach((line, index) => {
        if (MOJIBAKE_PATTERN.test(line) && !isAllowed(relativePath, line)) {
            failures.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
    });
}

if (failures.length > 0) {
    console.error("Potential mojibake/encoding regressions found:");
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log("Encoding check passed.");
