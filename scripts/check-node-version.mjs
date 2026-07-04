const requiredMajor = 22;
const currentMajor = Number(process.versions.node.split(".")[0]);

if (currentMajor < requiredMajor) {
  console.error(
    `AppForge requires Node.js ${requiredMajor} or newer, but the current version is ${process.version}.`,
  );
  console.error("Run: . .\\scripts\\use-local-tools.ps1");
  process.exit(1);
}
