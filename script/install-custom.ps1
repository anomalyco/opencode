[CmdletBinding()]
param(
  [switch]$Windows,
  [switch]$Docker,
  [string]$Container = "casio-agent-1"
)

$ErrorActionPreference = "Stop"

if (-not $Windows -and -not $Docker) {
  throw "Select at least one destination with -Windows or -Docker."
}

$root = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $root "plugins/temp-policy"
$pluginFiles = @("index.ts", "server.ts", "package.json")

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

Push-Location $root
try {
  if ($Windows) {
    Invoke-Checked -Description "Windows build" -Command {
      $env:OPENCODE_TARGET="windows-x64"; bun run packages/cli/script/build.ts --outdir=dist/custom-windows
    }

    $source = Join-Path $root "packages/cli/dist/custom-windows/cli-windows-x64/bin/opencode.exe"
    $directory = Join-Path $HOME ".local/bin"
    $destination = Join-Path $directory "opencode2.exe"
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Copy-Item -Force $source $destination
    $pluginDestination = Join-Path $HOME ".config/opencode/plugins/temp-policy"
    New-Item -ItemType Directory -Force -Path $pluginDestination | Out-Null
    foreach ($file in $pluginFiles) {
      Copy-Item -Force (Join-Path $pluginSource $file) (Join-Path $pluginDestination $file)
    }
    Invoke-Checked -Description "Windows installation verification" -Command { & $destination --version }
  }

  if ($Docker) {
    Invoke-Checked -Description "Docker container check" -Command { docker inspect $Container | Out-Null }
    Invoke-Checked -Description "Linux build" -Command {
      $env:OPENCODE_TARGET="linux-x64"; bun run packages/cli/script/build.ts --outdir=dist/custom-linux
    }

    $source = Join-Path $root "packages/cli/dist/custom-linux/cli-linux-x64/bin/opencode"
    Invoke-Checked -Description "Docker copy" -Command {
      docker cp $source "${Container}:/usr/local/bin/opencode2"
    }
    Invoke-Checked -Description "Docker executable permission" -Command {
      docker exec -u 0 $Container chmod 755 /usr/local/bin/opencode2
    }
    Invoke-Checked -Description "Docker command link" -Command {
      docker exec -u 0 $Container sh -lc "mkdir -p /home/ubuntu/.opencode/bin && ln -sf /usr/local/bin/opencode2 /home/ubuntu/.opencode/bin/opencode2 && chown -h ubuntu:ubuntu /home/ubuntu/.opencode/bin/opencode2"
    }
    Invoke-Checked -Description "Docker plugin directory" -Command {
      docker exec -u 0 $Container mkdir -p /home/ubuntu/.config/opencode/plugins/temp-policy
    }
    foreach ($file in $pluginFiles) {
      Invoke-Checked -Description "Docker plugin copy ($file)" -Command {
        docker cp (Join-Path $pluginSource $file) "${Container}:/home/ubuntu/.config/opencode/plugins/temp-policy/$file"
      }
    }
    Invoke-Checked -Description "Docker plugin ownership" -Command {
      docker exec -u 0 $Container chown -R ubuntu:ubuntu /home/ubuntu/.config/opencode/plugins/temp-policy
    }
    Invoke-Checked -Description "Docker installation verification" -Command {
      docker exec $Container /usr/local/bin/opencode2 --version
    }
  }
}
finally {
  Pop-Location
}
