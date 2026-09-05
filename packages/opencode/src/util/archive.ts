import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:OPENCODE_ARCHIVE_PATH -DestinationPath $env:OPENCODE_ARCHIVE_DESTINATION -Force`
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], {
      env: {
        OPENCODE_ARCHIVE_PATH: path.resolve(zipPath),
        OPENCODE_ARCHIVE_DESTINATION: path.resolve(destDir),
      },
    })
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
