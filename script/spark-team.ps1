param(
  [Parameter(Position = 0)]
  [string]$Mission,
  [ValidateRange(1, 3)]
  [int]$MaxReviewRounds = 3,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

if (-not $Mission) {
  $Mission = Read-Host "ProjectCombo mission"
}
if (-not $Mission.Trim()) {
  throw "A mission is required."
}

$projectRoot = "F:\ProjectCombo"
$knowledgeRoot = "F:\ProjectCombo_Builds\ProjectKnowledge"
$exchangeRoot = Join-Path $knowledgeRoot "AgentExchange"
$runName = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $exchangeRoot $runName
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null

$missionPath = Join-Path $runRoot "mission.txt"
$markLog = Join-Path $runRoot "mark1-initial.jsonl"
$spencerLog = Join-Path $runRoot "spencer2-initial.jsonl"
$Mission | Set-Content -LiteralPath $missionPath -Encoding UTF8

function Read-RunResult {
  param([string]$Path)

  $events = Get-Content -LiteralPath $Path -ErrorAction Stop | ForEach-Object {
    if (-not $_.TrimStart().StartsWith("{")) { return }
    try { $_ | ConvertFrom-Json } catch { return }
  }
  $session = $events | Where-Object sessionID | Select-Object -First 1 -ExpandProperty sessionID
  $text = ($events | Where-Object type -EQ "text" | ForEach-Object { $_.part.text }) -join "`n"
  if (-not $session) { throw "No OpenCode session ID was found in $Path" }
  [pscustomobject]@{ Session = $session; Text = $text }
}

function Invoke-Resume {
  param(
    [string]$Agent,
    [string]$Session,
    [string]$Prompt,
    [string]$Log
  )

  Push-Location "F:\"
  try {
    & opencode run --session $Session --agent $Agent --format json $Prompt *> $Log
  } finally {
    Pop-Location
  }
  Read-RunResult $Log
}

$markPrompt = @"
You are Mark1. Work on the mission stored at "$missionPath".
Read it now. Follow ProjectCombo AGENTS.md and the complete Mark1 engineering
workflow. You are the sole writer. Verify before editing, implement the smallest
evidence-backed solution, build/test proportionally, inspect your exact diff,
and finish with a concise evidence report. Do not wait for Spencer2 during this
initial pass; Spencer2 is independently investigating in parallel.
"@

$spencerPrompt = @"
You are Spencer2. Independently investigate the mission stored at "$missionPath"
while Mark1 works concurrently. Remain strictly read-only. Establish acceptance
criteria, inspect current architecture and relevant source, trace dependencies,
identify risks and likely tests, and compare plausible approaches. Do not review
Mark1's unfinished edits yet. Return a compact evidence report for the later
completed-diff review. Do not inspect or summarize unrelated dirty files, infer
system completeness, or spawn subagents.
"@

Write-Host ""
Write-Host "Starting Mark1 and Spencer2 simultaneously..." -ForegroundColor Cyan
$started = Get-Date
$markJob = Start-Job -ScriptBlock {
  param($Prompt, $Log)
  Set-Location "F:\"
  & opencode run --agent mark1 --format json --title "Mark1 $using:runName" $Prompt *> $Log
} -ArgumentList $markPrompt, $markLog
$spencerJob = Start-Job -ScriptBlock {
  param($Prompt, $Log)
  Set-Location "F:\"
  & opencode run --agent spencer2-live --format json --title "Spencer2 $using:runName" $Prompt *> $Log
} -ArgumentList $spencerPrompt, $spencerLog

$null = Wait-Job -Job $markJob, $spencerJob
$markState = $markJob.State
$spencerState = $spencerJob.State
Receive-Job -Job $markJob, $spencerJob -ErrorAction Continue | Out-Null
Remove-Job -Job $markJob, $spencerJob -Force
if ($markState -ne "Completed" -or $spencerState -ne "Completed") {
  throw "Initial agents did not both complete. Mark1=$markState Spencer2=$spencerState. Logs: $runRoot"
}

$mark = Read-RunResult $markLog
$spencer = Read-RunResult $spencerLog
$mark.Text | Set-Content -LiteralPath (Join-Path $runRoot "mark1-initial-report.txt") -Encoding UTF8
$spencer.Text | Set-Content -LiteralPath (Join-Path $runRoot "spencer2-investigation.txt") -Encoding UTF8
Write-Host ("Initial parallel phase completed in {0:n1} minutes." -f ((Get-Date) - $started).TotalMinutes) -ForegroundColor Green

$verdict = ""
for ($round = 1; $round -le $MaxReviewRounds; $round++) {
  $reviewLog = Join-Path $runRoot "spencer2-review-$round.jsonl"
  $reviewPrompt = @"
Mark1 has completed implementation pass $round. Review the CURRENT exact Git
diff and relevant files for the mission in "$missionPath". Mark1's evidence report
is in "$(Join-Path $runRoot "mark1-report-$round.txt")"; your initial investigation
is in "$(Join-Path $runRoot "spencer2-investigation.txt")". Apply the Spencer2
evidence rubric. Return exactly one verdict: ACCEPTED, CHANGES REQUIRED, or OWNER
DECISION REQUIRED. For every problem provide exact evidence and the smallest safe
correction. Never edit, build, or run tests.
"@
  $mark.Text | Set-Content -LiteralPath (Join-Path $runRoot "mark1-report-$round.txt") -Encoding UTF8
  Write-Host "Spencer2 review round $round..." -ForegroundColor Yellow
  $review = Invoke-Resume -Agent "spencer2-live" -Session $spencer.Session -Prompt $reviewPrompt -Log $reviewLog
  $review.Text | Set-Content -LiteralPath (Join-Path $runRoot "spencer2-review-$round.txt") -Encoding UTF8

  $verdict = if ($review.Text -match "OWNER DECISION REQUIRED") {
    "OWNER DECISION REQUIRED"
  } elseif ($review.Text -match "CHANGES REQUIRED") {
    "CHANGES REQUIRED"
  } elseif ($review.Text -match "ACCEPTED") {
    "ACCEPTED"
  } else {
    "UNPARSEABLE"
  }
  Write-Host "Spencer2 verdict: $verdict" -ForegroundColor Cyan
  if ($verdict -eq "ACCEPTED" -or $verdict -eq "OWNER DECISION REQUIRED" -or $verdict -eq "UNPARSEABLE") { break }

  $fixLog = Join-Path $runRoot "mark1-fix-$round.jsonl"
  $fixPrompt = @"
Spencer2 reviewed your current work. Its report is at
"$(Join-Path $runRoot "spencer2-review-$round.txt")". Read it and evaluate every
finding against current source. Fix only proven, in-scope defects; reject
unsupported or scope-expanding suggestions with evidence. Rebuild/retest as
needed, self-review the exact diff, and return an updated evidence report.
"@
  Write-Host "Mark1 correction round $round..." -ForegroundColor Yellow
  $mark = Invoke-Resume -Agent "mark1" -Session $mark.Session -Prompt $fixPrompt -Log $fixLog
}

$summary = @"
ProjectCombo dual-DGX run: $runName
Mission: $Mission
Mark1 session: $($mark.Session)
Spencer2 session: $($spencer.Session)
Final verdict: $verdict
Exchange folder: $runRoot
"@
$summary | Set-Content -LiteralPath (Join-Path $runRoot "summary.txt") -Encoding UTF8
Write-Host ""
Write-Host $summary -ForegroundColor Green
if (-not $NonInteractive) {
  Read-Host "Press Enter to close"
}
