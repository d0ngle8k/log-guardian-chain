param()

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$backendPath = Join-Path $root 'backend'

$existing = Get-Process -Name 'log-guardian-backend' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Host "Backend already running (pid=$($existing.Id))." -ForegroundColor Green
    exit 0
}

$postgresScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'start-postgres-5433.ps1'
$postgresScript = [System.IO.Path]::GetFullPath($postgresScript)
if (Test-Path $postgresScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $postgresScript | Out-Null
}

Start-Process powershell -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command',
    "Set-Location '$backendPath'; cargo run"
)

Write-Host 'Backend launch requested.' -ForegroundColor Cyan
