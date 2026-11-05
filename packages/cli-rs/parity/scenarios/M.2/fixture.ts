// M.1's `ses_mini` server with what the footer prompt needs: the catalogs it completes from (agents, commands,
// references, a file search) and the writes it makes (commands, shells, compaction, inbox changes).
import type { Logged, Options, Route } from "../../lib/fake-server"
import { location, server as base } from "../M.1/fixture"

import { event } from "../M.1/fixture"

export { config, event, history, user, assistant } from "../M.1/fixture"

const listed = (data: unknown[]) => ({ location, data })

export const agents = [
  { id: "build", name: "build", description: "Default agent", mode: "primary", hidden: false },
  { id: "plan", name: "plan", description: "Planning agent", mode: "primary", hidden: false },
  { id: "general", name: "general", description: "General purpose subagent", mode: "subagent", hidden: false },
  { id: "explore", name: "explore", description: "Explores the code", mode: "subagent", hidden: false },
]

export const commands = [
  { name: "review", description: "Review the working tree", source: "command" },
  { name: "init", description: "Create AGENTS.md", source: "command" },
]

export const files = ["src/main.ts", "src/general.ts", "src/", "README.md"]

// The status row's hints open M.3's views: the command menu (`ctrl+p menu`) and the pending prompts
// (`ctrl+x q 1 pending`).
export const statusMask = {
  pattern: /^(ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
  reason: "the ctrl+p menu and pending-prompt hints open M.3's views",
}

type Script = Omit<NonNullable<Parameters<typeof base>[0]>, "events"> & {
  // How long `session.wait` holds a turn open, in ms.
  wait?: number
  // Events pushed after a prompt, given its ID and the request log (the prompt is its last entry).
  events?: (id: string, requests: Logged[]) => unknown[]
}

const inboxItem = (entry: Logged) => {
  const body = entry.body as { id: string; text: string; delivery?: string }
  return {
    id: body.id,
    sessionID: "ses_mini",
    time: { created: 3 },
    type: "user",
    payload: { text: body.text },
    delivery: body.delivery ?? "steer",
  }
}

export function server(script: Script = {}): Options {
  const options = base({ ...script, events: undefined })
  const routes: Route[] = [
    { path: "/api/agent", json: listed(agents) },
    { path: "/api/command", json: listed(commands) },
    { path: "/api/reference", json: listed([]) },
    {
      path: "/api/fs/find",
      json: (entry: Logged) => {
        const query = entry.query.query?.[0] ?? ""
        return listed(files.filter((file) => file.includes(query)).map((path) => ({ path })))
      },
    },
    { method: "POST", path: "/api/session/ses_mini/command", status: 204 },
    { method: "POST", path: "/api/session/ses_mini/shell", status: 204 },
    { method: "PATCH", path: "/api/session/ses_mini/inbox/:id", status: 204 },
    { method: "DELETE", path: "/api/session/ses_mini/inbox/:id", status: 204 },
    ...(script.wait === undefined
      ? []
      : [{ method: "POST", path: "/api/experimental/session/ses_mini/wait", status: 204, delay: script.wait }]),
    // Admitted prompts echo their delivery, so a queued prompt reads back as queued.
    {
      method: "POST",
      path: "/api/session/ses_mini/prompt",
      json: (entry: Logged) => ({ data: inboxItem(entry) }),
      then: (entry: Logged, requests: Logged[]) => script.events?.((entry.body as { id: string }).id, requests) ?? [],
    },
  ]
  return { ...options, routes: [...routes, ...(options.routes ?? [])] }
}

// The events of a prompt the server delivers and answers at once.
export const answer = (id: string, reply: string, message = "msg_a4") => [
  event("session.inbox.delivered", { inboxID: id }),
  event("session.execution.started", {}),
  event("session.step.started", {
    assistantMessageID: message,
    agent: "build",
    model: { id: "model", providerID: "demo" },
    snapshot: "snap_1",
    started: 101,
  }),
  event("session.text.delta", { assistantMessageID: message, ordinal: 0, delta: reply }),
  event("session.text.ended", { assistantMessageID: message, ordinal: 0, text: reply }),
  event("session.execution.succeeded", {}),
]

// Every scenario: `mini -s ses_mini` at 60x20, Ctrl+C twice to leave.
export const leave = [
  { keys: "\x03", settle: 200 },
  { keys: "\x03", settle: 400 },
]

// Waits for the replayed transcript.
export const opened = { until: { screen: "Third answer" }, settle: 600, timeout: 30_000 }
