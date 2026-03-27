import path from "path"
import { abortAfterAny } from "./abort"
import { Process } from "./process"

const MARKITDOWN_TIMEOUT_MS = 30_000
const OFFICE_EXTENSIONS = new Set([".docx", ".pptx"])

type ConvertOptions = {
  abort?: AbortSignal
  timeoutMs?: number
}

type ParsedCommand = {
  argv: string[]
  fromEnv: boolean
}

export function isOfficeDocumentPath(filepath: string) {
  return OFFICE_EXTENSIONS.has(path.extname(filepath).toLowerCase())
}

export async function convertOfficeToMarkdown(filepath: string, options: ConvertOptions = {}) {
  const commands = resolveCommands()
  let fallbackMissing = false

  for (const command of commands) {
    try {
      return await runCommand(command.argv, filepath, options)
    } catch (error) {
      if (command.fromEnv) throw error
      if (isCommandMissing(error)) {
        fallbackMissing = true
        continue
      }
      throw error
    }
  }

  if (fallbackMissing) {
    throw new Error(
      "Unable to run MarkItDown. Install the 'markitdown' CLI (with required extras) or set OPENCODE_MARKITDOWN_CMD.",
    )
  }

  throw new Error("Unable to run MarkItDown.")
}

function resolveCommands(): ParsedCommand[] {
  const configured = process.env.OPENCODE_MARKITDOWN_CMD?.trim()
  if (configured) {
    const argv = splitCommand(configured)
    if (argv.length === 0) {
      throw new Error("OPENCODE_MARKITDOWN_CMD is set but empty")
    }
    return [{ argv, fromEnv: true }]
  }

  return [
    { argv: ["markitdown"], fromEnv: false },
    { argv: ["python3", "-m", "markitdown"], fromEnv: false },
  ]
}

function splitCommand(command: string) {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote) {
      if (ch === quote) {
        quote = undefined
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if (quote) {
    throw new Error("OPENCODE_MARKITDOWN_CMD has an unmatched quote")
  }

  if (current) parts.push(current)
  return parts
}

async function runCommand(argv: string[], filepath: string, options: ConvertOptions) {
  const timeout = options.timeoutMs ?? MARKITDOWN_TIMEOUT_MS
  const { signal, clearTimeout } = options.abort ? abortAfterAny(timeout, options.abort) : abortAfterAny(timeout)
  try {
    const result = await Process.text([...argv, filepath], {
      abort: signal,
    })
    return result.text
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`MarkItDown timed out after ${timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout()
  }
}

function isCommandMissing(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && (error as any).code === "ENOENT") {
    return true
  }

  if (error instanceof Process.RunFailedError) {
    const stderr = error.stderr.toString("utf-8")
    if (error.code === 127) return true
    return /not found|ENOENT|command not found/i.test(stderr)
  }

  if (error instanceof Error) {
    return /not found|ENOENT|spawn|command not found/i.test(error.message)
  }

  return false
}
