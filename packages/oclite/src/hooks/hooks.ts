import { Effect, Layer, Option } from "effect"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { AppConfig, type HookEntry, type HookInput, type HookOutcome, Hooks } from "../contract"

type HookName = "PreToolUse" | "PostToolUse" | "Stop"

// Claude Code hook contract: JSON on stdin; exit 0 continues, exit 2 blocks with stderr as the reason, any other
// exit warns and continues. Entries run in config order and the first block wins.
export const layer = Layer.effect(
  Hooks,
  Effect.gen(function* () {
    const cfg = yield* AppConfig
    return Hooks.of({
      run: Effect.fn("Hooks.run")(function* (hook, input) {
        const warnings: string[] = []
        for (const entry of cfg.hooks[hook].filter((entry) => matches(entry.matcher, input.tool_name))) {
          const outcome = yield* spawn(entry, hook, input)
          if (outcome.kind === "block") return outcome
          if (outcome.kind === "warn") warnings.push(outcome.message)
        }
        if (warnings.length) return { kind: "warn" as const, message: warnings.join("\n") }
        return { kind: "continue" as const }
      }),
    })
  }),
)

/** Case-insensitive, `|`-alternated glob over the oclite tool name, so Claude's `Bash` or `Edit|Write` match. */
export function matches(matcher: string, tool: string | undefined) {
  if (tool === undefined) return true
  return matcher.split("|").some((part) => Wildcard.match(tool.toLowerCase(), part.trim().toLowerCase() || "*"))
}

function spawn(entry: HookEntry, hook: HookName, input: HookInput) {
  const payload = {
    hook,
    hook_event_name: hook,
    session_id: input.session_id,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_output: input.tool_output,
    cwd: input.cwd,
  }
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      // Own process group so a timeout or cancel also kills whatever the hook script started.
      const proc = Bun.spawn(["sh", "-c", entry.command], {
        cwd: input.cwd,
        env: { ...process.env },
        stdin: new Blob([JSON.stringify(payload)]),
        stdout: "ignore",
        stderr: "pipe",
        detached: true,
      })
      const chunks: string[] = []
      const decoder = new TextDecoder()
      const reader = proc.stderr.getReader()
      const drain = async (): Promise<void> => {
        const next = await reader.read()
        if (next.done) return
        chunks.push(decoder.decode(next.value, { stream: true }))
        return drain()
      }
      return { proc, chunks, reading: drain() }
    }),
    (run) =>
      // Done when the hook process exits, not when stderr closes: a backgrounded grandchild may keep it open.
      Effect.promise(() => run.proc.exited).pipe(
        Effect.timeoutOption(entry.timeout_ms),
        Effect.flatMap((code) =>
          Effect.promise(() => Promise.race([run.reading, Bun.sleep(50)])).pipe(
            Effect.map((): HookOutcome => {
              const stderr = run.chunks.join("").trim()
              if (Option.isNone(code))
                return { kind: "warn", message: `hook "${entry.command}" timed out after ${entry.timeout_ms / 1000} s` }
              if (code.value === 0) return { kind: "continue" }
              if (code.value === 2) return { kind: "block", message: stderr || `blocked by hook "${entry.command}"` }
              const detail = stderr ? `: ${stderr}` : ""
              return { kind: "warn", message: `hook "${entry.command}" exited with code ${code.value}${detail}` }
            }),
          ),
        ),
      ),
    // Timeout or interrupt (cancel): the group is still running, kill it.
    (run) => Effect.sync(() => (run.proc.exitCode === null ? killGroup(run.proc.pid) : undefined)),
  )
}

export function killGroup(pid: number) {
  // The group may already be gone; nothing else to clean up then.
  try {
    process.kill(-pid, "SIGKILL")
  } catch {}
}
