import fs from "fs/promises"
import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    // tar.exe (bsdtar) ships with Windows 10 1803+ (Bun needs 1809+) and extracts
    // zip natively. PowerShell's Expand-Archive can't be used: module autoload
    // fails when powershell.exe is spawned from the Bun-compiled binary (#24291).
    const winDestDir = path.resolve(destDir)
    await fs.mkdir(winDestDir, { recursive: true })
    await Process.run(["tar", "-xf", path.resolve(zipPath), "-C", winDestDir])
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
