import path from "path"
import { Process } from "./process"

/**
 * Archive extraction namespace.
 *
 * Provides cross-platform ZIP archive extraction using PowerShell on Windows
 * and unzip command on Unix-like systems.
 *
 * @example
 * ```typescript
 * await Archive.extractZip("/path/to/file.zip", "/destination/dir")
 * ```
 */
export namespace Archive {
  /**
   * Extracts a ZIP archive to the specified directory.
   *
   * Uses PowerShell on Windows and unzip command on macOS/Linux.
   *
   * @param zipPath - Path to the ZIP file
   * @param destDir - Destination directory for extraction
   */
  export async function extractZip(zipPath: string, destDir: string) {
    if (process.platform === "win32") {
      const winZipPath = path.resolve(zipPath)
      const winDestDir = path.resolve(destDir)
      // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
      await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
      return
    }

    await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
  }
}
