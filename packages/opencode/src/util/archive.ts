import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // Use .NET ZipFile directly instead of Expand-Archive: when opencode is
    // spawned via Bun on Windows, Microsoft.PowerShell.Archive fails to
    // autoload and emits a noisy CouldNotAutoloadMatchingModule error to
    // stderr. System.IO.Compression.FileSystem ships with .NET 4.6.1+ on
    // every supported Windows host. We extract entry-by-entry because the
    // 3-arg ExtractToDirectory(overwrite) overload is .NET Core only, and
    // wiping destDir would clobber sibling artifacts (callers like the LSP
    // downloader extract into shared bin directories). See #24291, #23457.
    const cmd = [
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${winZipPath}');`,
      `try {`,
      `  foreach ($e in $zip.Entries) {`,
      `    $target = Join-Path '${winDestDir}' $e.FullName;`,
      `    if ($e.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }`,
      `    $parent = Split-Path -Parent $target;`,
      `    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }`,
      `    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)`,
      `  }`,
      `} finally { $zip.Dispose() }`,
    ].join(" ")
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
