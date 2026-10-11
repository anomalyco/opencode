import { createHash } from "node:crypto"
import type { FormInfo, SessionInfo } from "@opencode/client"

// https://www.superlogical.com/rex/docs/build/program-status
const priority = { blocked: 0, working: 1, error: 2, done: 3, idle: 4 }

export type ProgramState =
  | { state: "idle" | "working" | "done" | "error" }
  | { state: "blocked"; kind: "permission" | "question" | "auth" }

export type ProgramSession = Pick<SessionInfo, "id" | "parentID" | "outcome" | "time" | "title"> & {
  running: boolean
  permission: boolean
  forms: Pick<FormInfo, "fields">[]
}

export function sessionProgramState(session: ProgramSession): ProgramState {
  if (session.permission) return { state: "blocked", kind: "permission" }
  if (session.forms.length) {
    return {
      state: "blocked",
      kind: session.forms.some((form) => form.fields.some((field) => field.type === "external")) ? "auth" : "question",
    }
  }
  if (session.running) return { state: "working" }
  if (session.time.idle === undefined || (session.time.viewed ?? -Infinity) >= session.time.idle)
    return { state: "idle" }
  if (session.outcome === "failed") return { state: "error" }
  if (session.outcome === "succeeded") return { state: "done" }
  return { state: "idle" }
}

export function sessionProgramID(sessionID: string, get: (id: string) => { parentID?: string } | undefined): string {
  const ancestors: string[] = []
  const seen = new Set<string>()
  const visit = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const parent = get(id)?.parentID
    if (parent) visit(parent)
    ancestors.push(id)
  }
  visit(sessionID)
  // Seven 16-byte segments plus the namespace fit both the 128-byte and eight-level caps.
  const segments = ancestors.length <= 7 ? ancestors : [...ancestors.slice(0, 6), ancestors.slice(6).join("/")]
  return ["opencode", ...segments.map((id) => createHash("sha256").update(id).digest("hex").slice(0, 16))].join("/")
}

export function createProgramStatus(write: (sequence: string) => void) {
  const records = new Map<string, string>()
  let disposed = false
  const report = (id: string, state: ProgramState | { state: "clear" }, title?: string) => {
    // Forty-eight Unicode code points fit the 192-byte decoded title cap, even at four bytes each.
    const label =
      title === undefined
        ? ""
        : Buffer.from(
            Array.from(title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
              .slice(0, 48)
              .join(""),
          ).toString("base64")
    const sequence = `\x1b]7501;state=${state.state}:app=opencode${id ? `:id=${id}` : ""}${"kind" in state ? `:kind=${state.kind}` : ""}${label ? `:title=${label}` : ""}\x1b\\`
    if (records.get(id) === sequence) return
    write(sequence)
    records.set(id, sequence)
  }
  return {
    update(
      sessions: ProgramSession[],
      get: Parameters<typeof sessionProgramID>[1],
      auth = false,
      forms: ProgramSession["forms"] = [],
    ) {
      if (disposed) return
      const candidates = sessions.map((session) => ({
        id: sessionProgramID(session.id, get),
        state: sessionProgramState(session),
        title: session.title,
      }))
      // Reserve the root, namespace and global input; keep active work ahead of old idle subagents.
      const next = new Map(
        (candidates.length <= 61
          ? candidates
          : candidates.toSorted((a, b) => priority[a.state.state] - priority[b.state.state])
        )
          .slice(0, 61)
          .map((record) => [record.id, record]),
      )
      if (auth || forms.length) {
        next.set("opencode/input", {
          id: "opencode/input",
          title: undefined,
          state: {
            state: "blocked",
            kind:
              auth || forms.some((form) => form.fields.some((field) => field.type === "external"))
                ? "auth"
                : "question",
          },
        })
      }
      const summary = Array.from(next.values()).reduce<ProgramState>(
        (state, record) => (priority[record.state.state] < priority[state.state] ? record.state : state),
        { state: "idle" },
      )
      // Flat per-tab consumers read the root; hierarchical consumers also get a namespace summary.
      report("", summary)
      report("opencode", summary)
      const removed = Array.from(records.keys()).filter((id) => id !== "" && id !== "opencode" && !next.has(id))
      removed.forEach((id) => {
        report(id, { state: "clear" })
        records.delete(id)
        // Clearing an ancestor also removes retained children; force them to be emitted again.
        Array.from(records.keys())
          .filter((child) => child.startsWith(`${id}/`))
          .forEach((child) => records.delete(child))
      })
      next.forEach((record, id) => report(id, record.state, record.title))
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (records.size) {
        // An unscoped clear would delete other programs' records too.
        report("", { state: "idle" })
        report("opencode", { state: "clear" })
      }
      records.clear()
    },
  }
}
