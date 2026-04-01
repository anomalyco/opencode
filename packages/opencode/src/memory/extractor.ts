import type { MemoryType } from "./types"
import { MemoryStore } from "./store"
import { Log } from "../util/log"

const log = Log.create({ service: "memory.extractor" })

const CONFIG_FILES = new Set([
  "package.json",
  "tsconfig.json",
  ".env",
  ".env.local",
  ".eslintrc",
  ".prettierrc",
  "vitest.config.ts",
  "vite.config.ts",
  "webpack.config.js",
  "next.config.js",
  "tailwind.config.js",
  "drizzle.config.ts",
])

const PREFERENCE_PATTERNS = [
  /\bno\b.*\buse\b/i,
  /\bdon'?t\b/i,
  /\binstead\b/i,
  /\bprefer\b/i,
  /\bnot.*that\b/i,
  /\bi want\b.*\binstead\b/i,
  /\buse.*rather than\b/i,
]

interface ExtractorState {
  bashCommandCount: Map<string, number>
  lastBashError?: { command: string; error: string }
  lastToolCalls: Array<{ tool: string; input: Record<string, unknown> }>
  currentTurnEdits: Set<string>
  projectPath: string
  sessionId?: string
  detectedTopics: Set<string>
}

export namespace MemoryExtractor {
  let state: ExtractorState | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const pendingSaves: Array<{ type: MemoryType; topic: string; content: string }> = []
  const FLUSH_DELAY_MS = 3000

  export function init(projectPath: string, sessionId?: string) {
    state = {
      bashCommandCount: new Map(),
      lastToolCalls: [],
      currentTurnEdits: new Set(),
      projectPath,
      sessionId,
      detectedTopics: new Set(),
    }
    pendingSaves.length = 0
  }

  export function reset() {
    flushPending()
    state = null
  }

  /** Flush any buffered memory saves (debounced writes) */
  export function flushPending() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    while (pendingSaves.length > 0) {
      const item = pendingSaves.shift()!
      commitSave(item)
    }
  }

  function scheduleSave(input: { type: MemoryType; topic: string; content: string }) {
    pendingSaves.push(input)
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushPending()
      }, FLUSH_DELAY_MS)
    }
  }

  export function onToolCall(tool: string, input: Record<string, unknown>) {
    if (!state) return

    // Track bash commands
    if (tool === "bash") {
      const cmd = (input.command as string) || ""
      const base = normalizeCommand(cmd)
      if (base) {
        const count = (state.bashCommandCount.get(base) ?? 0) + 1
        state.bashCommandCount.set(base, count)

        // build-command pattern: same command 3+ times
        if (count >= 3 && !state.detectedTopics.has(`build:${base}`)) {
          state.detectedTopics.add(`build:${base}`)
          saveMemory({
            type: "build-command",
            topic: `build:${base}`,
            content: `Frequently used command: ${cmd} (used ${count} times)`,
          })
        }
      }
    }

    // Track file edits
    if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
      const filePath = (input.file as string) || (input.path as string) || ""
      state.currentTurnEdits.add(filePath)

      // config-pattern: editing config files
      const basename = filePath.split(/[/\\]/).pop() ?? ""
      if (CONFIG_FILES.has(basename) && !state.detectedTopics.has(`config:${basename}`)) {
        state.detectedTopics.add(`config:${basename}`)
        saveMemory({
          type: "config-pattern",
          topic: `config:${basename}`,
          content: `Config file ${basename} was modified in this project`,
        })
      }

      // error-solution: fix after bash error (detected on tool call, not just result)
      if (state.lastBashError) {
        const topic = `fix:${filePath}`
        if (!state.detectedTopics.has(topic)) {
          state.detectedTopics.add(topic)
          saveMemory({
            type: "error-solution",
            topic,
            content: `Error with command "${state.lastBashError.command}" was fixed by editing ${filePath}. Error: ${state.lastBashError.error.slice(0, 200)}`,
          })
        }
        state.lastBashError = undefined
      }
    }

    state.lastToolCalls.push({ tool, input })
  }

  export function onToolResult(tool: string, input: Record<string, unknown>, output: string, exitCode?: number) {
    if (!state) return

    // Track bash failures for error-solution pattern
    if (tool === "bash" && exitCode && exitCode !== 0) {
      const cmd = (input.command as string) || ""
      state.lastBashError = { command: cmd, error: output.slice(0, 500) }
    }

    // Detect fix after error: if there was a bash error and now a write/edit follows
    if (state.lastBashError) {
      if (tool === "write" || tool === "edit" || tool === "patch") {
        const filePath = (input.file as string) || (input.path as string) || ""
        const topic = `fix:${filePath}`
        if (!state.detectedTopics.has(topic)) {
          state.detectedTopics.add(topic)
          saveMemory({
            type: "error-solution",
            topic,
            content: `Error with command "${state.lastBashError.command}" was fixed by editing ${filePath}. Error: ${state.lastBashError.error.slice(0, 200)}`,
          })
        }
        state.lastBashError = undefined
      } else if (tool === "bash" && !exitCode) {
        // Successful bash after error might be the fix
        const topic = `fix:${normalizeCommand((input.command as string) || "")}`
        if (!state.detectedTopics.has(topic)) {
          state.detectedTopics.add(topic)
          saveMemory({
            type: "error-solution",
            topic,
            content: `Error with command "${state.lastBashError.command}" was resolved with: ${(input.command as string) || ""}`,
          })
        }
        state.lastBashError = undefined
      }
    }
  }

  export function onUserMessage(text: string) {
    if (!state) return

    // Check for preference patterns — require 2+ matches to reduce false positives
    let matchCount = 0
    for (const pattern of PREFERENCE_PATTERNS) {
      if (pattern.test(text)) matchCount++
    }
    if (matchCount >= 2) {
      const topic = `pref:${text.slice(0, 80).replace(/[^a-zA-Z0-9]/g, "_")}`
      if (!state.detectedTopics.has(topic)) {
        state.detectedTopics.add(topic)
        saveMemory({
          type: "preference",
          topic,
          content: `User preference: ${text.slice(0, 300)}`,
        })
      }
    }

    // Reset per-turn tracking
    if (state.currentTurnEdits.size >= 3) {
      const topic = `decision:${Date.now()}`
      if (!state.detectedTopics.has(topic)) {
        state.detectedTopics.add(topic)
        const files = Array.from(state.currentTurnEdits).join(", ")
        saveMemory({
          type: "decision",
          topic,
          content: `Architecture decision: ${state.currentTurnEdits.size} files edited in one turn: ${files}`,
        })
      }
    }
    state.currentTurnEdits.clear()
  }

  function saveMemory(input: { type: MemoryType; topic: string; content: string }) {
    if (!state) return
    scheduleSave(input)
  }

  function commitSave(input: { type: MemoryType; topic: string; content: string }) {
    if (!state) return
    try {
      MemoryStore.save({
        projectPath: state.projectPath,
        type: input.type,
        topic: input.topic,
        content: input.content,
        sessionId: state.sessionId,
      })
      log.debug("saved memory", { type: input.type, topic: input.topic })
    } catch (err) {
      log.warn("failed to save memory", { error: String(err) })
    }
  }

  function normalizeCommand(cmd: string): string {
    // Normalize but keep the first positional arg (package name, file, etc.)
    const tokens = cmd.trim().split(/\s+/)
    // Find the end of flags (starts with -) to preserve the first real argument
    let lastFlagIdx = 0
    for (let i = 0; i < Math.min(tokens.length, 8); i++) {
      if (tokens[i].startsWith("-")) lastFlagIdx = i
      else if (lastFlagIdx > 0) break
    }
    // Keep command + flags + first non-flag argument
    return tokens.slice(0, Math.min(lastFlagIdx + 2, tokens.length, 6)).join(" ")
  }
}
