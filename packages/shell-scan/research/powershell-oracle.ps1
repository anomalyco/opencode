$ErrorActionPreference = "Stop"

$sources = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = foreach ($source in $sources) {
  $tokens = $null
  $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref] $tokens, [ref] $errors)
  $commands = $ast.FindAll(
    { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
    $true
  ) | ForEach-Object {
    [pscustomobject]@{
      name = $_.GetCommandName()
      text = $_.Extent.Text
      start = $_.Extent.StartOffset
      end = $_.Extent.EndOffset
    }
  }
  [pscustomobject]@{
    source = $source
    commands = @($commands)
    errors = @($errors | ForEach-Object { $_.Message })
  }
}

[pscustomobject]@{
  version = $PSVersionTable.PSVersion.ToString()
  results = @($results)
} | ConvertTo-Json -Depth 6 -Compress
