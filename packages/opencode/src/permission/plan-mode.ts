import { Log } from "@/util/log"

const log = Log.create({ service: "plan-mode" })

const DESTRUCTIVE_COMMANDS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "sed",
  "awk",
  "tee",
  "truncate",
  "dd",
  "shred",
  "wipe",
  "install",
])

const DESTRUCTIVE_PATTERNS = [
  /^git\s+(commit|push|reset|rebase|merge|cherry-pick|am|stash\s+pop|stash\s+apply)/i,
  /^npm\s+(install|i|uninstall|remove|ci|publish)/i,
  /^yarn\s+(add|remove|upgrade|publish)/i,
  /^pnpm\s+(add|remove|install|publish)/i,
  /^pip\s+(install|uninstall)/i,
  /^cargo\s+(install|publish)/i,
  /^go\s+(install|get|mod\s+(tidy|download))/i,
  /^brew\s+(install|uninstall|upgrade)/i,
  /^apt\s*(install|remove|purge|upgrade)/i,
  /^apt-get\s*(install|remove|purge|upgrade)/i,
  /^docker\s+(run|build|push|rmi|rm|stop|kill|exec)/i,
  /^kubectl\s+(apply|delete|create|patch|exec)/i,
  /^helm\s+(install|upgrade|uninstall|delete)/i,
]

const READONLY_COMMANDS = new Set([
  "ls",
  "dir",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "egrep",
  "fgrep",
  "find",
  "locate",
  "which",
  "whereis",
  "type",
  "whoami",
  "id",
  "pwd",
  "echo",
  "printf",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "stat",
  "file",
  "du",
  "df",
  "free",
  "uptime",
  "date",
  "cal",
  "env",
  "printenv",
  "uname",
  "hostname",
  "arch",
  "nc",
  "curl",
  "wget",
])

const READONLY_GIT_PATTERNS = [
  /^git\s+(status|diff|log|show|branch|tag|remote|stash\s+list|blame|shortlog|rev-parse|ls-files|ls-tree|describe)/i,
]

export interface PlanModeValidationResult {
  allowed: boolean
  reason?: string
  command?: string
}

export function isPlanMode(agent: string): boolean {
  return agent === "plan"
}

export function validateCommandForPlanMode(command: string, agent: string): PlanModeValidationResult {
  if (!isPlanMode(agent)) {
    return { allowed: true }
  }

  const trimmed = command.trim()
  if (!trimmed) {
    return { allowed: true }
  }

  const firstToken = extractFirstToken(trimmed)
  if (!firstToken) {
    return { allowed: true }
  }

  if (DESTRUCTIVE_COMMANDS.has(firstToken)) {
    log.info("plan mode: blocking destructive command", { command: firstToken })
    return {
      allowed: false,
      reason: `Command '${firstToken}' is not allowed in plan mode. Plan mode is read-only. Switch to 'build' mode to make changes.`,
      command: firstToken,
    }
  }

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const matched = pattern.source.match(/\w+\s+\w+/)?.[0] || firstToken
      log.info("plan mode: blocking destructive pattern", { pattern: pattern.source })
      return {
        allowed: false,
        reason: `Command '${matched}' is not allowed in plan mode. Plan mode is read-only. Switch to 'build' mode to make changes.`,
        command: matched,
      }
    }
  }

  const dangerousChars = detectDangerousChars(trimmed)
  if (dangerousChars) {
    log.info("plan mode: blocking dangerous characters", { chars: dangerousChars })
    return {
      allowed: false,
      reason: `Potentially unsafe command detected (${dangerousChars}). Plan mode restricts commands that could modify files. Switch to 'build' mode to execute this command.`,
      command: dangerousChars,
    }
  }

  if (READONLY_COMMANDS.has(firstToken)) {
    return { allowed: true }
  }

  for (const pattern of READONLY_GIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: true }
    }
  }

  return { allowed: true }
}

function extractFirstToken(command: string): string {
  let i = 0
  while (i < command.length && /\s/.test(command[i])) {
    i++
  }

  let token = ""
  let inQuote = false
  let quoteChar = ""

  while (i < command.length) {
    const char = command[i]

    if (inQuote) {
      if (char === quoteChar && command[i - 1] !== "\\") {
        inQuote = false
      } else {
        token += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = true
      quoteChar = char
    } else if (/\s/.test(char)) {
      break
    } else if (char === "|" || char === "&" || char === ";" || char === "<" || char === ">") {
      break
    } else {
      token += char
    }
    i++
  }

  const parts = token.split(/\s+/)
  return parts[0]?.toLowerCase() || ""
}

function detectDangerousChars(command: string): string | null {
  let inSingleQuote = false
  let inDoubleQuote = false
  let isEscaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (char === "\\" && !inSingleQuote) {
      isEscaped = true
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    const inAnyQuote = inSingleQuote || inDoubleQuote

    if (!inAnyQuote) {
      if (/[\n\r\u2028\u2029\u0085]/.test(char)) {
        return "newline injection"
      }
    }

    if (char === "`" && !inSingleQuote) {
      return "command substitution (backtick)"
    }

    if (!inAnyQuote && char === ">" && i > 0 && command[i - 1] !== ">") {
      if (i === 0 || command[i - 1] !== "2") {
        return "file redirect"
      }
    }
  }

  return null
}

export const PlanMode = {
  isPlanMode,
  validateCommandForPlanMode,
  DESTRUCTIVE_COMMANDS,
  READONLY_COMMANDS,
}
