param(
	[int]$FlushSeconds = 10,
	[int]$SyntheticLogIntervalSeconds = 10,
	[switch]$DisableSyntheticLogs
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent (Split-Path -Parent $scriptDir)
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$collectorDir = Join-Path $root 'agent-syslog-collector'
$logsDir = Join-Path $root 'runtime-logs'

if (-not (Test-Path $logsDir)) {
	New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

function Stop-PortOwner {
	param([int]$Port)
	$conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($conn) {
		Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
		Start-Sleep -Milliseconds 600
	}
}

function Wait-Http200 {
	param(
		[string]$Url,
		[int]$Retries = 40,
		[int]$SleepMs = 500
	)

	for ($i = 0; $i -lt $Retries; $i++) {
		try {
			$r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
			if ($r.StatusCode -eq 200) { return $true }
		} catch {
			Start-Sleep -Milliseconds $SleepMs
		}
	}
	return $false
}

function Read-EnvValue {
	param(
		[string]$File,
		[string]$Key
	)

	if (-not (Test-Path $File)) { return '' }
	$line = Get-Content $File | Where-Object { $_ -match ('^' + [regex]::Escape($Key) + '=') } | Select-Object -First 1
	if (-not $line) { return '' }
	return ($line -replace ('^' + [regex]::Escape($Key) + '='), '').Trim()
}

function Send-SyslogMessage {
	param(
		[string]$TargetHost = '127.0.0.1',
		[int]$Port = 5514,
		[string]$Body
	)

	$client = New-Object System.Net.Sockets.UdpClient
	try {
		$timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.000Z')
		$payload = "<34>1 $timestamp guardian-host guardian-autosender 1001 - $Body"
		$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
		$client.Send($bytes, $bytes.Length, $TargetHost, $Port) | Out-Null
	} finally {
		$client.Close()
	}
}

Write-Host 'Launching Log Guardian fullstack in one shell...' -ForegroundColor Cyan

$enableSyntheticLogs = -not $DisableSyntheticLogs

# Ensure old listeners are cleared first.
Stop-PortOwner -Port 5174
Stop-PortOwner -Port 9000
$existingCollector = Get-Process -Name 'agent-syslog-collector','agent_syslog_collector' -ErrorAction SilentlyContinue
if ($existingCollector) {
	$existingCollector | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}

# Start backend first.
$backendExe = Join-Path $backendDir 'target\release\log-guardian-backend.exe'
if (-not (Test-Path $backendExe)) {
	throw "Backend executable not found at $backendExe. Build it first: cd backend; cargo build --release"
}

$backendOut = Join-Path $logsDir 'backend.out.log'
$backendErr = Join-Path $logsDir 'backend.err.log'
$backendProc = Start-Process -FilePath $backendExe -WorkingDirectory $backendDir -PassThru -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr

if (-not (Wait-Http200 -Url 'http://127.0.0.1:9000/health')) {
	throw 'Backend failed health check on http://127.0.0.1:9000/health'
}
Write-Host "Backend running (PID=$($backendProc.Id))" -ForegroundColor Green

# Start frontend second.
$frontendOut = Join-Path $logsDir 'frontend.out.log'
$frontendErr = Join-Path $logsDir 'frontend.err.log'
$frontendProc = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174') -WorkingDirectory $frontendDir -PassThru -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr

if (-not (Wait-Http200 -Url 'http://127.0.0.1:5174')) {
	throw 'Frontend failed to become reachable on http://127.0.0.1:5174'
}
Write-Host "Frontend running (PID=$($frontendProc.Id))" -ForegroundColor Green

# Start collector third.
$collectorExe = Get-ChildItem -Path $collectorDir -Recurse -Include 'agent-syslog-collector*.exe','agent_syslog_collector*.exe' -File -ErrorAction SilentlyContinue |
	Sort-Object LastWriteTime -Descending |
	Select-Object -First 1

if (-not $collectorExe) {
	throw "Collector executable not found in $collectorDir"
}

$envFile = Join-Path $backendDir '.env'
$ingestApiKey = Read-EnvValue -File $envFile -Key 'INGEST_API_KEY'
$cachePath = Join-Path $env:APPDATA 'log-guardian\collector-cache.log'
$cacheDir = Split-Path -Parent $cachePath
if (-not (Test-Path $cacheDir)) {
	New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}

$env:SYSLOG_BIND_ADDR = '127.0.0.1:5514'
$env:BACKEND_INGEST_URL = 'http://127.0.0.1:9000/api/v1/logs/ingest/fluentd'
$env:AGENT_ID = 'guardian-syslog-agent'
$env:CACHE_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
$env:BATCH_FLUSH_MS = [string]($FlushSeconds * 1000)
$env:BATCH_MAX_RECORDS = '200'
$env:CACHE_PATH = $cachePath
$env:CACHE_REPLAY_MAX = '100'
if ($ingestApiKey) { $env:INGEST_API_KEY = $ingestApiKey }

$collectorOut = Join-Path $logsDir 'collector.out.log'
$collectorErr = Join-Path $logsDir 'collector.err.log'
$collectorProc = Start-Process -FilePath $collectorExe.FullName -WorkingDirectory $collectorDir -PassThru -RedirectStandardOutput $collectorOut -RedirectStandardError $collectorErr

Start-Sleep -Seconds 2
$udpOk = Get-NetUDPEndpoint -LocalPort 5514 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $udpOk) {
	throw 'Collector did not bind UDP 127.0.0.1:5514'
}
Write-Host "Collector running (PID=$($collectorProc.Id))" -ForegroundColor Green

Write-Host ''
Write-Host 'Fullstack is up in one shell.' -ForegroundColor Cyan
Write-Host 'Flow: Syslog -> Collector -> Backend -> IPFS -> Solana Devnet' -ForegroundColor Cyan
Write-Host "Flush interval: $FlushSeconds seconds" -ForegroundColor Cyan
if ($enableSyntheticLogs) {
	Write-Host "Synthetic syslog sender: enabled ($SyntheticLogIntervalSeconds s interval)" -ForegroundColor Cyan
} else {
	Write-Host 'Synthetic syslog sender: disabled' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host "Frontend: http://127.0.0.1:5174" -ForegroundColor Gray
Write-Host "Backend : http://127.0.0.1:9000/health" -ForegroundColor Gray
Write-Host "Logs    : $logsDir" -ForegroundColor Gray
Write-Host ''

# Keep this shell alive and clean up child processes on Ctrl+C.
try {
	$nextSyntheticAt = Get-Date
	$syntheticCount = 0
	while ($true) {
		if ($enableSyntheticLogs -and (Get-Date) -ge $nextSyntheticAt) {
			$syntheticCount++
			$msg = "guardian synthetic log #$syntheticCount"
			Send-SyslogMessage -Body $msg
			Write-Host "Sent synthetic syslog: $msg" -ForegroundColor DarkGray
			$nextSyntheticAt = (Get-Date).AddSeconds($SyntheticLogIntervalSeconds)
		}

		Start-Sleep -Seconds 2
		if ($backendProc.HasExited -or $frontendProc.HasExited -or $collectorProc.HasExited) {
			throw 'One or more services exited unexpectedly. Check runtime-logs for details.'
		}
	}
} finally {
	Write-Host 'Stopping fullstack processes...' -ForegroundColor Yellow
	foreach ($p in @($collectorProc, $frontendProc, $backendProc)) {
		if ($p -and -not $p.HasExited) {
			Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
		}
	}
	Write-Host 'All services stopped.' -ForegroundColor Yellow
}
