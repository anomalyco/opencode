import { MainLogger } from "electron-log"
import log from "electron-log/main.js"
import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000
export const REDACTED = "[REDACTED]"

const SENSITIVE_BROWSER_NAME = /(?:^|[^a-z0-9])(pass(?:word|code)?|secret|token|authorization|cookie|session(?:id)?|api(?:-|_)?key|bearer|credential|auth)(?:[^a-z0-9]|$)/i
const SENSITIVE_BROWSER_NAME_GLOBAL = /\b(pass(?:word|code)?|secret|token|authorization|cookie|session(?:id)?|api(?:-|_)?key|bearer|credential|auth)\b/gi
const TOKEN_LIKE_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?\b/
const TOKEN_LIKE_VALUE_GLOBAL = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?\b/g
const SECRET_PREFIX_VALUE = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|xox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/

let logger: MainLogger
export const getLogger = () => logger

export function isSensitiveBrowserName(value: string) {
  return SENSITIVE_BROWSER_NAME.test(value)
}

export function redactSensitiveBrowserNames(value: string) {
  return value.replace(SENSITIVE_BROWSER_NAME_GLOBAL, REDACTED)
}

function isHighEntropyBrowserValue(value: string) {
  if (value.length < 24 || /\s/.test(value)) return false
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[-_=+/]/].filter((pattern) => pattern.test(value)).length
  return classes >= 3 || (classes >= 2 && value.length >= 32)
}

export function isSensitiveBrowserValue(value: string) {
  const normalized = String(value).trim()
  if (!normalized) return false
  return TOKEN_LIKE_VALUE.test(normalized) || SECRET_PREFIX_VALUE.test(normalized) || isHighEntropyBrowserValue(normalized)
}

export function redactSensitiveBrowserText(value: string) {
  return String(value)
    .replace(/\b(authorization)\s*:\s*(?:bearer|basic)\s+[^\s]+/gi, `$1: ${REDACTED}`)
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\s;]+(?:;\s*[^\s;]+)*/gi, `$1: ${REDACTED}`)
    .replace(
      /\b([a-z0-9._-]*?(?:pass(?:word|code)?|secret|token|authorization|cookie|session(?:id)?|api(?:-|_)?key|bearer|credential|auth)[a-z0-9._-]*)\b\s*([=:])\s*[^\s;&#]+/gi,
      (_match, name: string, separator: string) => `${name}${separator}${separator === ":" ? " " : ""}${REDACTED}`,
    )
    .replace(TOKEN_LIKE_VALUE_GLOBAL, REDACTED)
}

export function redactSensitiveBrowserUrl(value: string) {
  if (!URL.canParse(value)) return redactSensitiveBrowserText(value)
  const url = new URL(value)

  if (url.username) url.username = REDACTED
  if (url.password) url.password = REDACTED

  for (const name of [...url.searchParams.keys()]) {
    if (!isSensitiveBrowserName(name)) continue
    url.searchParams.set(name, REDACTED)
  }

  if (url.hash.startsWith("#") && url.hash.includes("=")) {
    const hashParams = new URLSearchParams(url.hash.slice(1))
    for (const name of [...hashParams.keys()]) {
      if (!isSensitiveBrowserName(name)) continue
      hashParams.set(name, REDACTED)
    }
    const hash = hashParams.toString()
    url.hash = hash ? `#${hash}` : ""
  }

  return url.toString()
}

export function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024
  initConsoleTransport()
  cleanup()
  return (logger = log)
}

export function tail(): string {
  try {
    const path = log.transports.file.getFile().path
    const contents = readFileSync(path, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

function cleanup() {
  const path = log.transports.file.getFile().path
  const dir = dirname(path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    try {
      const info = statSync(file)
      if (!info.isFile()) continue
      if (info.mtimeMs < cutoff) unlinkSync(file)
    } catch {
      continue
    }
  }
}

function initConsoleTransport() {
  const write = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      write(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EPIPE"
}
