import type { ProgramStatus, ProgramStatusKind } from "@opentui/core"
import { createHash } from "node:crypto"
import { createEffect, onCleanup } from "solid-js"

export type PendingSession = { id: string; title?: string } & (
  | { state: "blocked"; kind: ProgramStatusKind; message?: string }
  | { state: "working" }
)

const APP = "opencode"
const ROOT = ""
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Mirrors pending session state into OSC 7501 records: one root summary plus one child record per
// pending session. Terminals drop working and blocked records when the process exits.
export function createProgramStatus(input: {
  renderer: { setProgramStatus(status: ProgramStatus): boolean }
  sessions: () => PendingSession[]
}) {
  const sent = new Map<string, string>()

  const send = (key: string, status: ProgramStatus) => {
    if (!input.renderer.setProgramStatus(status)) return
    if (status.state === "clear") {
      sent.delete(key)
      return
    }
    sent.set(key, JSON.stringify(status))
  }

  createEffect(() => {
    const reports = programStatusReports(input.sessions())
    Array.from(sent.keys())
      .filter((key) => key !== ROOT && !reports.has(key))
      .forEach((key) => send(key, { state: "clear", id: key }))
    reports.forEach((status, key) => {
      if (sent.get(key) !== JSON.stringify(status)) send(key, status)
    })
  })

  onCleanup(() => send(ROOT, { state: "clear" }))
}

export function programStatusReports(sessions: PendingSession[]) {
  return new Map<string, ProgramStatus>([
    [ROOT, root(sessions)],
    ...sessions.map((session): [string, ProgramStatus] => {
      const id = recordID(session.id)
      return [id, record(session, id)]
    }),
  ])
}

function root(sessions: PendingSession[]): ProgramStatus {
  const blocked = sessions.filter((session) => session.state === "blocked")
  const working = sessions.filter((session) => session.state === "working")
  if (blocked.length === 1) return record(blocked[0])
  if (blocked.length > 1)
    return {
      state: "blocked",
      kind: blocked.every((session) => session.kind === blocked[0].kind) ? blocked[0].kind : undefined,
      app: APP,
      message: `${blocked.length} sessions need input`,
    }
  if (working.length === 1) return record(working[0])
  if (working.length > 1) return { state: "working", app: APP, message: `${working.length} sessions working` }
  return { state: "idle", app: APP }
}

function record(session: PendingSession, id?: string): ProgramStatus {
  const title = clip(session.title, 192)
  if (session.state === "working") return { state: "working", id, app: APP, title }
  return { state: "blocked", kind: session.kind, id, app: APP, title, message: clip(session.message, 2048) }
}

// Record IDs must be 1-32 bytes of [A-Za-z0-9_.+-], but Session IDs only need a "ses" prefix.
function recordID(id: string) {
  if (/^[\w.+-]{1,32}$/.test(id)) return id
  return `ses_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`
}

// Records reject control characters and oversized fields, so normalize to one line within the byte limit.
function clip(input: string | undefined, bytes: number) {
  const text = (input ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return
  const encoded = encoder.encode(text)
  if (encoded.byteLength <= bytes) return text
  // Leave room for the 3-byte ellipsis and drop a code point the byte cut split.
  return decoder.decode(encoded.subarray(0, bytes - 3)).replace(/\uFFFD+$/, "") + "…"
}
