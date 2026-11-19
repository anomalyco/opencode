# Coach.Daemon.ps1 - the code-coach card daemon.
#
# Watches the IPC folder for req-<id>.json, asks src/Coach.Rules.ps1 what the
# ask deserves, and shows at most one card. It never talks back to the plugin:
# the plugin does not wait for this process, so nothing here can delay or change
# a send.
#
# Card shapes:
#   destructive - "Copy the guardrail" / "Dismiss"
#   security    - "Explain why" / "Fix my prompt" / "Ignore"
#                 Explain why swaps the card to the teaching text in place and
#                 offers "Back"; Fix my prompt puts a rewritten ask on the
#                 clipboard; Ignore closes it.
#
# One card at a time. A second card-worthy ask while a card is up is dropped and
# traced rather than stacked.
#
# No prompt text is ever logged or traced.

param([switch]$Once)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

if (-not ('CoachGateWin32' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CoachGateWin32 {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int nValue);
}
'@
}

. (Join-Path $PSScriptRoot 'Coach.Rules.ps1')

$Data = if ($env:COACH_DATA_DIR) { $env:COACH_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'CodeCoachData' }
$Ipc = Join-Path $Data 'ipc'
$LogDir = Join-Path $Data 'logs'
$Log = Join-Path $LogDir 'daemon.log'
$Trace = Join-Path $Data 'trace.jsonl'
$PidFile = Join-Path $Data 'daemon.pid'
$StopFile = Join-Path $Data 'stop'

# How long a card stays up. Hovering pauses the countdown. The card is the only
# interruption this slice can produce, so it gets long enough to actually read.
$CardSeconds = 60
# A request older than this belongs to a session that has moved on. Answering it
# with a card would be a nudge about something the developer finished minutes ago.
$MaxRequestAgeSeconds = 120

New-Item -ItemType Directory -Force -Path $Ipc, $LogDir | Out-Null

# Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM. The plugin
# reads daemon.pid with Number(...), and Number("\uFEFF123") is NaN, so a BOM
# there would make the plugin believe the coach is dead and go silent.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$Line) {
  try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToUniversalTime().ToString('o') + ' ' + $Line) -Encoding UTF8 } catch { }
}

function Write-Trace($Event) {
  try {
    $Event.ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Add-Content -LiteralPath $Trace -Value ($Event | ConvertTo-Json -Compress -Depth 6) -Encoding UTF8
  } catch { }
}

# A second daemon on the same folder would double-answer every request.
if (Test-Path -LiteralPath $PidFile) {
  $other = 0
  try { $other = [int](Get-Content -LiteralPath $PidFile -Raw) } catch { $other = 0 }
  if ($other -gt 0 -and $other -ne $PID -and (Get-Process -Id $other -ErrorAction SilentlyContinue)) {
    Write-Output ("refused: daemon $other is already running on $Data")
    exit 2
  }
}
[System.IO.File]::WriteAllText($PidFile, [string]$PID, $Utf8NoBom)
Write-Log 'daemon: starting'

$script:ActiveCard = $null
$script:PumpFrame = $null
$script:Seen = @{}

function Close-Card {
  $card = $script:ActiveCard
  if (-not $card) { return }
  $script:ActiveCard = $null
  try { if ($card.timer) { $card.timer.Stop() } } catch { }
  try { $card.window.Close() } catch { }
}

function Set-ClipboardText([string]$Text) {
  # Another process can hold the clipboard open for a few milliseconds; a
  # single throw would lose the copy and leave the card up with no feedback.
  for ($i = 0; $i -lt 5; $i++) {
    try {
      [System.Windows.Clipboard]::SetText($Text)
      return $true
    } catch {
      Start-Sleep -Milliseconds 40
    }
  }
  return $false
}

function Render-View($View) {
  $card = $script:ActiveCard
  if (-not $card) { return }
  $card.title.Text = [string]$View.title
  $card.body.Text = [string]$View.body
  $card.row.Children.Clear()
  $card.view = $View
  foreach ($spec in @($View.buttons)) {
    $btn = New-Object System.Windows.Controls.Button
    $btn.Content = [string]$spec.label
    $btn.Padding = '10,4'
    $btn.Margin = '0,0,8,0'
    $btn.Tag = [string]$spec.action
    [System.Windows.Automation.AutomationProperties]::SetAutomationId($btn, [string]$spec.id)
    # `$sender` is the button, so the handler cannot capture the loop variable.
    $btn.Add_Click({ param($sender, $args) Invoke-Action ([string]$sender.Tag) })
    [void]$card.row.Children.Add($btn)
  }
}

function Invoke-Action([string]$Action) {
  $card = $script:ActiveCard
  if (-not $card) { return }
  try {
    switch ($Action) {
      'copy' {
        $ok = Set-ClipboardText ([string]$card.model.guardrail)
        Write-Trace @{ ev = 'card_action'; kind = [string]$card.model.kind; action = 'copy'; ok = $ok }
        Write-Log ('card: copy ' + $(if ($ok) { 'ok' } else { 'failed' }))
        Close-Card
      }
      'fix' {
        $ok = Set-ClipboardText ([string]$card.model.fixed)
        Write-Trace @{ ev = 'card_action'; kind = [string]$card.model.kind; action = 'fix'; ok = $ok }
        Write-Log ('card: fix ' + $(if ($ok) { 'ok' } else { 'failed' }))
        Close-Card
      }
      'explain' {
        Write-Trace @{ ev = 'card_action'; kind = [string]$card.model.kind; action = 'explain' }
        Render-View $card.explainView
      }
      'back' {
        Write-Trace @{ ev = 'card_action'; kind = [string]$card.model.kind; action = 'back' }
        Render-View $card.findingsView
      }
      default {
        Write-Trace @{ ev = 'card_action'; kind = [string]$card.model.kind; action = 'dismiss' }
        Write-Log 'card: dismissed'
        Close-Card
      }
    }
  } catch {
    Write-Log ('card action failed: ' + $_.Exception.Message)
    Close-Card
  }
}

function Invoke-Pump([int]$Milliseconds = 40) {
  $script:PumpFrame = New-Object System.Windows.Threading.DispatcherFrame
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($Milliseconds)
  $timer.add_Tick({ $script:PumpFrame.Continue = $false })
  $timer.Start()
  try { [System.Windows.Threading.Dispatcher]::PushFrame($script:PumpFrame) } finally { $timer.Stop() }
}

function Show-Card([string]$Id, $Model) {
  $win = New-Object System.Windows.Window
  $win.Title = 'Code Coach'
  $win.WindowStyle = 'None'
  $win.AllowsTransparency = $true
  $win.Background = [System.Windows.Media.Brushes]::Transparent
  $win.ShowInTaskbar = $false
  $win.Topmost = $true
  $win.ShowActivated = $false
  $win.ResizeMode = 'NoResize'
  $win.Focusable = $false
  $win.WindowStartupLocation = 'Manual'
  $win.SizeToContent = 'WidthAndHeight'
  [System.Windows.Automation.AutomationProperties]::SetAutomationId($win, 'CodeCoachGateCard')

  $panel = New-Object System.Windows.Controls.StackPanel
  $panel.Margin = '18,14,18,14'
  $panel.MaxWidth = 440

  $title = New-Object System.Windows.Controls.TextBlock
  $title.FontSize = 15
  $title.FontWeight = 'SemiBold'
  $title.TextWrapping = 'Wrap'
  [void]$panel.Children.Add($title)

  $body = New-Object System.Windows.Controls.TextBlock
  $body.FontSize = 12
  $body.Margin = '0,6,0,0'
  $body.TextWrapping = 'Wrap'
  $body.LineHeight = 17
  [void]$panel.Children.Add($body)

  $meta = New-Object System.Windows.Controls.TextBlock
  $meta.FontSize = 10.5
  $meta.Margin = '0,8,0,0'
  $meta.Foreground = [System.Windows.Media.Brushes]::Gray
  [void]$panel.Children.Add($meta)

  $row = New-Object System.Windows.Controls.StackPanel
  $row.Orientation = 'Horizontal'
  $row.Margin = '0,12,0,0'
  [void]$panel.Children.Add($row)

  $border = New-Object System.Windows.Controls.Border
  $border.CornerRadius = '10'
  $border.Padding = '1'
  $border.Background = [System.Windows.Media.Brushes]::White
  $border.BorderBrush = [System.Windows.Media.Brushes]::Silver
  $border.BorderThickness = '1'
  $border.Child = $panel
  $win.Content = $border

  $helper = New-Object System.Windows.Interop.WindowInteropHelper($win)
  [void]$helper.EnsureHandle()
  $ex = [CoachGateWin32]::GetWindowLong($helper.Handle, -20)
  [void][CoachGateWin32]::SetWindowLong($helper.Handle, -20, ($ex -bor 0x08000000 -bor 0x00000080))

  $win.Show()
  $win.UpdateLayout()
  $area = [System.Windows.SystemParameters]::WorkArea
  $win.Left = [Math]::Max($area.Left, $area.Right - $win.ActualWidth - 24)
  $win.Top = [Math]::Max($area.Top, $area.Bottom - $win.ActualHeight - 24)

  $script:ActiveCard = @{
    id     = $Id
    window = $win
    timer  = $null
    meta   = $meta
    title  = $title
    body   = $body
    row    = $row
    model  = $Model
    view   = $null
  }

  $findingsView = @{ title = $Model.title; body = $Model.body; buttons = $Model.buttons }
  $script:ActiveCard.findingsView = $findingsView
  if ($Model.explain) {
    $script:ActiveCard.explainView = @{
      title   = [string]$Model.explain.title
      body    = [string]$Model.explain.body
      buttons = @(
        @{ id = 'CoachBack'; label = 'Back'; action = 'back' },
        @{ id = 'CoachFixPrompt'; label = 'Fix my prompt'; action = 'fix' },
        @{ id = 'CoachIgnore'; label = 'Ignore'; action = 'ignore' }
      )
    }
  }

  # Hovering stops the countdown so a card can be read at the reader's pace.
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromSeconds($CardSeconds)
  $timer.add_Tick({
    Write-Log 'card: expired'
    Write-Trace @{ ev = 'card_expired' }
    Close-Card
  })
  $timer.Start()
  $script:ActiveCard.timer = $timer
  $meta.Text = ('dismisses in {0}s' -f $CardSeconds)

  $win.add_MouseEnter({ try { if ($script:ActiveCard -and $script:ActiveCard.timer) { $script:ActiveCard.timer.Stop(); $script:ActiveCard.meta.Text = 'paused while you read' } } catch { } })
  $win.add_MouseLeave({ try { if ($script:ActiveCard -and $script:ActiveCard.timer) { $script:ActiveCard.timer.Start(); $script:ActiveCard.meta.Text = ('dismisses in {0}s' -f $CardSeconds) } } catch { } })

  Render-View $findingsView

  Write-Log ('card up: ' + $Model.kind)
  Write-Trace @{ ev = 'card_shown'; id = $Id; kind = [string]$Model.kind }
}

try {
  while ($true) {
    if (Test-Path -LiteralPath $StopFile) { break }

    $requests = @(Get-ChildItem -LiteralPath $Ipc -Filter 'req-*.json' -File -ErrorAction SilentlyContinue)
    foreach ($file in $requests) {
      if ($script:Seen.ContainsKey($file.Name)) { continue }
      $script:Seen[$file.Name] = $true
      try {
        $age = ((Get-Date) - $file.LastWriteTime).TotalSeconds
        if ($age -gt $MaxRequestAgeSeconds) {
          Write-Log ('request stale, dropped age=' + [int]$age)
          Write-Trace @{ ev = 'request_stale' }
          Remove-Item -LiteralPath $file.FullName -Force
          continue
        }

        $req = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop | ConvertFrom-Json
        $id = [string]$req.id
        $text = [string]$req.text

        # Delete first: the plugin never reads this back, and a card that is
        # about to appear must not depend on a file the loop might re-read.
        Remove-Item -LiteralPath $file.FullName -Force

        $decision = Get-CoachDecision $text
        if ($decision.kind -eq 'none') {
          Write-Trace @{ ev = 'silent'; len = $text.Length }
          continue
        }

        if ($script:ActiveCard) {
          Write-Log 'card busy, dropped'
          Write-Trace @{ ev = 'card_dropped'; kind = [string]$decision.kind; len = $text.Length }
          continue
        }

        Show-Card $id $decision
      } catch {
        # One malformed request must not stop the daemon. The file holds prompt
        # text, so remove it rather than retrying it every 40 ms.
        Write-Log ('request failed: ' + $_.Exception.Message)
        try { Remove-Item -LiteralPath $file.FullName -Force } catch { }
      }
    }

    foreach ($name in @($script:Seen.Keys)) {
      if (-not (Test-Path -LiteralPath (Join-Path $Ipc $name))) { $script:Seen.Remove($name) }
    }

    Invoke-Pump 40
  }
} catch {
  Write-Log ('fatal: ' + $_.Exception.Message)
} finally {
  Close-Card
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
  Write-Log 'daemon: stopped'
}
