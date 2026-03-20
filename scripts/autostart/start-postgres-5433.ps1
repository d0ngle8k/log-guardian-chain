param()

$ErrorActionPreference = 'Continue'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$dataDir = 'C:\Users\d0ngle8k\pgdata5433'
$logFile = 'C:\Users\d0ngle8k\pgdata5433\server.log'

if (!(Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
    Write-Host 'pg_ctl.exe not found; skipping postgres 5433 startup.' -ForegroundColor Yellow
    exit 0
}

if (!(Test-Path $dataDir)) {
    Write-Host 'pgdata5433 missing; creating local 5433 cluster...' -ForegroundColor Yellow
    & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U postgres -A trust | Out-Null
}

$configPath = Join-Path $dataDir 'postgresql.conf'
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw
    $config = $config -replace "(?m)^#?\s*port\s*=\s*\d+", "port = 5433"
    $config = $config -replace "(?m)^#?\s*listen_addresses\s*=\s*.*", "listen_addresses = '127.0.0.1'"
    Set-Content -Path $configPath -Value $config -Encoding ascii
}

$ready = (Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -WarningAction SilentlyContinue).TcpTestSucceeded
if ($ready) {
    Write-Host 'PostgreSQL 5433 already running.' -ForegroundColor Green
    exit 0
}

& (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -l $logFile start | Out-Null
Start-Sleep -Seconds 2

$ready = (Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -WarningAction SilentlyContinue).TcpTestSucceeded
if ($ready) {
    Write-Host 'PostgreSQL 5433 started.' -ForegroundColor Green
    exit 0
}

Write-Host 'Failed to start PostgreSQL 5433.' -ForegroundColor Red
exit 1
