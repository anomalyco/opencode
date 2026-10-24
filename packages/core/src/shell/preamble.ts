export * as ShellPreamble from "./preamble.js"

/**
 * Lightweight PowerShell preamble to prevent context bloat when agents run directory listing commands
 * (`ls`, `dir`, `gci`, `Get-ChildItem`).
 *
 * Features:
 *   - Supports FileSystem dynamic parameters (-File, -Directory, -Hidden, -Attributes, -FollowSymlink) via dynamicparam.
 *   - Prunes heavy dependency/cache directories ('node_modules', 'target', '.git', '.venv', '__pycache__').
 *     Note: 'dist' and 'build' are preserved because they are often legitimate project targets.
 *   - Drops nested contents during -Recurse.
 *   - Alerts the model via host notice without corrupting object pipelines.
 *   - Overrideable via -All / -NoPrune or OPENCODE_NO_PRUNE=1.
 */
export const POWERSHELL_PREAMBLE = `if (-not (Get-Command Get-ChildItem -CommandType Function -ErrorAction SilentlyContinue)) {
  function Get-ChildItem {
    [CmdletBinding(DefaultParameterSetName='Items', SupportsTransactions=$true)]
    param(
      [Parameter(ParameterSetName='Items', Position=0, ValueFromPipeline=$true, ValueFromPipelineByPropertyName=$true)]
      [string[]]$Path,
      [Parameter(ParameterSetName='LiteralItems', Mandatory=$true, ValueFromPipelineByPropertyName=$true)]
      [Alias('PSPath')][string[]]$LiteralPath,
      [Parameter(Position=1)][string]$Filter,
      [string[]]$Include,
      [string[]]$Exclude,
      [Alias('s')][switch]$Recurse,
      [uint32]$Depth,
      [switch]$Force,
      [switch]$Name,
      [Alias('NoFilter','NoPrune')][switch]$All
    )
    dynamicparam {
      try {
        $p = [System.Collections.Generic.Dictionary[string,object]]::new($PSBoundParameters)
        $p.Remove('All') | Out-Null; $p.Remove('NoFilter') | Out-Null; $p.Remove('NoPrune') | Out-Null
        $cmd = $ExecutionContext.InvokeCommand.GetCommand('Microsoft.PowerShell.Management\\Get-ChildItem', [System.Management.Automation.CommandTypes]::Cmdlet, $p)
        if ($cmd) {
          $dict = [Management.Automation.RuntimeDefinedParameterDictionary]::new()
          foreach ($dyn in @($cmd.Parameters.Values | Where-Object { $_.IsDynamic })) {
            if (-not $MyInvocation.MyCommand.Parameters.ContainsKey($dyn.Name)) {
              $dict.Add($dyn.Name, [Management.Automation.RuntimeDefinedParameter]::new($dyn.Name, $dyn.ParameterType, $dyn.Attributes))
            }
          }
          return $dict
        }
      } catch { }
    }
    process {
      $clean = [System.Collections.Generic.Dictionary[string,object]]::new($PSBoundParameters)
      $clean.Remove('All') | Out-Null; $clean.Remove('NoFilter') | Out-Null; $clean.Remove('NoPrune') | Out-Null
      if ($All.IsPresent -or ($env:OPENCODE_NO_PRUNE -eq '1') -or ($env:OPENCODE_NO_SHELL_PRUNE -eq '1')) {
        Microsoft.PowerShell.Management\\Get-ChildItem @clean
        return
      }
      $prunePattern = '(?i)[\\\\/](node_modules|target|\\.git|\\.venv|__pycache__)([\\\\/]|$)'
      $items = Microsoft.PowerShell.Management\\Get-ChildItem @clean
      $pruned = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
      foreach ($item in $items) {
        $isPruned = $false
        if ($item -is [System.IO.FileSystemInfo]) {
          if ($item.FullName -match $prunePattern) {
            $isPruned = $true
            [void]$pruned.Add($item.Name)
          }
        } else {
          if ("$item" -match '(?i)^(node_modules|target|\\.git|\\.venv|__pycache__)$') {
            $isPruned = $true
            [void]$pruned.Add("$item")
          }
        }
        if (-not $isPruned) {
          $item
        }
      }
      if ($pruned.Count -gt 0) {
        $names = ($pruned | Sort-Object) -join ', '
        Write-Host "[OpenCode: Pruned $($pruned.Count) item(s) ($names). Use -All to include]" -ForegroundColor DarkYellow
      }
    }
  }
};`

/**
 * Lightweight POSIX shell function for `ls` to prevent context bloat.
 * Prunes heavy dependency/cache trees ('node_modules', 'target', '.git', '.venv', '__pycache__').
 * Emits notice to stderr so stdout pipelines (e.g. `ls | wc -l`) are never corrupted.
 */
export const POSIX_PREAMBLE = `ls() {
  if [ "$OPENCODE_NO_PRUNE" = "1" ] || [ "$OPENCODE_NO_SHELL_PRUNE" = "1" ]; then
    command ls "$@"
    return
  fi
  _pruned=""
  for _d in node_modules target .git .venv __pycache__; do
    if [ -e "$_d" ]; then
      _pruned="$_pruned $_d"
    fi
  done
  if [ -n "$_pruned" ]; then
    printf '[OpenCode: Pruned heavy directories:%s. Use "\\\\ls" to view all]\\n' "$_pruned" >&2
  fi
  if command ls --version >/dev/null 2>&1; then
    command ls --ignore=node_modules --ignore=target --ignore=.git --ignore=.venv --ignore=__pycache__ "$@"
  else
    command ls "$@"
  fi
};`

/**
 * Wraps an agent shell command with the directory pruning preamble based on the shell flavor.
 */
export function wrap(file: string, command: string, isPowerShell: boolean): string {
  if (isPowerShell) {
    return `${POWERSHELL_PREAMBLE}\n${command}`
  }
  return `${POSIX_PREAMBLE}\n${command}`
}
