// A fake server for `run`: one session `ses_run`, an event stream, and a prompt route that pushes the events a
// scenario scripts. The prompt ID is random on both sides, so events and the message list read it from the
// logged prompt request.
import type { Logged, Options, Route } from "../../lib/fake-server"

export const directory = "/tmp/run"
export const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
export const session = (id = "ses_run", extra: Record<string, unknown> = {}) => ({
  id,
  title: "",
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory },
  ...extra,
})

let counter = 0
export const event = (type: string, data: Record<string, unknown>, created = 10) => ({
  id: `evt_${type.replace(/\W/g, "")}${String(++counter).padStart(8, "0")}`,
  created,
  type,
  durable: { aggregateID: "ses_run", seq: counter },
  data: { sessionID: "ses_run", ...data },
})

export function promptID(requests: Logged[]) {
  const prompt = requests.findLast((entry) => entry.method === "POST" && entry.path.endsWith("/prompt"))
  return (prompt?.body as { id?: string } | undefined)?.id ?? "msg_missing"
}

export const delivered = (id: string) => event("session.inbox.delivered", { inboxID: id }, 5)
export const succeeded = () => event("session.execution.succeeded", {}, 90)

// A text step of assistant message `msg_a`.
export function textStep(text: string, extra: unknown[] = []) {
  return [
    event(
      "session.step.started",
      {
        assistantMessageID: "msg_a",
        agent: "build",
        model: { id: "model", providerID: "demo" },
        snapshot: "snap_1",
        started: 11,
      },
      11,
    ),
    event("session.text.started", { assistantMessageID: "msg_a", ordinal: 0 }, 12),
    event("session.text.ended", { assistantMessageID: "msg_a", ordinal: 0, text }, 13),
    ...extra,
    event(
      "session.step.ended",
      {
        assistantMessageID: "msg_a",
        finish: "stop",
        cost: 0.0012,
        tokens: { input: 5, output: 7, reasoning: 0, cache: { read: 0, write: 0 } },
        snapshot: "snap_2",
      },
      20,
    ),
  ]
}

export function assistant(content: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: "msg_a",
    type: "assistant",
    sessionID: "ses_run",
    agent: "build",
    model: { providerID: "demo", id: "model" },
    content,
    finish: "stop",
    cost: 0.0012,
    tokens: { input: 5, output: 7, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 11, completed: 20 },
    ...extra,
  }
}

type Script = {
  // Events after the prompt, given its ID.
  events?: (id: string) => unknown[]
  // Messages after the prompt, oldest first.
  messages?: unknown[]
  routes?: Route[]
  sessionID?: string
  // The prompt is promoted (`session.inbox.delivered`) unless false.
  delivered?: boolean
  // The prompt is in the message list unless false.
  listed?: boolean
  // The last event, `session.execution.succeeded` by default; `null` for none.
  end?: unknown
  // Events pushed once the wait has answered.
  late?: unknown[]
}

// The scripted events carry `ses_run`; a script for another session gets its ID.
function retarget(events: unknown[], id: string) {
  return events.map((item) => {
    const value = item as { data?: { sessionID?: string } }
    if (value.data?.sessionID !== "ses_run") return item
    return { ...value, data: { ...value.data, sessionID: id } }
  })
}

// The routes of a run that creates `ses_run` and prompts it. The wait answers late, so the live events are
// read before the run reconciles with the message list.
export function server(script: Script = {}): Options {
  const id = script.sessionID ?? "ses_run"
  return {
    routes: [
      ...(script.routes ?? []),
      { path: "/api/location", json: location },
      { method: "POST", path: "/api/session", json: { data: session(id) } },
      { path: "/api/event", events: [{ id: "evt_connected0000", type: "server.connected", data: {} }] },
      {
        method: "POST",
        path: `/api/session/${id}/prompt`,
        json: (entry: Logged) => ({
          data: {
            id: (entry.body as { id: string }).id,
            sessionID: id,
            time: { created: 3 },
            type: "user",
            payload: { text: "x" },
            delivery: "steer",
          },
        }),
        then: (entry: Logged) => {
          const prompt = (entry.body as { id: string }).id
          return retarget(
            [
              ...(script.delivered === false ? [] : [delivered(prompt)]),
              ...(script.events?.(prompt) ?? []),
              ...(script.end === null ? [] : [script.end ?? succeeded()]),
            ],
            id,
          )
        },
      },
      // Late enough that a reply to a live ask is sent before the wait, on both sides.
      { path: `/api/session/${id}/permission`, json: { data: [] }, delay: 150 },
      { path: `/api/session/${id}/form`, json: { data: [] }, delay: 150 },
      {
        method: "POST",
        path: `/api/experimental/session/${id}/wait`,
        status: 204,
        delay: 400,
        then: () => retarget(script.late ?? [], id),
        // After the run has started to reconcile.
        thenDelay: 300,
      },
      { path: "/api/experimental/job", json: { data: [] } },
      { path: "/api/session/active", json: { data: {} } },
      { path: `/api/session/${id}/inbox`, json: { data: [] } },
      {
        path: `/api/session/${id}/message`,
        json: (_entry: Logged, requests: Logged[]) => ({
          data: [
            ...(script.messages ?? []).toReversed(),
            ...(script.listed === false
              ? []
              : [{ id: promptID(requests), type: "user", sessionID: id, text: "x", time: { created: 3 } }]),
          ],
          cursor: {},
        }),
      },
    ],
  }
}

// `reportRunError` and the "not promoted" error stamp `Date.now()`.
export const nowMask = { pattern: /"timestamp":\d{13}/g, replacement: '"timestamp":<now>' }
