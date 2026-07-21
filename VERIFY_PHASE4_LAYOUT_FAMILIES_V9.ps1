$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/6] Build shared packages and visual harness"
npm run build:shared
if ($LASTEXITCODE -ne 0) { throw "Shared package build failed." }
npm run build:harness
if ($LASTEXITCODE -ne 0) { throw "Visual harness build failed." }

Write-Host "[2/6] V9 layout policy tests"
npx vitest run apps/api/src/layout-family-policy.test.ts apps/api/src/stable-page-layout-families.test.ts
if ($LASTEXITCODE -ne 0) { throw "V9 layout policy tests failed." }

Write-Host "[3/6] Stable renderer/generator regression tests"
npx vitest run apps/api/src/stable-react-page-generator.test.ts apps/api/src/stable-react-generation.integration.test.ts apps/api/src/source-style-contract.test.ts
if ($LASTEXITCODE -ne 0) { throw "Stable generation regression tests failed." }

Write-Host "[4/6] API build"
npm run build:api
if ($LASTEXITCODE -ne 0) { throw "API build failed." }

Write-Host "[5/6] Full typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }

Write-Host "[6/6] Phase 5 benchmark rerun"
powershell -ExecutionPolicy Bypass -File .\VERIFY_PHASE5_CROSS_TEMPLATE_SIMILARITY.ps1
if ($LASTEXITCODE -ne 0) { throw "Phase 5 similarity benchmark failed." }

Write-Host "V9.1 verification complete. Compare average nearest-neighbour repetition with the 94.8 baseline."
