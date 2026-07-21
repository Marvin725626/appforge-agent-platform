import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const target = path.join(
  root,
  "apps",
  "api",
  "src",
  "stable-react-generation.integration.test.ts",
);

const fail = (message) => {
  throw new Error(message);
};

let source;
try {
  source = await readFile(target, "utf8");
} catch (error) {
  fail(`Cannot read ${target}: ${error instanceof Error ? error.message : String(error)}`);
}

if (
  source.includes("VITE_REACT_STARTER_TEMPLATE_ROOT") &&
  source.includes('from "node:url"')
) {
  console.log("V9.2 regression fixture-path fix is already applied.");
  process.exit(0);
}

if (!source.includes('import path from "node:path";')) {
  fail("Expected node:path import was not found; refusing to patch an unknown baseline.");
}

if (!source.includes('from "node:url"')) {
  source = source.replace(
    'import path from "node:path";',
    'import path from "node:path";\nimport { fileURLToPath } from "node:url";',
  );
}

const anchor = 'import { runReactAppAgent } from "./run-react-app-agent.js";';
if (!source.includes(anchor)) {
  fail("Expected runReactAppAgent import was not found; refusing to patch an unknown baseline.");
}

const constants = `${anchor}\n\nconst REPOSITORY_ROOT = path.resolve(\n  path.dirname(fileURLToPath(import.meta.url)),\n  "../../..",\n);\nconst VITE_REACT_STARTER_TEMPLATE_ROOT = path.join(\n  REPOSITORY_ROOT,\n  "tests",\n  "fixtures",\n  "vite-react-starter",\n);`;
source = source.replace(anchor, constants);

const brittlePattern = /const templateRoot = path\.resolve\(\s*process\.cwd\(\),\s*["']\.\.\/\.\.\/tests\/fixtures\/vite-react-starter["'],?\s*\);/g;
const matches = source.match(brittlePattern) ?? [];
if (matches.length !== 2) {
  fail(
    `Expected exactly 2 brittle templateRoot definitions, found ${matches.length}. ` +
      "The repository is not the expected Phase 5/V9 baseline.",
  );
}
source = source.replace(
  brittlePattern,
  "const templateRoot = VITE_REACT_STARTER_TEMPLATE_ROOT;",
);

const backupDir = path.join(root, ".appforge-v9-backup", "v9.2-regression-path-fix");
await mkdir(backupDir, { recursive: true });
await copyFile(target, path.join(backupDir, path.basename(target)));
await writeFile(target, source, "utf8");

console.log("Applied V9.2 cwd-independent integration-test fixture path fix.");
console.log(`Backup: ${backupDir}`);
