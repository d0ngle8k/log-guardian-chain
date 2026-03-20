param(
    [int]$IntervalSeconds = 30
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$senderScript = Join-Path $root 'test-syslog-sender.ps1'

$existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*test-syslog-sender.ps1*'
} | Select-Object -First 1

if ($existing) {
    Write-Host "Sender already running (pid=$($existing.ProcessId))." -ForegroundColor Green
    exit 0
}

if (!(Test-Path $senderScript)) {
    Write-Host 'Sender script not found.' -ForegroundColor Red
    exit 1
}

Start-Process powershell -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command',
    "Set-Location '$root'; .\\test-syslog-sender.ps1 -BindAddr '127.0.0.1' -BindPort 5514 -IntervalSeconds $IntervalSeconds"
)

Write-Host 'Sender launch requested.' -ForegroundColor Cyan
