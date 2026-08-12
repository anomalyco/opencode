import { appendFileSync, mkdirSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { dirname, join } from "node:path"

const prefix = "opencode-drive"
let currentLogFile = process.env.OPENCODE_DRIVE_LOG

export function driveLogFile(artifacts: string) {
  return join(artifacts, "logs", "opencode-drive.log")
}

export async function opencodeLogFile(artifacts: string) {
  const directory = join(artifacts, "logs", "opencode", "log")
  const pattern = join(directory, "opencode*.log")
  try {
    const matches = (await readdir(directory))
      .filter((entry) => /^opencode.*\.log$/.test(entry))
      .sort()
      .map((entry) => join(directory, entry))
    return matches.at(-1) ?? pattern
  } catch {
    return pattern
  }
}

export async function logReadyPaths(artifacts: string, options?: { readonly terminal?: boolean }) {
  logSuccess(`opencode instance logs: ${await opencodeLogFile(artifacts)}`, options)
  logSuccess(`current run script logs: ${driveLogFile(artifacts)}`, options)
}

export function configureLogFile(artifacts: string) {
  currentLogFile = driveLogFile(artifacts)
  process.env.OPENCODE_DRIVE_LOG = currentLogFile
  return currentLogFile
}

export function logSuccess(message: string, options: { readonly terminal?: boolean } = {}) {
  const line = `${prefix}: ${message}`
  if (options.terminal !== false) console.error(process.stderr.isTTY ? `\x1b[32m${line}\x1b[0m` : line)
  append("INFO", message)
}

export function logError(message: string) {
  const line = `error: ${message}`
  console.error(process.stderr.isTTY ? `\x1b[31m${line}\x1b[0m` : line)
  append("ERROR", message)
  appendOwner(message)
}

function appendOwner(message: string) {
  const ownerLog = process.env.OPENCODE_DRIVE_OWNER_LOG
  if (!ownerLog) return
  appendBestEffort(ownerLog, `${message}\n`)
}

export function recordLog(level: "INFO" | "ERROR", message: string) {
  append(level, message)
}

function append(level: "INFO" | "ERROR", message: string) {
  if (!currentLogFile) return
  appendBestEffort(
    currentLogFile,
    `[${new Date().toISOString()}] ${level} ${message}\n`,
  )
}

function appendBestEffort(path: string, contents: string) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, contents)
  } catch {
    // Logging must not change CLI behavior.
  }
}
