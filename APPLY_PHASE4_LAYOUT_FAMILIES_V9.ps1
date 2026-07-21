$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\apps\api\src\stable-page-renderer.ts")) {
  throw "Run this package from the AppForge repository root. Expected apps/api/src/stable-page-renderer.ts."
}

$branch = (git branch --show-current).Trim()
if ($branch -eq "main") {
  git show-ref --verify --quiet refs/heads/feat/designplan-layout-families-v9
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Switching to existing V9 feature branch..."
    git switch feat/designplan-layout-families-v9
  } else {
    Write-Host "Creating V9 feature branch from main..."
    git switch -c feat/designplan-layout-families-v9
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not switch to feat/designplan-layout-families-v9." }
}

$payload = ".\.phase4-v9-payload"
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item -ItemType Directory -Force "$payload\apps\api\src" | Out-Null
Copy-Item ".\apps\api\src\layout-family-policy.ts" "$payload\apps\api\src\layout-family-policy.ts" -Force
Copy-Item ".\apps\api\src\layout-family-policy.test.ts" "$payload\apps\api\src\layout-family-policy.test.ts" -Force
node .\PATCH_PHASE4_LAYOUT_FAMILIES_V9.mjs
if ($LASTEXITCODE -ne 0) { throw "V9 patch failed." }
Remove-Item $payload -Recurse -Force
Write-Host "V9 patch applied. Run VERIFY_PHASE4_LAYOUT_FAMILIES_V9.ps1 next."
