param()

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPath = Join-Path $root 'frontend'
$backendPath = Join-Path $root 'backend'
$collectorPath = Join-Path $root 'agent-syslog-collector'

$stopped = New-Object System.Collections.Generic.HashSet[int]

function Stop-ProcessSafe {
    param(
        [int]$ProcessId,
        [string]$Reason
    )

    if ($ProcessId -le 0 -or $stopped.Contains($ProcessId)) {
        return
    }

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        [void]$stopped.Add($ProcessId)
        Write-Host ("Stopped PID {0} ({1}) via {2}" -f $ProcessId, $process.ProcessName, $Reason) -ForegroundColor Yellow
    } catch {
        Write-Host ("Skip PID {0} via {1}: {2}" -f $ProcessId, $Reason, $_.Exception.Message) -ForegroundColor DarkYellow
    }
}

function Stop-ByProcessName {
    param([string[]]$Names)

    foreach ($name in $Names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
            Stop-ProcessSafe -ProcessId $_.Id -Reason ("process name {0}" -f $name)
        }
    }
}

function Stop-TcpPort {
    param([int]$Port)

    Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            Stop-ProcessSafe -ProcessId $_ -Reason ("tcp port {0}" -f $Port)
        }
}

function Stop-UdpPort {
    param([int]$Port)

    Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            Stop-ProcessSafe -ProcessId $_ -Reason ("udp port {0}" -f $Port)
        }
}

function Stop-RepoShells {
    $patterns = @(
        $frontendPath,
        $backendPath,
        $collectorPath,
        'npm run dev -- --host 127.0.0.1 --port 5174',
        'cargo run',
        'agent_syslog_collector.exe',
        'agent-syslog-collector'
    )

    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $cmd = $_.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) {
                return $false
            }

            foreach ($pattern in $patterns) {
                if ($cmd -like ("*{0}*" -f $pattern)) {
                    return $true
                }
            }

            return $false
        } |
        ForEach-Object {
            Stop-ProcessSafe -ProcessId $_.ProcessId -Reason 'repo command line match'
        }
}

Write-Host 'Stopping Guardian Log full stack...' -ForegroundColor Cyan

Stop-TcpPort -Port 5174
Stop-TcpPort -Port 9000
Stop-UdpPort -Port 5514
Stop-ByProcessName -Names @('log-guardian-backend', 'agent-syslog-collector', 'agent_syslog_collector')
Stop-RepoShells

Write-Host 'Current port status:' -ForegroundColor Cyan
foreach ($port in 5174, 9000) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Write-Host ("TCP {0}: still in use by PID {1}" -f $port, $conn.OwningProcess) -ForegroundColor Red
    } else {
        Write-Host ("TCP {0}: free" -f $port) -ForegroundColor Green
    }
}

$udpConn = Get-NetUDPEndpoint -LocalPort 5514 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($udpConn) {
    Write-Host ("UDP 5514: still in use by PID {0}" -f $udpConn.OwningProcess) -ForegroundColor Red
} else {
    Write-Host 'UDP 5514: free' -ForegroundColor Green
}

Write-Host 'Guardian Log stop sequence completed.' -ForegroundColor Green