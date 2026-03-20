param()

$ErrorActionPreference = 'Continue'
$taskNames = @(
    'GuardianLog-Postgres5433',
    'GuardianLog-Backend',
    'GuardianLog-Collector',
    'GuardianLog-Sender'
)

foreach ($name in $taskNames) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed task (if existed): $name" -ForegroundColor Yellow
}

Write-Host 'Guardian Log startup task cleanup finished.' -ForegroundColor Cyan
