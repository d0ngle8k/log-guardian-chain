param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$autostartDir = Join-Path $root 'autostart'

$taskDefs = @(
    @{ Name = 'GuardianLog-Postgres5433'; Script = (Join-Path $autostartDir 'start-postgres-5433.ps1') },
    @{ Name = 'GuardianLog-Backend'; Script = (Join-Path $autostartDir 'start-backend.ps1') },
    @{ Name = 'GuardianLog-Collector'; Script = (Join-Path $autostartDir 'start-collector.ps1') },
    @{ Name = 'GuardianLog-Sender'; Script = (Join-Path $autostartDir 'start-sender.ps1') }
)

$user = "$env:USERDOMAIN\$env:USERNAME"

foreach ($task in $taskDefs) {
    if (!(Test-Path $task.Script)) {
        throw "Missing script for task $($task.Name): $($task.Script)"
    }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($task.Script)`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "Registered task: $($task.Name)" -ForegroundColor Green
}

Write-Host 'All Guardian Log startup tasks are installed.' -ForegroundColor Cyan
