import * as path from "path"
import { Instance } from "../project/instance"
import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"

/** Resolve a tool parameter path to an absolute path against the project directory */
export function resolveToolPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(Instance.directory, p)
}

const MAX_DIAGNOSTICS_PER_FILE = 20

/** Fetch LSP diagnostics and return formatted output string */
export async function formatLspDiagnostics(
  filePath: string,
  opts?: { includeOtherFiles?: boolean; maxOtherFiles?: number },
): Promise<{ diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>>; output: string }> {
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()
  const normalizedFilePath = Filesystem.normalizePath(filePath)
  let output = ""
  let otherCount = 0

  for (const [file, issues] of Object.entries(diagnostics)) {
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length === 0) continue

    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

    if (file === normalizedFilePath) {
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    } else if (opts?.includeOtherFiles && otherCount < (opts.maxOtherFiles ?? 5)) {
      otherCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }
  }

  return { diagnostics, output }
}

/** Write a file to disk and publish edit/watcher events */
export async function writeFileAndNotify(opts: {
  filePath: string
  content: string
  existed: boolean
  sessionID: string
}): Promise<void> {
  await Filesystem.write(opts.filePath, opts.content)
  await Bus.publish(File.Event.Edited, { file: opts.filePath })
  await Bus.publish(FileWatcher.Event.Updated, {
    file: opts.filePath,
    event: opts.existed ? "change" : "add",
  })
  await FileTime.read(opts.sessionID, opts.filePath)
}
