$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$branch = (git branch --show-current).Trim()
if (-not $branch) {
  throw "Unable to determine the current Git branch."
}

Write-Host "Current branch: $branch"
if ($branch -ne "feat/designplan-layout-families-v9") {
  Write-Warning "V9.3 was designed for feat/designplan-layout-families-v9. Continuing on $branch because the patch verifies the V9 source markers before writing."
}

node .\PATCH_PHASE4_LAYOUT_FAMILIES_V9_3.mjs
if ($LASTEXITCODE -ne 0) { throw "V9.3 patch failed." }

Write-Host "V9.3 patch applied. Run VERIFY_PHASE4_LAYOUT_FAMILIES_V9_3.ps1 next."
