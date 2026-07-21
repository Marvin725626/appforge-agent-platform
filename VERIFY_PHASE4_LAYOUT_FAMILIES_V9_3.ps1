$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/3] Running V9/V9.3 layout-family policy and renderer tests..."
npx vitest run `
  apps/api/src/layout-family-policy.test.ts `
  apps/api/src/layout-family-policy-v9-3.test.ts `
  apps/api/src/stable-page-layout-families.test.ts `
  --reporter=verbose `
  --no-file-parallelism `
  --no-color
if ($LASTEXITCODE -ne 0) { throw "V9.3 focused layout-family tests failed." }

Write-Host "[2/3] Running API build and repository typecheck..."
npm run build:api
if ($LASTEXITCODE -ne 0) { throw "API build failed." }

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Repository typecheck failed." }

Write-Host "[3/3] Running the complete V9 visual benchmark and regression suite..."
if (Test-Path .\VERIFY_PHASE4_LAYOUT_FAMILIES_V9.ps1) {
  powershell -ExecutionPolicy Bypass -File .\VERIFY_PHASE4_LAYOUT_FAMILIES_V9.ps1
  if ($LASTEXITCODE -ne 0) { throw "Complete V9 verification failed after V9.3." }
} elseif (Test-Path .\VERIFY_PHASE5_CROSS_TEMPLATE_SIMILARITY.ps1) {
  Write-Warning "VERIFY_PHASE4_LAYOUT_FAMILIES_V9.ps1 was not found. Running the Phase 5 cross-template benchmark directly."
  powershell -ExecutionPolicy Bypass -File .\VERIFY_PHASE5_CROSS_TEMPLATE_SIMILARITY.ps1
  if ($LASTEXITCODE -ne 0) { throw "Cross-template similarity benchmark failed after V9.3." }
} else {
  throw "Neither the V9 verification script nor the Phase 5 cross-template benchmark script was found."
}

Write-Host "V9.3 verification complete. Compare the new nearest-neighbour score with the V9.1 value of 89.3 and the original value of 94.8."
