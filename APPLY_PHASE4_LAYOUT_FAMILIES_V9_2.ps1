$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repoRoot = (Get-Location).Path
$target = Join-Path $repoRoot "apps\api\src\stable-react-generation.integration.test.ts"
if (-not (Test-Path $target)) {
  throw "Run this script from the AppForge repository root. Missing: $target"
}

node .\PATCH_PHASE4_LAYOUT_FAMILIES_V9_2.mjs
if ($LASTEXITCODE -ne 0) {
  throw "V9.2 regression fixture-path patch failed."
}

Write-Host ""
Write-Host "V9.2 patch applied. Run VERIFY_PHASE4_LAYOUT_FAMILIES_V9_2.ps1 next."
