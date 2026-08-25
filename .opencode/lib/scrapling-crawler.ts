// Reusable Scrapling crawler client: spawns the local Python crawler_cli.py,
// validates its output contract (pure UTF-8 JSON on stdout, logs on stderr),
// and returns the parsed CrawlResult. All crawling/extraction logic lives in
// the Python project; this module only launches it and enforces the protocol.

import { existsSync } from "fs"

export type CrawlerMode = "http" | "stealth" | "browser"

const DEFAULT_VENV = "C:/projects/crawler/.venv"
const DEFAULT_SCRIPT = "C:/projects/crawler/crawler_cli.py"
export const DEFAULT_TIMEOUT_MS = 60_000
const STDERR_TAIL_CHARS = 2000

export interface ScraplingCrawlOptions {
  url: string
  mode?: CrawlerMode
  timeoutMs?: number
}

/** Parsed shape of the Python CrawlResult (models.py section 13). */
export interface ScraplingCrawlResult {
  success: boolean
  request?: { url?: string; fetch_mode?: string | null }
  response?: { status_code?: number | null; final_url?: string | null; content_type?: string | null; response_time_ms?: number | null }
  page?: { title?: string | null; description?: string | null; language?: string | null; canonical_url?: string | null } | null
  content?: { text?: string; headings?: Array<{ level: number; text: string }>; paragraphs?: string[] } | null
  links?: Array<{ text: string; url: string; rel?: string[]; external?: boolean | null }>
  images?: Array<{ src: string; alt?: string | null; title?: string | null }>
  metadata?: Record<string, unknown>
  error?: { type: string; message: string } | null
}

export type CrawlerFailureKind =
  | "invalid-url"
  | "config"
  | "spawn"
  | "timeout"
  | "encoding"
  | "protocol"
  | "failure"

export class CrawlerError extends Error {
  constructor(
    readonly kind: CrawlerFailureKind,
    message: string,
  ) {
    super(message)
    this.name = "CrawlerError"
  }
}

function resolvePythonExecutable(): string {
  const override = process.env.SCRAPLING_PYTHON || process.env.PYTHON_PATH
  if (override) return override
  return process.platform === "win32"
    ? `${DEFAULT_VENV}/Scripts/python.exe`
    : `${DEFAULT_VENV}/bin/python`
}

function resolveCrawlerScript(): string {
  return process.env.CRAWLER_PATH || DEFAULT_SCRIPT
}

export function isValidCrawlUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function debug(msg: string) {
  console.error(`[crawler] ${msg}`)
}

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim()
  return trimmed.length > STDERR_TAIL_CHARS
    ? `...${trimmed.slice(-STDERR_TAIL_CHARS)}`
    : trimmed
}

/**
 * Crawl one URL through the Python Scrapling crawler. Process-isolated:
 * the crawler runs in its own interpreter, never inside the caller.
 * Throws CrawlerError with a typed `kind` on any failure.
 */
export async function crawlWithScrapling(options: ScraplingCrawlOptions): Promise<ScraplingCrawlResult> {
  const { url, mode = "stealth", timeoutMs = DEFAULT_TIMEOUT_MS } = options

  if (!isValidCrawlUrl(url)) {
    throw new CrawlerError("invalid-url", `Invalid URL: ${url}. Only http:// and https:// URLs are supported.`)
  }

  const python = resolvePythonExecutable()
  const script = resolveCrawlerScript()

  for (const [label, path] of [
    ["Python executable", python],
    ["Crawler script", script],
  ] as const) {
    if (!existsSync(path)) {
      throw new CrawlerError(
        "config",
        `Scrapling integration misconfigured: ${label} not found at ${path}. ` +
          `Set SCRAPLING_PYTHON to the venv python and/or CRAWLER_PATH to crawler_cli.py.`,
      )
    }
  }

  debug(`Spawning: ${python} ${script} "${url}" --mode ${mode}`)

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    proc = Bun.spawn([python, script, url, "--mode", mode], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (err) {
    throw new CrawlerError(
      "spawn",
      `Failed to spawn Python crawler (${python}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const timer = setTimeout(() => {
    debug(`Timeout after ${timeoutMs}ms — killing pid ${proc.pid}`)
    proc.kill()
  }, timeoutMs)

  let stdoutBuf: ArrayBuffer
  let stderr: string
  let exitCode: number
  try {
    ;[stdoutBuf, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
  } finally {
    clearTimeout(timer)
  }

  debug(`Exited with code ${exitCode}, stdout ${stdoutBuf.byteLength} bytes`)

  // Strict UTF-8 decode of stdout only; stderr is diagnostics and is never
  // mixed into the JSON payload.
  let stdout: string
  try {
    stdout = new TextDecoder("utf-8", { fatal: true }).decode(stdoutBuf)
  } catch (err) {
    throw new CrawlerError(
      "encoding",
      `Crawler stdout was not valid UTF-8: ${err instanceof Error ? err.message : String(err)}. ` +
        `Exit code ${exitCode}. stderr tail:\n${stderrTail(stderr)}`,
    )
  }

  if (!stdout.trim()) {
    throw new CrawlerError(
      "protocol",
      `Crawler produced empty stdout (exit code ${exitCode}). stderr tail:\n${stderrTail(stderr)}`,
    )
  }

  let result: ScraplingCrawlResult
  try {
    result = JSON.parse(stdout)
  } catch (err) {
    throw new CrawlerError(
      "protocol",
      `Crawler stdout was not valid JSON (exit code ${exitCode}): ${
        err instanceof Error ? err.message : String(err)
      }. First 300 chars: ${stdout.slice(0, 300)}. stderr tail:\n${stderrTail(stderr)}`,
    )
  }

  if (result.success === false) {
    const errorInfo = result.error
    throw new CrawlerError(
      "failure",
      `Crawler reported failure (exit code ${exitCode}): ` +
        `${errorInfo?.type ?? "Unknown"}: ${errorInfo?.message ?? "no details"}. ` +
        `stderr tail:\n${stderrTail(stderr)}`,
    )
  }

  if (exitCode !== 0) {
    // success=true but non-zero exit is unexpected; keep the result but log it.
    debug(`Warning: success=true despite exit code ${exitCode}`)
  }

  return result
}
