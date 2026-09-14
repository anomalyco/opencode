param([Parameter(Mandatory = $true)][string]$Fixture)
$ErrorActionPreference = 'Stop'
[Console]::WriteLine('TERMINAL_FIXTURE_READY')
while ($null -ne ($command = [Console]::ReadLine())) {
  if ($command -eq 'exit') { exit 0 }
  if ($command -eq 'run') {
    foreach ($line in [System.IO.File]::ReadLines($Fixture)) {
      [Console]::WriteLine($line)
    }
    [Console]::WriteLine('TERMINAL_WORKLOAD_DONE')
  }
  if ($command -eq 'ping') { [Console]::WriteLine('TERMINAL_PROCESS_ALIVE') }
}
