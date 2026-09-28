// RenderEvent helpers shared by the text/json sinks, `-p` and the REPL (ARCHITECTURE §11).
import type { RenderEvent, RunResult, TokenUsage, ToolStatus } from "../contract"
import { redact, redactText, redactUrl } from "../util/redact"

const URLS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

/** Every sink's last step: registered secrets, plus userinfo/secret query values of any URL, even unregistered. */
export function clean(text: string) {
  return redactText(text.replace(URLS, (url) => redactUrl(url)))
}

export function cleanEvent(event: RenderEvent) {
  return scrub(redact(event)) as RenderEvent
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") return clean(value)
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(scrub)
  return Object.fromEntries(Object.entries(value).map((entry) => [entry[0], scrub(entry[1])]))
}

/** "812 B", "3.4 KB", "1.2 MB"; "12 ms", "1.4 s". */
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
export const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

/** `✓ read src/x.ts · 12 ms · 3.4 KB`; a non-ok status is named: `✗ bash rm -rf x · denied · 1 ms · 40 B`. */
export function toolLine(event: { status: ToolStatus; summary: string; duration_ms: number; bytes: number }) {
  const mark = event.status === "ok" ? "✓" : "✗"
  const status = event.status === "ok" || event.status === "error" ? [] : [event.status]
  return [`${mark} ${event.summary}`, ...status, duration(event.duration_ms), bytes(event.bytes)].join(" · ")
}

/** `step 2 · in 812 / out 64 tok`, with `(est.)` when the server sent no usage. */
export function stepLine(step: number, usage: TokenUsage) {
  return `step ${step} · in ${usage.input} / out ${usage.output} tok${usage.estimated ? " (est.)" : ""}`
}

/** SPEC §1 exit codes: 130 cancelled; 3 max-turns or any headless denial (runtime counts a text-protocol give-up as one); 1 failed. */
export function exitCode(result: RunResult, headless: boolean) {
  if (result.state === "cancelled") return 130
  if (result.reason === "max_turns" || (headless && result.denied > 0)) return 3
  return result.state === "failed" ? 1 : 0
}

export function resultEvent(result: RunResult, exit_code: number, agent_path: string[] = []): RenderEvent {
  return { type: "result", session_id: result.session_id, agent_path, state: result.state, text: result.text,
    turns: result.turns, usage: result.usage, exit_code }
}

/** Why a headless run exited non-zero, for stderr in text mode. */
export function exitReason(result: RunResult, code: number) {
  if (code === 0) return undefined
  if (result.reason === "max_turns") return `stopped: max turns reached (${result.turns})`
  if (code === 3 && result.error) return `stopped: ${result.error.split("\n")[0]}`
  if (code === 3) return `${result.denied} permission request(s) denied (headless); allow with --allowed-tools or --permission-mode`
  if (code === 130) return "interrupted"
  return result.error ? `error: ${result.error.split("\n")[0]}` : `run ${result.state}`
}
