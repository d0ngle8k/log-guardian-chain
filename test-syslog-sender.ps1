# Test Syslog Sender - Sends logs every 300 seconds
param(
    [string]$BindAddr = "127.0.0.1",
    [int]$BindPort = 5514,
    [int]$IntervalSeconds = 300,
    [int]$MaxMessages = 0  # 0 = infinite
)

$udpClient = New-Object System.Net.Sockets.UdpClient
$udpClient.Connect($BindAddr, $BindPort)

$counter = 1
$hostname = $env:COMPUTERNAME
$baseTime = Get-Date

Write-Host "=== Syslog Test Generator ===" -ForegroundColor Cyan
Write-Host "Target: $BindAddr`:$BindPort"
Write-Host "Interval: ${IntervalSeconds}s"
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Sending logs... (Ctrl+C to stop)`n" -ForegroundColor Green

$logTemplates = @(
    "Authentication successful for user {user}",
    "Database connection established from {ip}",
    "File access: {file} by user {user}",
    "Network packet received from {ip}:{port}",
    "Service health check passed - CPU: {cpu}%, Memory: {mem}%",
    "API request processed: {method} {path} - Status: {status}",
    "Cache hit rate: {rate}%",
    "Disk usage: {disk}%",
    "Network latency: {latency}ms",
    "Process {pid} started successfully"
)

$users = @("admin", "user", "system", "app", "service")
$methods = @("GET", "POST", "PUT", "DELETE")
$paths = @("/api/logs", "/api/metrics", "/api/auth", "/health", "/status")
$ips = @("192.168.1.1", "10.0.0.1", "172.16.0.1", "8.8.8.8")

function Generate-RandomValue {
    param(
        [string]$Type
    )
    switch ($Type) {
        "user" { return $users[(Get-Random -Maximum $users.Count)] }
        "ip" { return $ips[(Get-Random -Maximum $ips.Count)] }
        "file" { return "/var/log/app/$(Get-Random -Maximum 100).log" }
        "port" { return Get-Random -Minimum 1024 -Maximum 65535 }
        "cpu" { return Get-Random -Minimum 10 -Maximum 90 }
        "mem" { return Get-Random -Minimum 20 -Maximum 85 }
        "status" { return (Get-Random -Maximum 5) * 100 + 200 }
        "rate" { return Get-Random -Minimum 70 -Maximum 99 }
        "disk" { return Get-Random -Minimum 30 -Maximum 80 }
        "latency" { return Get-Random -Minimum 5 -Maximum 150 }
        "pid" { return Get-Random -Minimum 1000 -Maximum 9999 }
        "method" { return $methods[(Get-Random -Maximum $methods.Count)] }
        "path" { return $paths[(Get-Random -Maximum $paths.Count)] }
    }
}

function Create-SyslogMessage {
    param([int]$MsgNumber)
    
    $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $template = $logTemplates[(Get-Random -Maximum $logTemplates.Count)]
    
    # Replace placeholders
    $message = $template
    $placeholders = [regex]::Matches($message, '\{(\w+)\}')
    foreach ($match in $placeholders) {
        $placeholder = $match.Groups[1].Value
        $value = Generate-RandomValue -Type $placeholder
        $message = $message -replace "\{$placeholder\}", $value
    }
    
    # RFC 3164 format
    $priority = 134  # local0.informational
    $tag = "log-guardian-test"
    $syslogMsg = "<$priority>$timestamp $hostname $tag[${MsgNumber}]: $message"
    
    return $syslogMsg
}

try {
    while ($true) {
        if ($MaxMessages -gt 0 -and $counter -gt $MaxMessages) {
            break
        }
        
        $syslogMessage = Create-SyslogMessage -MsgNumber $counter
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($syslogMessage)
        
        $udpClient.Send($bytes, $bytes.Length) | Out-Null
        
        $elapsed = ((Get-Date) - $baseTime).TotalSeconds
        Write-Host "[$counter] [$(Get-Date -Format 'HH:mm:ss')] Sent: ${syslogMessage:0:80}..." -ForegroundColor Green
        Write-Host "         Elapsed: ${elapsed:f0}s`n" -ForegroundColor DarkGray
        
        $counter++
        Start-Sleep -Seconds $IntervalSeconds
    }
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
finally {
    $udpClient.Close()
    Write-Host "`nStopped. Total messages sent: $($counter - 1)" -ForegroundColor Yellow
}
