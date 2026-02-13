import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import { readFile } from "fs/promises"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HookCommand {
  command: string
  timeout?: number
  async?: boolean
}

type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "PreCompact"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "Notification"

interface HooksConfig {
  hooks?: Partial<Record<HookEventName, HookCommand[]>>
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000

function getShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  if (process.platform === "win32") return "cmd.exe"
  return "/bin/sh"
}

function runCommand(
  command: string,
  stdinPayload: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const shell = getShell()
    const child = spawn(shell, ["-c", command], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill("SIGKILL")
        resolve({ exitCode: 1, stdout, stderr: stderr + "\n[shell-hooks] timeout" })
      }
    }, timeoutMs)

    child.stdout!.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr!.on("data", (d: Buffer) => {
      stderr += d.toString()
    })

    child.on("error", (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: err.message })
      }
    })

    child.on("close", (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ exitCode: code ?? 1, stdout, stderr })
      }
    })

    child.stdin!.write(stdinPayload)
    child.stdin!.end()
  })
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const ShellHooksPlugin: Plugin = async (input) => {
  const projectDir = input.directory
  const configPath = path.join(projectDir, ".opencode", "hooks.json")

  let config: HooksConfig = {}
  try {
    const raw = await readFile(configPath, "utf-8")
    config = JSON.parse(raw)
  } catch {
    // No config or invalid JSON — plugin becomes a no-op
  }

  const hooks = config.hooks ?? {}

  function getCommands(event: HookEventName): HookCommand[] {
    return hooks[event] ?? []
  }

  function buildEnv(sessionID: string, event: HookEventName): Record<string, string> {
    return {
      OPENCODE_SESSION_ID: sessionID,
      OPENCODE_PROJECT_DIR: projectDir,
      OPENCODE_HOOK_EVENT: event,
    }
  }

  function buildPayload(event: HookEventName, sessionID: string, extra?: Record<string, unknown>): string {
    return JSON.stringify({
      hook_event_name: event,
      session_id: sessionID,
      cwd: projectDir,
      ...extra,
    })
  }

  /** Run all commands for an event. Sync commands run in parallel; async ones fire-and-forget. */
  async function runAll(
    event: HookEventName,
    sessionID: string,
    extra?: Record<string, unknown>,
  ): Promise<RunResult[]> {
    const commands = getCommands(event)
    if (!commands.length) return []

    const payload = buildPayload(event, sessionID, extra)
    const env = buildEnv(sessionID, event)

    const syncCommands: HookCommand[] = []
    for (const cmd of commands) {
      if (cmd.async) {
        // Fire-and-forget
        runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
      } else {
        syncCommands.push(cmd)
      }
    }

    return Promise.all(
      syncCommands.map((cmd) => runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS)),
    )
  }

  return {
    // -------------------------------------------------------------------
    // tool.execute.before → PreToolUse
    // Exit 2 = block (throw), JSON stdout can modify args
    // -------------------------------------------------------------------
    async "tool.execute.before"(inp, out) {
      const results = await runAll("PreToolUse", inp.sessionID, {
        tool_name: inp.tool,
        tool_input: out.args,
      })
      for (const r of results) {
        if (r.exitCode === 2) {
          throw new Error(`[shell-hooks] PreToolUse hook blocked tool "${inp.tool}": ${r.stderr || r.stdout}`)
        }
        if (r.exitCode !== 0) continue
        // Try to parse stdout as JSON to modify args
        const trimmed = r.stdout.trim()
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed && typeof parsed === "object") {
              Object.assign(out.args, parsed)
            }
          } catch {
            // Non-JSON stdout is ignored
          }
        }
      }
    },

    // -------------------------------------------------------------------
    // tool.execute.after → PostToolUse (fire-and-forget)
    // -------------------------------------------------------------------
    async "tool.execute.after"(inp, out) {
      const commands = getCommands("PostToolUse")
      if (!commands.length) return
      const payload = buildPayload("PostToolUse", inp.sessionID, {
        tool_name: inp.tool,
        tool_response: out.output,
      })
      const env = buildEnv(inp.sessionID, "PostToolUse")
      for (const cmd of commands) {
        runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
      }
    },

    // -------------------------------------------------------------------
    // chat.message → UserPromptSubmit
    // Exit 2 = block (clear parts)
    // -------------------------------------------------------------------
    async "chat.message"(inp, out) {
      const messageText =
        out.parts
          ?.filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? p.content ?? "")
          .join("\n") ?? ""
      const results = await runAll("UserPromptSubmit", inp.sessionID, {
        prompt: messageText,
      })
      for (const r of results) {
        if (r.exitCode === 2) {
          out.parts.length = 0
          return
        }
      }
    },

    // -------------------------------------------------------------------
    // permission.ask → PermissionRequest
    // Exit 2 = deny, exit 0 with stdout "allow" = allow
    // -------------------------------------------------------------------
    async "permission.ask"(inp, out) {
      const results = await runAll("PermissionRequest", inp.sessionID, {
        tool_name: inp.type,
        pattern: inp.pattern,
      })
      for (const r of results) {
        if (r.exitCode === 2) {
          out.status = "deny"
          return
        }
        if (r.exitCode === 0) {
          const trimmed = r.stdout.trim().toLowerCase()
          if (trimmed === "allow") {
            out.status = "allow"
          } else if (trimmed === "deny") {
            out.status = "deny"
          }
        }
      }
    },

    // -------------------------------------------------------------------
    // experimental.session.compacting → PreCompact
    // Stdout lines become context strings
    // -------------------------------------------------------------------
    async "experimental.session.compacting"(inp, out) {
      const results = await runAll("PreCompact", inp.sessionID)
      for (const r of results) {
        if (r.exitCode === 0) {
          const trimmed = r.stdout.trim()
          if (trimmed) {
            out.context.push(...trimmed.split("\n").filter(Boolean))
          }
        }
      }
    },

    // -------------------------------------------------------------------
    // event → SessionStart / SessionEnd / Stop / Notification
    // All fire-and-forget
    // -------------------------------------------------------------------
    async event({ event }) {
      const sessionID = (event as any).properties?.sessionID ?? (event as any).properties?.info?.id ?? ""

      switch (event.type) {
        case "session.created": {
          const commands = getCommands("SessionStart")
          if (!commands.length) return
          const payload = buildPayload("SessionStart", sessionID)
          const env = buildEnv(sessionID, "SessionStart")
          for (const cmd of commands) {
            runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
          }
          break
        }
        case "session.deleted": {
          const commands = getCommands("SessionEnd")
          if (!commands.length) return
          const payload = buildPayload("SessionEnd", sessionID)
          const env = buildEnv(sessionID, "SessionEnd")
          for (const cmd of commands) {
            runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
          }
          break
        }
        case "session.idle": {
          const commands = getCommands("Stop")
          if (!commands.length) return
          const payload = buildPayload("Stop", sessionID)
          const env = buildEnv(sessionID, "Stop")
          for (const cmd of commands) {
            runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
          }
          break
        }
        case "session.error": {
          const commands = getCommands("Notification")
          if (!commands.length) return
          const payload = buildPayload("Notification", sessionID, {
            error: (event as any).properties?.error,
          })
          const env = buildEnv(sessionID, "Notification")
          for (const cmd of commands) {
            runCommand(cmd.command, payload, env, cmd.timeout ?? DEFAULT_TIMEOUT_MS).catch(() => {})
          }
          break
        }
      }
    },
  }
}

export default ShellHooksPlugin
