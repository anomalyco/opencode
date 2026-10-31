# Run-Minimal.ps1 - live end-to-end test for the code-coach card.
#
# Starts the real daemon in a child process and writes the same req-<id>.json
# the plugin writes. The plugin never waits for an answer, so this test asserts
# what the developer can actually observe:
#
#   destructive - a delete ask with no recovery point shows a card whose
#                 "Copy the guardrail" puts the guardrail on the clipboard
#   security    - a credential ask shows "N things before you accept this"
#   explain     - "Explain why" swaps the card to the teaching text in place,
#                 and "Back" returns to the findings
#   fix         - "Fix my prompt" puts a rewritten ask on the clipboard
#   ignore      - "Ignore" closes the card without touching the clipboard
#   silent      - benign asks, guarded asks, and named-file deletes show nothing
#   one         - a second card-worthy ask while a card is up is dropped
#   stale       - a request older than the limit is dropped without a card
#   quiet       - no prompt text reaches daemon.log or trace.jsonl
#   guard       - a second daemon on the same folder refuses to start
#   stop        - the stop file closes the card and removes the pid file
#
# Windows only, like the daemon. Exits non-zero if any check fails.

param([switch]$Keep)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$root = Split-Path -Parent $PSScriptRoot
$daemon = Join-Path $root 'src\Coach.Daemon.ps1'
if (-not (Test-Path -LiteralPath $daemon)) { throw "missing $daemon" }

$data = Join-Path ([System.IO.Path]::GetTempPath()) ('cc-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$ipc = Join-Path $data 'ipc'
$log = Join-Path $data 'logs\daemon.log'
$trace = Join-Path $data 'trace.jsonl'
$pidFile = Join-Path $data 'daemon.pid'
New-Item -ItemType Directory -Force -Path $ipc | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)
$checks = 0
$fails = 0

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  $script:checks++
  if ($Ok) {
    Write-Output ('[PASS] ' + $Name)
  } else {
    $script:fails++
    if ($Detail) { Write-Output ('[FAIL] ' + $Name + ' :: ' + $Detail) }
    else { Write-Output ('[FAIL] ' + $Name) }
  }
}

function Write-Req([string]$Text, [int]$AgeSeconds = 0) {
  $id = [guid]::NewGuid().ToString()
  $payload = @{ id = $id; text = $Text; cwd = 'C:\repo'; sid = 's-live'; at = 0 } | ConvertTo-Json -Compress
  $path = Join-Path $ipc ('req-' + $id + '.json')
  $tmp = $path + '.tmp'
  [System.IO.File]::WriteAllText($tmp, $payload, $utf8)
  if ($AgeSeconds -gt 0) { (Get-Item -LiteralPath $tmp).LastWriteTime = (Get-Date).AddSeconds(-$AgeSeconds) }
  Move-Item -LiteralPath $tmp -Destination $path -Force
  return $id
}

function Wait-Gone([string]$Id, [int]$Milliseconds = 3000) {
  $path = Join-Path $ipc ('req-' + $Id + '.json')
  $until = (Get-Date).AddMilliseconds($Milliseconds)
  while ((Get-Date) -lt $until) {
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    Start-Sleep -Milliseconds 30
  }
  return $false
}

function Find-Cards() {
  $rootEl = [System.Windows.Automation.AutomationElement]::RootElement
  $idCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CodeCoachGateCard')
  return @($rootEl.FindAll([System.Windows.Automation.TreeScope]::Children, $idCond))
}

function Wait-Card([int]$Milliseconds = 4000) {
  $until = (Get-Date).AddMilliseconds($Milliseconds)
  while ((Get-Date) -lt $until) {
    $cards = Find-Cards
    if ($cards.Count -gt 0) { return $cards[0] }
    Start-Sleep -Milliseconds 50
  }
  return $null
}

function Wait-CardGone([int]$Milliseconds = 3000) {
  $until = (Get-Date).AddMilliseconds($Milliseconds)
  while ((Get-Date) -lt $until) {
    if ((Find-Cards).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 50
  }
  return $false
}

function Find-Button($Card, [string]$AutomationId) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
  return $Card.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Invoke-CardButton($Card, [string]$AutomationId) {
  $button = Find-Button $Card $AutomationId
  if (-not $button) { return $false }
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  return $true
}

function Get-CardText($Card) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
  $parts = @($Card.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | ForEach-Object { $_.Current.Name })
  return ($parts -join "`n")
}

function Wait-CardText($Card, [string]$Needle, [int]$Milliseconds = 3000) {
  $until = (Get-Date).AddMilliseconds($Milliseconds)
  while ((Get-Date) -lt $until) {
    if ((Get-CardText $Card) -like ('*' + $Needle + '*')) { return $true }
    Start-Sleep -Milliseconds 50
  }
  return $false
}

function Read-Clipboard() {
  try { return [System.Windows.Clipboard]::GetText() } catch { return '' }
}

function Set-ClipboardSafe([string]$Text) {
  try { [System.Windows.Clipboard]::SetText($Text); return $true } catch { return $false }
}

$previous = $env:COACH_DATA_DIR
$env:COACH_DATA_DIR = $data
$daemonArgs = '-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "' + $daemon + '"'
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $daemonArgs -PassThru -WindowStyle Hidden
$env:COACH_DATA_DIR = $previous

try {
  $until = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $until -and -not (Test-Path -LiteralPath $pidFile)) { Start-Sleep -Milliseconds 100 }
  Check 'daemon wrote its pid file' (Test-Path -LiteralPath $pidFile)
  Check 'daemon process is alive' (-not $proc.HasExited)
  if ($proc.HasExited) { throw 'daemon exited before the first request' }

  $sentinel = 'coach-test-sentinel-' + [guid]::NewGuid().ToString('N').Substring(0, 6)

  # 1. destructive ask -> one card, copy the guardrail
  $id = Write-Req 'delete all the logs from last week'
  $card = Wait-Card
  Check 'destructive ask shows a card' ($null -ne $card)
  Check 'the request is consumed' (Wait-Gone $id 2000)
  Check 'exactly one card' ((Find-Cards).Count -eq 1) (([string](Find-Cards).Count) + ' cards')
  Check 'destructive card offers Copy the guardrail' ($null -ne (Find-Button $card 'CoachCopyGuardrail'))
  Check 'destructive card offers Dismiss' ($null -ne (Find-Button $card 'CoachDismiss'))
  Check 'clipboard can be seeded' (Set-ClipboardSafe $sentinel)
  $clicked = if ($card) { Invoke-CardButton $card 'CoachCopyGuardrail' } else { $false }
  Check 'Copy the guardrail clicked' $clicked
  Start-Sleep -Milliseconds 200
  $clip = Read-Clipboard
  Check 'clipboard holds the guardrail' ($clip -like 'Before you delete or rewrite anything*') $clip
  Check 'card closed after the copy' (Wait-CardGone 3000)

  # 2. silence
  $id = Write-Req 'summarize the current state of the parser'
  Check 'benign request is consumed' (Wait-Gone $id 3000)
  Check 'benign ask shows no card' ((Find-Cards).Count -eq 0)

  $id = Write-Req 'delete the old logs after committing the current state first'
  Check 'guarded request is consumed' (Wait-Gone $id 3000)
  Check 'guarded destructive ask shows no card' ((Find-Cards).Count -eq 0)

  $id = Write-Req 'delete src/app.ts'
  Check 'named-file delete is consumed' (Wait-Gone $id 3000)
  Check 'named-file delete shows no card' ((Find-Cards).Count -eq 0)

  # 3. the security card from the design issue
  $example = 'Add a login endpoint that checks the user''s password against the database'
  $id = Write-Req $example
  $card = Wait-Card
  Check 'credential ask shows a card' ($null -ne $card)
  Check 'credential request is consumed' (Wait-Gone $id 2000)
  $text = if ($card) { Get-CardText $card } else { '' }
  Check 'card title counts two findings' ($text -like '*2 things before you accept this*') $text
  Check 'card names the plaintext compare' ($text -like '*compared in plaintext*')
  Check 'card names the missing rate limit' ($text -like '*No rate limiting*')
  Check 'card offers Explain why' ($null -ne (Find-Button $card 'CoachExplain'))
  Check 'card offers Fix my prompt' ($null -ne (Find-Button $card 'CoachFixPrompt'))
  Check 'card offers Ignore' ($null -ne (Find-Button $card 'CoachIgnore'))

  # 4. Explain why -> teaching text -> Back
  $clicked = if ($card) { Invoke-CardButton $card 'CoachExplain' } else { $false }
  Check 'Explain why clicked' $clicked
  Check 'card shows the teaching text' (Wait-CardText $card 'one-way function' 3000)
  Check 'explain view offers Back' ($null -ne (Find-Button $card 'CoachBack'))
  Check 'explain view still offers Fix my prompt' ($null -ne (Find-Button $card 'CoachFixPrompt'))
  $clicked = if ($card) { Invoke-CardButton $card 'CoachBack' } else { $false }
  Check 'Back clicked' $clicked
  Check 'card returns to the findings' (Wait-CardText $card 'Passwords would be compared in plaintext' 3000)
  Check 'findings view offers Explain why again' ($null -ne (Find-Button $card 'CoachExplain'))

  # 5. Fix my prompt -> clipboard
  Check 'clipboard can be re-seeded' (Set-ClipboardSafe $sentinel)
  $clicked = if ($card) { Invoke-CardButton $card 'CoachFixPrompt' } else { $false }
  Check 'Fix my prompt clicked' $clicked
  Start-Sleep -Milliseconds 200
  $fixed = Read-Clipboard
  Check 'clipboard holds a rewritten ask' ($fixed -like 'Add a login endpoint*') $fixed
  Check 'rewrite names bcrypt or argon2id' ($fixed -match 'bcrypt|argon2id') $fixed
  Check 'rewrite adds constant-time compare' ($fixed -match 'constant time') $fixed
  Check 'rewrite adds rate limiting' ($fixed -match 'rate-limit') $fixed
  Check 'rewrite adds generic errors' ($fixed -match 'generic errors') $fixed
  Check 'rewrite is not the original' ($fixed -ne $example)
  Check 'card closed after Fix my prompt' (Wait-CardGone 3000)

  # 6. Ignore leaves the clipboard alone
  $id = Write-Req $example
  $card = Wait-Card
  Check 'second credential ask shows a card' ($null -ne $card)
  Check 'clipboard can be seeded again' (Set-ClipboardSafe $sentinel)
  $clicked = if ($card) { Invoke-CardButton $card 'CoachIgnore' } else { $false }
  Check 'Ignore clicked' $clicked
  Check 'card closed after Ignore' (Wait-CardGone 3000)
  Start-Sleep -Milliseconds 150
  Check 'Ignore left the clipboard alone' ((Read-Clipboard) -eq $sentinel)

  # 6b. a non-password finding gets the same card and the same actions
  $sqlAsk = 'build a SQL query from the user''s input'
  $id = Write-Req $sqlAsk
  $card = Wait-Card
  Check 'sql ask shows a card' ($null -ne $card)
  Check 'sql request is consumed' (Wait-Gone $id 2000)
  $text = if ($card) { Get-CardText $card } else { '' }
  Check 'sql card names the sql finding' ($text -like '*SQL built from input*') $text
  Check 'sql card offers Explain why' ($null -ne (Find-Button $card 'CoachExplain'))
  Check 'sql card offers Fix my prompt' ($null -ne (Find-Button $card 'CoachFixPrompt'))
  Check 'sql card offers Ignore' ($null -ne (Find-Button $card 'CoachIgnore'))
  Check 'clipboard can be seeded for sql' (Set-ClipboardSafe $sentinel)
  $clicked = if ($card) { Invoke-CardButton $card 'CoachFixPrompt' } else { $false }
  Check 'sql Fix my prompt clicked' $clicked
  Start-Sleep -Milliseconds 200
  $fixedSql = Read-Clipboard
  Check 'sql fix puts parameterized on the clipboard' ($fixedSql -match 'parameterized') $fixedSql
  Check 'sql card closed after the fix' (Wait-CardGone 3000)

  # 7. a second card-worthy ask while a card is up is dropped, not stacked
  $idA = Write-Req 'reset the database to a clean state'
  $card = Wait-Card
  Check 'card is up before the second ask' ($null -ne $card)
  $idB = Write-Req 'drop the users table'
  Check 'second request is consumed' (Wait-Gone $idB 3000)
  Check 'still exactly one card' ((Find-Cards).Count -eq 1) (([string](Find-Cards).Count) + ' cards')
  if ($card) { [void](Invoke-CardButton $card 'CoachDismiss') }
  Check 'card closes after the drop' (Wait-CardGone 3000)

  # 8. a stale request is dropped without a card
  $id = Write-Req 'delete all the logs from last week' 600
  Check 'stale request is consumed' (Wait-Gone $id 3000)
  Check 'stale request shows no card' ((Find-Cards).Count -eq 0)

  # 9. pid guard
  $env:COACH_DATA_DIR = $data
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $daemon 2>&1
  $code = $LASTEXITCODE
  $env:COACH_DATA_DIR = $previous
  Check 'guard: second daemon exits 2' ($code -eq 2) ('exit ' + $code)
  Check 'guard: second daemon names the running pid' (($out -join "`n") -match 'refused: daemon \d+ is already running')

  # 10. quiet + trace
  $requests = @(Get-ChildItem -LiteralPath $ipc -Filter 'req-*.json' -File -ErrorAction SilentlyContinue)
  Check 'no request files left behind' ($requests.Count -eq 0) ($requests.Count.ToString() + ' left')
  $logText = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { '' }
  $traceText = if (Test-Path -LiteralPath $trace) { Get-Content -LiteralPath $trace -Raw } else { '' }
  $secrets = @(
    'delete all the logs from last week',
    'summarize the current state of the parser',
    'delete the old logs after committing the current state first',
    'delete src/app.ts',
    "checks the user's password against the database",
    'reset the database to a clean state',
    'drop the users table',
    'build a SQL query from the user''s input'
  )
  $leaked = @($secrets | Where-Object { $logText -like ('*' + $_ + '*') -or $traceText -like ('*' + $_ + '*') })
  Check 'no prompt text in daemon.log or trace.jsonl' ($leaked.Count -eq 0) ($leaked -join ' | ')

  $events = @()
  foreach ($line in @($traceText -split '\r?\n')) {
    if (-not $line) { continue }
    try { $ev = $line | ConvertFrom-Json; if ($ev.ev) { $events += $ev } } catch { }
  }
  $names = @($events | ForEach-Object { [string]$_.ev })
  $actions = @($events | Where-Object { $_.ev -eq 'card_action' } | ForEach-Object { [string]$_.action })
  $kinds = @($events | Where-Object { $_.ev -eq 'card_shown' } | ForEach-Object { [string]$_.kind })
  Check 'trace records a destructive card' ($kinds -contains 'destructive')
  Check 'trace records a security card' ($kinds -contains 'security')
  Check 'trace records explain' ($actions -contains 'explain')
  Check 'trace records back' ($actions -contains 'back')
  Check 'trace records fix' ($actions -contains 'fix')
  Check 'trace records the dropped second card' ($names -contains 'card_dropped')
  Check 'trace records the stale request' ($names -contains 'request_stale')
  Check 'trace records silence' ($names -contains 'silent')

  # 11. graceful stop
  [System.IO.File]::WriteAllText((Join-Path $data 'stop'), 'stop', $utf8)
  $exited = $proc.WaitForExit(5000)
  Check 'stop: daemon exits on the stop file' $exited
  Check 'stop: pid file removed' (-not (Test-Path -LiteralPath $pidFile))
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  if ($Keep) { Write-Output ('data kept: ' + $data) }
  else { Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Output ''
Write-Output ('checks: ' + $checks + '  failed: ' + $fails)
if ($fails -gt 0) { exit 1 }
Write-Output 'minimal gate: PASS'
