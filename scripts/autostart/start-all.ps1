param()

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptDir 'start-postgres-5433.ps1')
& (Join-Path $scriptDir 'start-backend.ps1')
& (Join-Path $scriptDir 'start-collector.ps1') -FlushSeconds 30
& (Join-Path $scriptDir 'start-sender.ps1') -IntervalSeconds 30

Write-Host 'Autostart sequence finished.' -ForegroundColor Green
