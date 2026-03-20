param(
    [switch]$StartSender,
    [int]$SenderIntervalSeconds = 60
)

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPath = Join-Path $root 'frontend'
$backendPath = Join-Path $root 'backend'
$collectorDir = Join-Path $root 'agent-syslog-collector'

Write-Host 'Stopping old processes...' -ForegroundColor Yellow
Get-Process -Name 'node' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name 'log-guardian-backend' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name 'agent-syslog-collector' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name 'agent_syslog_collector' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Write-Host 'Starting backend...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$backendPath'; cargo run"
)

Write-Host 'Starting frontend on :5174...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$frontendPath'; npm run dev -- --host 127.0.0.1 --port 5174"
)

# Wait for backend readiness so collector does not start forwarding into a dead endpoint.
$backendReady = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:9000/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $backendReady = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 1000
    }
}

if ($backendReady) {
    Write-Host 'Backend healthcheck OK on :9000.' -ForegroundColor Green
} else {
    Write-Host 'Backend healthcheck timed out. Collector will still start, but forwarding may fail until backend is up.' -ForegroundColor Yellow
}

$collectorExe = Get-ChildItem -Path $collectorDir -Recurse -Include 'agent-syslog-collector*.exe','agent_syslog_collector*.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($collectorExe) {
    Write-Host "Starting collector: $($collectorExe.FullName)" -ForegroundColor Cyan

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
        '$env:BATCH_FLUSH_MS=''60000''',
        '$env:BATCH_MAX_RECORDS=''200'''
    )

    if ($ingestApiKey) {
        $envSetup += ('$env:INGEST_API_KEY=''' + $ingestApiKey + '''')
    }

    $collectorCmd = ($envSetup -join '; ') + "; & '$($collectorExe.FullName)'"

    Start-Process powershell -ArgumentList @(
        '-NoExit',
        '-Command',
        $collectorCmd
    )
} else {
    Write-Host 'Collector executable not found. Production collector binary is missing.' -ForegroundColor Red
}

if ($StartSender) {
    Write-Host "Starting test sender with $SenderIntervalSeconds-second interval..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        '-NoExit',
        '-Command',
        "Set-Location '$root'; .\test-syslog-sender.ps1 -BindAddr '127.0.0.1' -BindPort 5514 -IntervalSeconds $SenderIntervalSeconds"
    )
}

Write-Host 'Done. Guardian Log services launched in new PowerShell windows.' -ForegroundColor Green
