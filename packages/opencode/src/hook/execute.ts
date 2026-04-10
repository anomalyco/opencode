import { Hash } from "../util/hash"
import { Log } from "../util/log"
import { Process } from "../util/process"
import type { HookEntry } from "./schema"

const log = Log.create({ service: "hook" })
const DEFAULT_TIMEOUT = 10_000

const MAX_HOOK_INPUT_ENV = 128 * 1024 // 128KB
export function safeToolInput(args: unknown): string {
  const raw = JSON.stringify(args)
  if (raw.length <= MAX_HOOK_INPUT_ENV) return raw
  return raw.slice(0, MAX_HOOK_INPUT_ENV) + "\n[truncated]"
}

export interface HookEnv {
  OPENCODE_HOOK_EVENT: string
  OPENCODE_TOOL_NAME?: string
  OPENCODE_TOOL_INPUT?: string
  OPENCODE_PROJECT_DIR: string
  OPENCODE_SESSION_ID: string
}

export interface HookResult {
  action: "pass" | "block"
  message?: string
  status?: "ok" | "error" | "timeout" | "unexpected_exit"
  duration?: number
  exitCode?: number
}

// ---------------------------------------------------------------------------
// LRU cache for PreToolUse hooks
// ---------------------------------------------------------------------------
const CACHE_MAX = 100
const CACHE_TTL = 5_000 // 5 seconds

interface CacheEntry {
  result: HookResult
  expiresAt: number
}

const preToolUseCache = new Map<string, CacheEntry>()

function cacheKey(command: string, toolName: string | undefined, toolInput: string | undefined): string {
  return Hash.fast(`${command}\0${toolName ?? ""}\0${toolInput ?? ""}`)
}

function getCached(key: string): HookResult | undefined {
  const entry = preToolUseCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    preToolUseCache.delete(key)
    return undefined
  }
  // Move to end for LRU ordering
  preToolUseCache.delete(key)
  preToolUseCache.set(key, entry)
  return entry.result
}

function setCached(key: string, result: HookResult): void {
  // Evict oldest entries when at capacity
  if (preToolUseCache.size >= CACHE_MAX) {
    const oldest = preToolUseCache.keys().next().value
    if (oldest !== undefined) preToolUseCache.delete(oldest)
  }
  preToolUseCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL,
  })
}

/** Exposed for testing only. */
export function clearHookCache(): void {
  preToolUseCache.clear()
}

export async function runHook(entry: HookEntry, env: HookEnv): Promise<HookResult> {
  const isPreToolUse = env.OPENCODE_HOOK_EVENT === "PreToolUse"
  const timeout = entry.timeout ?? DEFAULT_TIMEOUT
  const command = entry.command.replace(/^~/, process.env.HOME ?? "~")

  // Check cache for PreToolUse hooks
  if (isPreToolUse) {
    const key = cacheKey(command, env.OPENCODE_TOOL_NAME, env.OPENCODE_TOOL_INPUT)
    const cached = getCached(key)
    if (cached) return cached
  }

  const start = Date.now()

  try {
    const result = await Process.run(["sh", "-c", command], {
      env: toEnvRecord(env),
      abort: AbortSignal.timeout(timeout),
      nothrow: true,
    })

    const duration = Date.now() - start
    const stderr = result.stderr.toString().trim()

    if (result.code === 0) {
      const hookResult: HookResult = {
        action: "pass",
        message: stderr || undefined,
        status: "ok",
        duration,
        exitCode: 0,
      }
      if (isPreToolUse) {
        setCached(cacheKey(command, env.OPENCODE_TOOL_NAME, env.OPENCODE_TOOL_INPUT), hookResult)
      }
      return hookResult
    }
    if (result.code === 2) {
      // Do NOT cache block results -- security decisions must always be fresh
      return {
        action: "block",
        message: stderr || "Blocked by hook",
        status: "ok",
        duration,
        exitCode: 2,
      }
    }

    log.warn("hook exited with unexpected code", {
      command: entry.command,
      code: result.code,
      stderr,
    })
    return {
      action: "pass",
      status: "unexpected_exit",
      duration,
      exitCode: result.code,
    }
  } catch (error) {
    const duration = Date.now() - start
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")

    log.warn("hook execution failed", {
      command: entry.command,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      action: "pass",
      status: isTimeout ? "timeout" : "error",
      duration,
    }
  }
}

function toEnvRecord(env: HookEnv): Record<string, string> {
  const record: Record<string, string> = {
    OPENCODE_HOOK_EVENT: env.OPENCODE_HOOK_EVENT,
    OPENCODE_PROJECT_DIR: env.OPENCODE_PROJECT_DIR,
    OPENCODE_SESSION_ID: env.OPENCODE_SESSION_ID,
  }
  if (env.OPENCODE_TOOL_NAME !== undefined) record.OPENCODE_TOOL_NAME = env.OPENCODE_TOOL_NAME
  if (env.OPENCODE_TOOL_INPUT !== undefined) record.OPENCODE_TOOL_INPUT = env.OPENCODE_TOOL_INPUT
  return record
}

export function matchesTool(matcher: string | undefined, toolName: string): boolean {
  if (!matcher) return true
  if (matcher === toolName) return true
  if (matcher.endsWith("*")) {
    return toolName.startsWith(matcher.slice(0, -1))
  }
  return false
}

export async function runHooks(
  entries: HookEntry[] | undefined,
  toolName: string,
  env: HookEnv,
): Promise<HookResult> {
  if (!entries || entries.length === 0) return { action: "pass" }

  const matched = entries.filter((entry) => matchesTool(entry.matcher, toolName))
  if (matched.length === 0) return { action: "pass" }

  const results = await Promise.all(matched.map((entry) => runHook(entry, env)))

  // Collect messages in original order, stopping after the first "block".
  // This preserves sequential message semantics while hooks execute in parallel.
  const messages: string[] = []
  let blocked = false

  for (const result of results) {
    if (result.message) messages.push(result.message)
    if (result.action === "block") {
      blocked = true
      break
    }
  }

  if (blocked) {
    return { action: "block", message: messages.join("\n") }
  }

  return {
    action: "pass",
    message: messages.length > 0 ? messages.join("\n") : undefined,
  }
}
