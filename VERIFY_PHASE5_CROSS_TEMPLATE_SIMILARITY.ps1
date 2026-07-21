$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "[1/4] Running focused Phase 5 similarity tests..."
npm run test --workspace @appforge/api -- src/anti-template-evaluator.test.ts src/benchmark-screenshot-renderer.test.ts src/cross-template-similarity.test.ts src/design-quality-benchmark.test.ts

Write-Host "[2/4] Building API..."
npm run build:api

Write-Host "[3/4] Running repository typecheck..."
npm run typecheck

Write-Host "[4/4] Running the 24-case screenshot similarity benchmark..."
npm run benchmark:design

$artifactDirectory = Join-Path $projectRoot "artifacts\design-benchmark"
$expectedReports = @(
    "design-quality-report.json",
    "design-quality-report.md",
    "anti-template-report.json",
    "anti-template-report.md",
    "visual-similarity-report.json",
    "visual-similarity-report.md",
    "similarity-matrix.csv",
    "template-clusters.json"
)

$missing = @()
foreach ($report in $expectedReports) {
    $reportPath = Join-Path $artifactDirectory $report
    if (-not (Test-Path $reportPath)) {
        $missing += $reportPath
    }
}

if ($missing.Count -gt 0) {
    throw "Benchmark completed but report files are missing: $($missing -join ', ')"
}

$similarityPath = Join-Path $artifactDirectory "visual-similarity-report.json"
$similarity = Get-Content $similarityPath -Raw -Encoding UTF8 | ConvertFrom-Json
$totalCases = [int]$similarity.summary.totalCases
$capturedCases = @($similarity.screenshotCapture.capturedCases).Count
$failedCases = @($similarity.screenshotCapture.failedCases)

if (-not [bool]$similarity.screenshotCapture.available) {
    $firstError = if ($failedCases.Count -gt 0) {
        [string]$failedCases[0].error
    } else {
        "No browser error was recorded."
    }
    throw "Screenshot capture was unavailable. AppForge Phase 5.2b already requires Playwright Chromium; verify that the same Windows user is running this script. First error: $firstError"
}

if ($capturedCases -ne $totalCases) {
    throw "Expected screenshots for all $totalCases benchmark cases, but only $capturedCases were captured."
}

$screenshotDirectory = Join-Path $artifactDirectory "screenshots"
$screenshotCount = @(
    Get-ChildItem $screenshotDirectory -File -Filter "*.png" -ErrorAction SilentlyContinue
).Count
if ($screenshotCount -lt $totalCases) {
    throw "Expected at least $totalCases PNG screenshots, but found $screenshotCount in $screenshotDirectory."
}

Write-Host ""
Write-Host "Phase 5 cross-template similarity benchmark is ready."
Write-Host "Reports: $artifactDirectory"
Write-Host "Screenshots: $capturedCases/$totalCases"
Write-Host "Pairs: $($similarity.summary.totalPairs)"
Write-Host "Average nearest-neighbour repetition: $($similarity.summary.averageNearestNeighborScore)/100"
Write-Host "Severe cross-type pairs: $($similarity.summary.severeCrossTypePairs)"
Write-Host "Soft gate: $(if ($similarity.summary.softGatePassed) { 'PASS' } else { 'WARN' })"
Write-Host ""
Get-ChildItem $artifactDirectory -File |
    Where-Object { $_.Name -in $expectedReports } |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize
