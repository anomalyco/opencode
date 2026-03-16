import path from "path"
import { Process } from "./process"

/**
 * Provides cross-platform archive extraction utilities.
 *
 * This namespace offers functions to extract ZIP files on both Windows
 * and Unix-like systems. Automatically selects the appropriate extraction
 * method based on the operating system.
 *
 * @example
 * ```typescript
 * // Extract a ZIP file to a destination directory
 * await Archive.extractZip("/path/to/archive.zip", "/path/to/dest")
 * ```
 */
export namespace Archive {
  /**
   * Extracts a ZIP file to the specified directory.
   *
   * Uses PowerShell on Windows (with progress bar suppressed) and
   * the unzip command on Unix-like systems (macOS, Linux).
   * The destination directory will be created if it doesn't exist.
   *
   * @param zipPath - Path to the ZIP file to extract
   * @param destDir - Directory where files should be extracted
   * @returns A promise that resolves when extraction is complete
   * @throws {Error} If the extraction command fails
   * @example
   * ```typescript
   * await Archive.extractZip("./download.zip", "./extracted")
   * ```
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
