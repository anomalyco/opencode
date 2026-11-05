// A fake server for `mini`: one session `ses_mini` with a short history, an event stream that stays open, and
// the reads the split-footer transport makes when it hydrates. The splash is off in every case: it is M.4's.
import type { Logged, Options, Route } from "../../lib/fake-server"

export const directory = "/tmp/mini"
export const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
export const session = (id = "ses_mini", extra: Record<string, unknown> = {}) => ({
  id,
  title: "Mini history",
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory },
  agent: "build",
  model: { providerID: "demo", id: "model" },
  ...extra,
})

export const user = (id: string, text: string, created: number) => ({
  id,
  type: "user",
  sessionID: "ses_mini",
  text,
  time: { created },
})

export const assistant = (id: string, content: unknown[], created: number) => ({
  id,
  type: "assistant",
  sessionID: "ses_mini",
  agent: "build",
  model: { providerID: "demo", id: "model" },
  content,
  finish: "stop",
  cost: 0,
  tokens: { input: 5, output: 7, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, completed: created + 1 },
})

// Oldest first: three turns, the second with reasoning and a list.
export const history = [
  user("msg_u1", "first question", 10),
  assistant("msg_a1", [{ type: "text", text: "First answer." }], 11),
  user("msg_u2", "second question", 20),
  assistant(
    "msg_a2",
    [
      { type: "reasoning", text: "Weighing the options." },
      { type: "text", text: "Second answer:\n\n- one\n- two" },
    ],
    21,
  ),
  user("msg_u3", "third question", 30),
  assistant("msg_a3", [{ type: "text", text: "Third answer, the last one." }], 31),
]

let counter = 0
export const event = (type: string, data: Record<string, unknown>, created = 100) => ({
  id: `evt_${type.replace(/\W/g, "")}${String(++counter).padStart(8, "0")}`,
  created,
  type,
  durable: { aggregateID: "ses_mini", seq: counter, version: 1 },
  data: { sessionID: "ses_mini", ...data },
})

export function promptID(requests: Logged[]) {
  const prompt = requests.findLast((entry) => entry.method === "POST" && entry.path.endsWith("/prompt"))
  return (prompt?.body as { id?: string } | undefined)?.id ?? "msg_missing"
}

// The message list honours `limit` and `order=desc` as the server does, so `--replay-limit` shows.
function listed(entry: Logged, requests: Logged[], base: unknown[], extra: (requests: Logged[]) => unknown[]) {
  const all = [...base, ...extra(requests)]
  const limit = Number(entry.query.limit?.[0] ?? all.length)
  const desc = entry.query.order?.[0] === "desc"
  const ordered = desc ? all.toReversed() : all
  return { data: ordered.slice(0, limit), cursor: {} }
}

// Plain-text entries only: prompts and errors. Core's Markdown wraps assistant text at the wrong column after a
// resize (see `parity/deviations/M01-mini-shell.md`), so the resize case leaves Markdown out.
export const plain = [
  user("msg_u1", "first question about a rather long topic", 10),
  {
    ...assistant("msg_a1", [], 11),
    error: { type: "provider", message: "The provider refused the first request" },
  },
  user("msg_u2", "second question", 20),
  { ...assistant("msg_a2", [], 21), error: { type: "provider", message: "Rate limited" } },
]

type Script = {
  routes?: Route[]
  // The session's history, oldest first; `history` by default.
  messages?: unknown[]
  // Messages after the history once a prompt was sent, given its ID.
  after?: (id: string) => unknown[]
  // Events pushed after the prompt, given its ID.
  events?: (id: string) => unknown[]
}

export function server(script: Script = {}): Options {
  const after = (requests: Logged[]) =>
    requests.some((entry) => entry.method === "POST" && entry.path.endsWith("/prompt"))
      ? (script.after?.(promptID(requests)) ?? [])
      : []
  return {
    routes: [
      ...(script.routes ?? []),
      { path: "/api/location", json: location },
      { path: "/api/session/ses_mini", json: { data: session() } },
      { method: "POST", path: "/api/session", json: { data: session("ses_new", { title: "" }) } },
      { path: "/api/event", events: [{ id: "evt_connected0000", type: "server.connected", data: {} }] },
      {
        method: "POST",
        path: "/api/session/ses_mini/prompt",
        json: (entry: Logged) => ({
          data: {
            id: (entry.body as { id: string }).id,
            sessionID: "ses_mini",
            time: { created: 3 },
            type: "user",
            payload: { text: (entry.body as { text: string }).text },
            delivery: "steer",
          },
        }),
        then: (entry: Logged) => script.events?.((entry.body as { id: string }).id) ?? [],
      },
      { method: "POST", path: "/api/session/ses_mini/agent", status: 204 },
      { method: "POST", path: "/api/session/ses_mini/model", status: 204 },
      { method: "POST", path: "/api/experimental/session/ses_mini/wait", status: 204, delay: 200 },
      { path: "/api/session/ses_mini/permission", json: { data: [] } },
      { path: "/api/session/ses_mini/form", json: { data: [] } },
      { path: "/api/form", json: { location, data: [] } },
      { path: "/api/session/active", json: { data: {} } },
      { path: "/api/session/ses_mini/inbox", json: { data: [] } },
      {
        path: "/api/session/ses_mini/message",
        json: (entry: Logged, requests: Logged[]) => listed(entry, requests, script.messages ?? history, after),
      },
      { path: "/api/model/default", json: { data: { providerID: "demo", id: "model" } } },
      // A new session (`mini` without `-s`): empty.
      { path: "/api/session/ses_new/message", json: { data: [], cursor: {} } },
      { path: "/api/session/ses_new/inbox", json: { data: [] } },
      { path: "/api/session/ses_new/permission", json: { data: [] } },
      { path: "/api/session/ses_new/form", json: { data: [] } },
    ],
    fallback: "tui",
  }
}

// `cli.json` for both sides: no splash (M.4), so the scrollback holds only the transcript.
export async function config(root: string, extra: Record<string, unknown> = {}) {
  const file = `${root}/home/.config/opencode/cli.json`
  await Bun.write(file, JSON.stringify({ mini: { splash: "hide", ...extra } }))
}

// The footer's status row ends with the command menu's hint in TS; the menu is M.3's.
export const statusMask = {
  pattern: /^Build · model · demo( · ctrl\+p menu)?$/,
  reason: "the ctrl+p menu hint is M.3's",
}
