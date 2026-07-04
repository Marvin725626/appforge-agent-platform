$toolsRoot = "E:\agent\tools"
$nodeRoot = Join-Path $toolsRoot "node-v22.22.3-win-x64"
$gitRoot = Join-Path $toolsRoot "mingit-2.54.0"
$npmCache = Join-Path $PSScriptRoot "..\.npm-cache"

$requiredPaths = @(
    (Join-Path $nodeRoot "node.exe"),
    (Join-Path $gitRoot "cmd\git.exe")
)

foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required local tool is missing: $path"
    }
}

$env:Path = "$nodeRoot;$gitRoot\cmd;$env:Path"
$env:npm_config_cache = [System.IO.Path]::GetFullPath($npmCache)

Write-Host "Using Node $(node --version)"
Write-Host "Using npm $(npm --version)"
Write-Host "Using $(git --version)"
