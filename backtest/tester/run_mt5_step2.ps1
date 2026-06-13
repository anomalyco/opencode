param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('global','daily','monthly')]
  [string]$Scenario,

  [string]$DownloadDir = 'C:\Users\wag\Downloads',
  [string]$TerminalExe = 'C:\Program Files\Axiory MetaTrader 5\terminal64.exe',
  [string]$PlatformDir = 'C:\Program Files\Axiory MetaTrader 5',
  [string]$LogRoot = 'C:\Users\wag\AppData\Roaming\MetaQuotes\Terminal\ED051E4A9BEE8A33BDDD0F947358B2B2\Tester\logs'
)

$scenarioMap = @{
  global = @{
    Config = 'step2_global_stop.recovery.ini'
    Report = 'step2_global_stop.htm'
  }
  daily = @{
    Config = 'step2_daily_stop.recovery.ini'
    Report = 'step2_daily_stop.htm'
  }
  monthly = @{
    Config = 'step2_monthly_stop.recovery.ini'
    Report = 'step2_monthly_stop.htm'
  }
}

$entry = $scenarioMap[$Scenario]
$cfg = Join-Path $DownloadDir $entry.Config
$report = Join-Path (Join-Path $PlatformDir 'reports') $entry.Report

if (-not (Test-Path $cfg)) {
  Write-Output ("config=missing|{0}" -f $cfg)
  exit 2
}

if (-not (Test-Path $LogRoot)) {
  Write-Output ("log_root=missing|{0}" -f $LogRoot)
  exit 2
}

if (Test-Path $report) { Remove-Item $report -Force }

$parent = Split-Path $report -Parent
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }

$before = Get-ChildItem -Path $LogRoot -File -Filter *.log |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName,Name,Length,LastWriteTime

if ($before) {
  Write-Output ("before={0}|{1}|{2}" -f $before.Name, $before.Length, $before.LastWriteTime.ToString('yyyy/MM/dd HH:mm:ss'))
} else {
  Write-Output 'before=missing'
}

$arg = '/config:' + $cfg
$start = Get-Date
$proc = Start-Process -FilePath $TerminalExe -ArgumentList $arg -PassThru
$proc.WaitForExit()
$end = Get-Date

Write-Output ("scenario={0}" -f $Scenario)
Write-Output ("config={0}" -f $cfg)
Write-Output ("pid={0}" -f $proc.Id)
Write-Output ("start={0}" -f $start.ToString('yyyy/MM/dd HH:mm:ss'))
Write-Output ("end={0}" -f $end.ToString('yyyy/MM/dd HH:mm:ss'))

$after = Get-ChildItem -Path $LogRoot -File -Filter *.log |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName,Name,Length,LastWriteTime

if ($after) {
  Write-Output ("after={0}|{1}|{2}" -f $after.Name, $after.Length, $after.LastWriteTime.ToString('yyyy/MM/dd HH:mm:ss'))
} else {
  Write-Output 'after=missing'
}

function Get-LogWindowUpdated {
  param(
    $before,
    $after
  )

  if (-not $before -or -not $after) {
    return $false
  }

  if ($before.Name -ne $after.Name) {
    return $true
  }

  return ($after.Length -gt $before.Length) -or ($after.LastWriteTime -gt $before.LastWriteTime)
}

$logWindowUpdated = Get-LogWindowUpdated -before $before -after $after

if (Test-Path $report) {
  $r = Get-Item $report
  Write-Output ("report=present|{0}|{1}|{2}" -f $report, $r.Length, $r.LastWriteTime.ToString('yyyy/MM/dd HH:mm:ss'))
} else {
  Write-Output ("report=missing|{0}" -f $report)
}

if ($logWindowUpdated) {
  Write-Output 'logWindowUpdated=updated'
} else {
  Write-Output 'logWindowUpdated=unknown'
}
