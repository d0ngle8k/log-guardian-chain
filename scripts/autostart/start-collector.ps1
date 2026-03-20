param(
    [int]$FlushSeconds = 30
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$backendPath = Join-Path $root 'backend'
$collectorDir = Join-Path $root 'agent-syslog-collector'

$existing = Get-Process -Name 'agent-syslog-collector','agent_syslog_collector' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Host "Collector already running (pid=$($existing.Id))." -ForegroundColor Green
    exit 0
}

$collectorExe = Get-ChildItem -Path $collectorDir -Recurse -Include 'agent-syslog-collector*.exe','agent_syslog_collector*.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $collectorExe) {
    Write-Host 'Collector executable not found.' -ForegroundColor Red
    exit 1
}

$backendReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:9000/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $backendReady = $true; break }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $backendReady) {
    Write-Host 'Backend not ready; collector will still start.' -ForegroundColor Yellow
}

$backendEnvFile = Join-Path $backendPath '.env'
$ingestApiKey = ''
if (Test-Path $backendEnvFile) {
    $line = Get-Content $backendEnvFile | Where-Object { $_ -match '^INGEST_API_KEY=' } | Select-Object -First 1
    if ($line) {
        $ingestApiKey = ($line -replace '^INGEST_API_KEY=', '').Trim()
    }
}

$envSetup = @(
    '$env:SYSLOG_BIND_ADDR=''127.0.0.1:5514''',
    '$env:BACKEND_INGEST_URL=''http://127.0.0.1:9000/api/v1/logs/ingest/fluentd''',
    '$env:AGENT_ID=''guardian-syslog-agent''',
    '$env:CACHE_KEY_HEX=''00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff''',
    ('$env:BATCH_FLUSH_MS=''' + ($FlushSeconds * 1000) + ''''),
    '$env:BATCH_MAX_RECORDS=''200'''
)

if ($ingestApiKey) {
    $envSetup += ('$env:INGEST_API_KEY=''' + $ingestApiKey + '''')
}

$collectorCmd = ($envSetup -join '; ') + "; & '$($collectorExe.FullName)'"

Start-Process powershell -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command',
    $collectorCmd
)

Write-Host 'Collector launch requested.' -ForegroundColor Cyan
