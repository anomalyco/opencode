$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$utf8 = New-Object System.Text.UTF8Encoding($false)

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $runspace = $null
  $pipeline = $null
  $previousDirectory = [Environment]::CurrentDirectory
  $previousEnvironment = [Environment]::GetEnvironmentVariables()
  $code = 0

  try {
    $request = $utf8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $requestedEnvironment = @{}
    foreach ($entry in $request.env.PSObject.Properties) {
      if ($null -ne $entry.Value) { $requestedEnvironment[$entry.Name] = [string]$entry.Value }
    }
    foreach ($key in @([Environment]::GetEnvironmentVariables().Keys)) {
      if (-not $requestedEnvironment.ContainsKey($key)) {
        [Environment]::SetEnvironmentVariable($key, $null)
      }
    }
    foreach ($key in $requestedEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $requestedEnvironment[$key])
    }
    [Environment]::CurrentDirectory = $request.cwd

    $runspace = [RunspaceFactory]::CreateRunspace([System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault2())
    $runspace.Open()
    $null = $runspace.SessionStateProxy.Path.SetLocation($request.cwd)
    $pipeline = [PowerShell]::Create()
    $pipeline.Runspace = $runspace
    $command = [string]$request.command
    $tokens = $null
    $parseErrors = $null
    $syntax = [System.Management.Automation.Language.Parser]::ParseInput($command, [ref]$tokens, [ref]$parseErrors)
    $exits = @($syntax.FindAll({ param($node) $node -is [System.Management.Automation.Language.ExitStatementAst] }, $true))
    [Array]::Reverse($exits)
    foreach ($statement in $exits) {
      $value = if ($null -eq $statement.Pipeline) { '0' } else { $statement.Pipeline.Extent.Text }
      $replacement = '$global:__opencode_worker_exit = [int](' + $value + '); throw [System.OperationCanceledException]::new("__opencode_worker_exit__")'
      $command = $command.Substring(0, $statement.Extent.StartOffset) + $replacement + $command.Substring($statement.Extent.EndOffset)
    }
    $wrapped = @(
      '& {'
      '  try {'
      '    & {'
      $command
      '      $global:__opencode_worker_success = $?'
      '    }'
      '  } catch [System.OperationCanceledException] {'
      '    if ($_.Exception.Message -ne "__opencode_worker_exit__") { throw }'
      '  }'
      '} 2>&1 3>&1 4>&1 5>&1 6>&1 | Out-String -Stream | ForEach-Object {'
      '  [Console]::Out.Write([char]30)'
      '  $data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_ + [Environment]::NewLine))'
      '  [Console]::Out.WriteLine(''{"type":"output","data":"'' + $data + ''"}'')'
      '  [Console]::Out.Flush()'
      '}'
    ) -join [Environment]::NewLine
    $null = $pipeline.AddScript($wrapped)
    $null = $pipeline.Invoke()
    $requestedExit = $runspace.SessionStateProxy.GetVariable('__opencode_worker_exit')
    $success = $runspace.SessionStateProxy.GetVariable('__opencode_worker_success')
    if ($null -ne $requestedExit) { $code = [int]$requestedExit }
    elseif ($null -ne $success -and -not $success) { $code = 1 }
    elseif ($null -eq $success -and $pipeline.HadErrors) { $code = 1 }
  } catch {
    $exception = $_.Exception
    while ($null -ne $exception.InnerException -and -not ($exception -is [System.Management.Automation.ExitException])) {
      $exception = $exception.InnerException
    }
    if ($exception -is [System.Management.Automation.ExitException]) {
      $code = [int]$exception.Argument
    } else {
      $code = 1
      $data = [Convert]::ToBase64String($utf8.GetBytes($_.ToString() + [Environment]::NewLine))
      [Console]::Out.Write([char]30)
      [Console]::Out.WriteLine('{"type":"output","data":"' + $data + '"}')
    }
  } finally {
    if ($null -ne $pipeline) { $pipeline.Dispose() }
    if ($null -ne $runspace) { $runspace.Dispose() }
    foreach ($key in @([Environment]::GetEnvironmentVariables().Keys)) {
      if (-not $previousEnvironment.Contains($key)) {
        [Environment]::SetEnvironmentVariable($key, $null)
      }
    }
    foreach ($key in $previousEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($key, [string]$previousEnvironment[$key])
    }
    [Environment]::CurrentDirectory = $previousDirectory
    [Console]::Out.Write([char]30)
    [Console]::Out.WriteLine('{"type":"exit","code":' + $code + '}')
    [Console]::Out.Flush()
  }
}
