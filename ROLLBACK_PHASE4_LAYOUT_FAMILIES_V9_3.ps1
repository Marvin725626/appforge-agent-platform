$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$latestFile = Join-Path $PSScriptRoot ".appforge-v9-backup\v9.3-residual-cluster-split\latest.json"
if (-not (Test-Path $latestFile)) {
  throw "No V9.3 backup metadata was found at $latestFile"
}

$metadata = Get-Content $latestFile -Raw | ConvertFrom-Json
$backupRoot = $metadata.backupRoot
if (-not (Test-Path $backupRoot)) {
  throw "V9.3 backup directory is missing: $backupRoot"
}

$backupSource = Join-Path $backupRoot "apps\api\src"
$targetSource = Join-Path $PSScriptRoot "apps\api\src"

foreach ($name in @("layout-family-policy.ts", "stable-page-renderer.ts", "layout-family-policy-v9-3.test.ts")) {
  $source = Join-Path $backupSource $name
  $target = Join-Path $targetSource $name
  if (Test-Path $source) {
    Copy-Item $source $target -Force
  } elseif ($name -eq "layout-family-policy-v9-3.test.ts" -and (Test-Path $target)) {
    Remove-Item $target -Force
  }
}

Write-Host "V9.3 rollback complete from $backupRoot"
