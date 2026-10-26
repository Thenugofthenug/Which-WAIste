param(
    [ValidateSet('PostgreSQL', 'SQLite')][string]$Database = 'PostgreSQL',
    [ValidateRange(1024, 65535)][int]$Port = 8000,
    [switch]$CheckOnly,
    [switch]$SkipBuild,
    [string]$ExportTo,
    [switch]$IncludeNames
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$privateConfig = Join-Path $projectRoot '.data\local-server.json'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Prepare .venv and install requirements.txt first. See docs/LOCAL_CLASSROOM.md.'
}
if (-not (Test-Path -LiteralPath $privateConfig)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $privateConfig) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local-server.example.json') -Destination $privateConfig
    Write-Host 'Created private .data/local-server.json. Fill it after setting up local PostgreSQL.'
}

Push-Location $projectRoot
try {
    if (-not $SkipBuild -and -not $ExportTo) {
        if (-not (Test-Path -LiteralPath 'frontend\node_modules')) {
            throw 'Frontend packages are missing. Run npm.cmd run setup while online first.'
        }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; the server was not started.' }
    }
    $serverArgs = @('-B', '-m', 'backend.local_server', '--database', $Database.ToLower(), '--port', "$Port")
    if ($CheckOnly) { $serverArgs += '--check-only' }
    if ($ExportTo) { $serverArgs += @('--export', $ExportTo) }
    if ($IncludeNames) { $serverArgs += '--include-names' }
    & $pythonPath @serverArgs
    if ($LASTEXITCODE -ne 0) { throw 'Local setup is not ready. Follow the message above; the database was not switched automatically.' }
}
finally { Pop-Location }
