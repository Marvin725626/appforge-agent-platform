$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$log = Join-Path (Get-Location).Path "v9.2-stable-regression.log"

Write-Host "Running stable generation regression tests from repository root..."
& npx vitest run `
  apps/api/src/stable-react-page-generator.test.ts `
  apps/api/src/stable-react-generation.integration.test.ts `
  apps/api/src/source-style-contract.test.ts `
  --reporter=verbose `
  --no-file-parallelism `
  --no-color 2>&1 | Tee-Object $log

if ($LASTEXITCODE -ne 0) {
  throw "Stable generation regression tests failed. Full log: $log"
}

Write-Host ""
Write-Host "V9.2 focused regression verification passed."
Write-Host "Now rerun: .\VERIFY_PHASE4_LAYOUT_FAMILIES_V9.ps1"
