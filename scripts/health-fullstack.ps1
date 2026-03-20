param(
    [string]$BackendHealthUrl = 'http://127.0.0.1:9000/health',
    [string]$CollectorBind = '127.0.0.1:5514'
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root 'backend\.env'

function Read-EnvMap {
    param([string]$Path)
    $map = @{}
    if (!(Test-Path $Path)) { return $map }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $pair = $line.Split('=', 2)
        if ($pair.Count -eq 2) {
            $map[$pair[0].Trim()] = $pair[1].Trim()
        }
    }
    return $map
}

function Parse-PgConnString {
    param([string]$Conn)
    $result = @{}
    if ([string]::IsNullOrWhiteSpace($Conn)) { return $result }
    foreach ($part in $Conn.Split(' ')) {
        if ($part -match '=') {
            $kv = $part.Split('=', 2)
            $result[$kv[0]] = $kv[1]
        }
    }
    return $result
}

function Get-PsqlPath {
    $servicePath = (Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-18'" -ErrorAction SilentlyContinue).PathName
    if ($servicePath -and $servicePath -match '"([^"]+pg_ctl\.exe)"') {
        $bin = Split-Path -Parent $matches[1]
        $psql = Join-Path $bin 'psql.exe'
        if (Test-Path $psql) { return $psql }
    }
    $fallback = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if (Test-Path $fallback) { return $fallback }
    return $null
}

$envMap = Read-EnvMap -Path $envFile
$pgRaw = $envMap['POSTGRES_URL']
$rpcUrl = $envMap['SOLANA_RPC_URL']
$pg = Parse-PgConnString -Conn $pgRaw
$psql = Get-PsqlPath

$report = [ordered]@{
    backend = [ordered]@{ ok = $false; detail = '' }
    collector = [ordered]@{ ok = $false; detail = '' }
    database = [ordered]@{ ok = $false; detail = '' }
    latest_log = [ordered]@{ exists = $false; id = ''; ipfs_cid = ''; tx = ''; status = ''; created_at = '' }
    onchain = [ordered]@{ checked = $false; ok = $false; detail = '' }
}

# Backend health
try {
    $resp = Invoke-WebRequest -Uri $BackendHealthUrl -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -eq 200) {
        $report.backend.ok = $true
        $report.backend.detail = $resp.Content
    } else {
        $report.backend.detail = "HTTP $($resp.StatusCode)"
    }
} catch {
    $report.backend.detail = $_.Exception.Message
}

# Collector process + UDP bind
$collectorProc = Get-Process -Name 'agent-syslog-collector','agent_syslog_collector' -ErrorAction SilentlyContinue | Select-Object -First 1
$udpParts = $CollectorBind.Split(':')
$udpPort = [int]$udpParts[1]
$udp = Get-NetUDPEndpoint -LocalPort $udpPort -ErrorAction SilentlyContinue | Select-Object -First 1
if ($collectorProc -and $udp) {
    $report.collector.ok = $true
    $report.collector.detail = "pid=$($collectorProc.Id), udp=$CollectorBind"
} else {
    $detail = @()
    if (-not $collectorProc) { $detail += 'collector process missing' }
    if (-not $udp) { $detail += 'udp bind missing' }
    $report.collector.detail = ($detail -join '; ')
}

# DB + latest log
if ($psql -and $pg['host'] -and $pg['port'] -and $pg['user'] -and $pg['dbname']) {
    $env:PGPASSWORD = $pg['password']
    $query = "SELECT id, COALESCE(ipfs_cid,''), COALESCE(blockchain_tx_id,''), COALESCE(verification_status,''), to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') FROM logs ORDER BY created_at DESC LIMIT 1;"
    $row = & $psql -h $pg['host'] -p $pg['port'] -U $pg['user'] -d $pg['dbname'] -tAc $query 2>$null
    if ($LASTEXITCODE -eq 0) {
        $report.database.ok = $true
        $report.database.detail = 'query success'
        if (-not [string]::IsNullOrWhiteSpace($row)) {
            $parts = $row.Trim().Split('|')
            $report.latest_log.exists = $true
            $report.latest_log.id = $parts[0]
            $report.latest_log.ipfs_cid = $parts[1]
            $report.latest_log.tx = $parts[2]
            $report.latest_log.status = $parts[3]
            $report.latest_log.created_at = $parts[4]
        }
    } else {
        $report.database.detail = 'psql query failed'
    }
} else {
    $report.database.detail = 'postgres config incomplete or psql missing'
}

# On-chain confirmation for latest tx
if ($report.latest_log.exists -and $report.latest_log.tx -and $report.latest_log.tx -ne 'PENDING' -and $rpcUrl) {
    $report.onchain.checked = $true
    try {
        $body = @{ jsonrpc = '2.0'; id = 1; method = 'getSignatureStatuses'; params = @(@($report.latest_log.tx), @{ searchTransactionHistory = $true }) } | ConvertTo-Json -Depth 8
        $rpcResp = Invoke-RestMethod -Method Post -Uri $rpcUrl -ContentType 'application/json' -Body $body -TimeoutSec 10
        $statusObj = $rpcResp.result.value[0]
        if ($statusObj -and $null -eq $statusObj.err) {
            $report.onchain.ok = $true
            $report.onchain.detail = "confirmationStatus=$($statusObj.confirmationStatus); slot=$($statusObj.slot)"
        } else {
            $report.onchain.detail = 'signature not confirmed or has error'
        }
    } catch {
        $report.onchain.detail = $_.Exception.Message
    }
}

$allOk = $report.backend.ok -and $report.collector.ok -and $report.database.ok
if ($report.onchain.checked) { $allOk = $allOk -and $report.onchain.ok }

Write-Host '=== Guardian Fullstack Health ===' -ForegroundColor Cyan
Write-Host ("Backend : {0} | {1}" -f ($(if($report.backend.ok){'OK'}else{'FAIL'}), $report.backend.detail))
Write-Host ("Collector: {0} | {1}" -f ($(if($report.collector.ok){'OK'}else{'FAIL'}), $report.collector.detail))
Write-Host ("Database: {0} | {1}" -f ($(if($report.database.ok){'OK'}else{'FAIL'}), $report.database.detail))
if ($report.latest_log.exists) {
    Write-Host ("Latest log: id={0} status={1} ipfs={2} tx={3} at={4}" -f $report.latest_log.id, $report.latest_log.status, $report.latest_log.ipfs_cid, $report.latest_log.tx, $report.latest_log.created_at)
} else {
    Write-Host 'Latest log: none'
}
if ($report.onchain.checked) {
    Write-Host ("On-chain : {0} | {1}" -f ($(if($report.onchain.ok){'OK'}else{'FAIL'}), $report.onchain.detail))
} else {
    Write-Host 'On-chain : skipped (no latest signature or RPC URL missing)'
}

if ($allOk) {
    Write-Host 'Overall : OK' -ForegroundColor Green
    exit 0
}

Write-Host 'Overall : FAIL' -ForegroundColor Red
exit 1
