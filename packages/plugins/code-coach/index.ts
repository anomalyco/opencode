import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Code Coach - opencode plumbing lane.
 *
 * This plugin never delays, blocks, or rewrites a send. Core awaits the
 * `prompt` hook inside SessionPrompt.prepare, before the message is admitted,
 * so anything slow in here is felt by the developer. The hook therefore does
 * one small synchronous file write and returns the event untouched:
 *
 *   1. filter out sends that are not the developer's ask;
 *   2. write `req-<id>.json` with the prompt text, cwd, and session id;
 *   3. return immediately.
 *
 * The daemon is a separate process. It reads the request, decides whether the
 * ask is destructive with no recovery point, and - if it is - shows one card.
 * The card copies a guardrail to the clipboard or dismisses itself. Nothing the
 * card does can change the send that already happened.
 *
 * There is no verdict file, no polling, no timeout, and no model call. A dead
 * daemon costs one failed file write, and every branch is fail-open.
 */

const IS_WINDOWS = process.platform === "win32"
const DATA =
  process.env.COACH_DATA_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "CodeCoachData")
const IPC = join(DATA, "ipc")
const LOG = join(DATA, "logs", "plugin.log")
const PID = join(DATA, "daemon.pid")

// A send shorter than this is a continuation ("ok", "go on", "yes do it"),
// not an ask that can carry a recovery point.
const MIN_CHARS = 12
// Beyond this the text is a paste, not a prompt. The daemon only needs the
// ask; a 40 KB paste is not something a single card can review.
const MAX_CHARS = 4000

// system-shaped payloads are not the developer's ask: compaction summaries,
// synthetic context blocks, subagent briefs, tool results echoed as prompts.
const SYSTEM_SHAPED =
  /^\s*(<(?:system|instructions?|context|summary|tool_result|environment)\b|\[?(?:system|assistant)\]?\s*:|you are (?:a|an|the)\s)/i

function log(line: string) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()}  [${process.pid}] ${line}\n`, "utf8")
  } catch {}
}

function bypassed() {
  const v = process.env.COACH_BYPASS
  if (!v) return false
  const s = String(v).trim().toLowerCase()
  return s !== "0" && s !== "false" && s !== "no"
}

// A request nobody will read is just prompt text left on disk. If the daemon
// is not running, skip the write entirely rather than leaving the ask in the
// IPC folder for the next process that happens to scan it.
function coachAlive() {
  try {
    const pid = Number(readFileSync(PID, "utf8").trim())
    if (!Number.isInteger(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function skipReason(text: string): string {
  if (bypassed()) return "bypass"
  if (!text || !text.trim()) return "empty"
  if (text.trim().length < MIN_CHARS) return "short"
  if (text.trimStart().startsWith("/")) return "slash"
  if (text.length > MAX_CHARS) return "long"
  if (SYSTEM_SHAPED.test(text)) return "system-shaped"
  if (!coachAlive()) return "no-daemon"
  return ""
}

// Write through a temp file and rename, so the daemon never reads a partial
// request. UTF-8 without a BOM: the daemon parses this with ConvertFrom-Json,
// and the plugin reads its own log with tools that do not expect one either.
function drop(name: string, payload: unknown) {
  const file = join(IPC, name)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(payload), "utf8")
  renameSync(tmp, file)
}

export default Plugin.define({
  id: "code-coach",
  async setup(ctx) {
    log("plugin setup")
    if (!IS_WINDOWS && !process.env.COACH_DATA_DIR) {
      log("skip: unsupported platform")
      return
    }
    try {
      mkdirSync(IPC, { recursive: true })
      mkdirSync(join(DATA, "logs"), { recursive: true })
    } catch {}
    const workspace = process.env.COACH_CWD || String(ctx?.location?.directory ?? "")

    await ctx.session.hook("prompt", (event) => {
      try {
        const prompt = event?.prompt
        const text = typeof prompt?.text === "string" ? prompt.text : ""
        const reason = skipReason(text)
        if (reason) {
          if (reason !== "empty" && reason !== "short") log(`skip: ${reason} len=${text.length}`)
          return
        }

        const id = randomUUID()
        drop(`req-${id}.json`, {
          id,
          text,
          cwd: workspace,
          sid: event?.sessionID ?? null,
          at: Date.now(),
        })
        // Length only. The text is never logged and never leaves this folder.
        log(`request len=${text.length} sid=${event?.sessionID ?? "none"}`)
      } catch (error) {
        log(`error ${error instanceof Error ? error.message : error}`)
      }
    })
  },
})
