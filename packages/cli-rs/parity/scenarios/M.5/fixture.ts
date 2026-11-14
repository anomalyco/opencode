// M.3's `ses_mini` server with two child sessions its subagent calls started: `ses_run` still runs, and `ses_done`
// finished. The children's reads (messages, inbox, permissions, forms), the family index, and the write the
// subagent views make (interrupt) are routed here.
import type { Logged, Options, Route } from "../../lib/fake-server"
import { assistant, directory, history, user } from "../M.1/fixture"
import { server as base } from "../M.3/fixture"

export { config, event, leave } from "../M.3/fixture"

const subagent = (id: string, child: string, running: boolean, agent: string, description: string) => ({
  type: "tool",
  id,
  name: "subagent",
  state: running
    ? { status: "running", input: { agent, description }, metadata: { sessionID: child, status: "running" } }
    : {
        status: "completed",
        input: { agent, description },
        content: [{ type: "text", text: "Read them." }],
        metadata: { sessionID: child, status: "completed" },
      },
  time: running ? { created: 40, ran: 40 } : { created: 40, ran: 40, completed: 41 },
})

// The history, then a turn that started both children.
export const messages = [
  ...history,
  user("msg_u4", "check the tests", 40),
  assistant(
    "msg_a4",
    [
      subagent("call_done", "ses_done", false, "general", "Read the docs"),
      subagent("call_run", "ses_run", true, "explore", "Find the tests"),
    ],
    41,
  ),
]

const child = (session: string) => [
  { ...user("msg_c1", "Read the docs and sum them up", 50), sessionID: session },
  {
    ...assistant("msg_c2", [{ type: "text", text: "The docs cover setup and testing." }], 51),
    sessionID: session,
  },
]

type Script = Parameters<typeof base>[0] & {
  // Requests the children wait on when mini opens the session.
  childPermissions?: unknown[]
  globalForms?: unknown[]
}

const listed = (entry: Logged, all: unknown[]) =>
  entry.query.order?.[0] === "desc" ? { data: all.toReversed(), cursor: {} } : { data: all, cursor: {} }

const location = { directory }

export function server(script: Script = {}): Options {
  const options = base({ messages, ...script })
  const reads = (session: string, permissions: unknown[] = []): Route[] => [
    { path: `/api/session/${session}/message`, json: (entry: Logged) => listed(entry, child(session)) },
    { path: `/api/session/${session}/inbox`, json: { data: [] } },
    { path: `/api/session/${session}/permission`, json: { data: permissions } },
    { path: `/api/session/${session}/form`, json: { data: [] } },
  ]
  const routes: Route[] = [
    { path: "/api/session/active", json: { data: { ses_run: { type: "busy" } } } },
    { path: "/api/session", json: { data: [], cursor: {} } },
    { path: "/api/form", json: { location, data: script.globalForms ?? [] } },
    ...reads("ses_run", script.childPermissions),
    ...reads("ses_done"),
    { method: "POST", path: "/api/session/ses_run/interrupt", json: { interrupted: true } },
    {
      method: "POST",
      path: "/api/session/ses_run/permission/:id/reply",
      status: 204,
      then: (entry: Logged) => [
        {
          id: "evt_childreplied0001",
          created: 120,
          type: "permission.replied",
          durable: { aggregateID: "ses_run", seq: 1, version: 1 },
          data: {
            sessionID: "ses_run",
            requestID: entry.path.split("/").at(-2),
            reply: (entry.body as { decision: string }).decision,
          },
        },
      ],
    },
    {
      method: "POST",
      path: "/api/session/global/form/:id/reply",
      status: 204,
      then: (entry: Logged) => [
        {
          id: "evt_globalreplied0001",
          created: 121,
          type: "form.replied",
          location,
          data: {
            sessionID: "global",
            id: entry.path.split("/").at(-2),
            answer: (entry.body as { answer: unknown }).answer,
          },
        },
      ],
    },
  ]
  return { ...options, routes: [...routes, ...(options.routes ?? [])] }
}

// The children's tabs are in: the status row counts the running one.
export const opened = { until: { screen: "1 sub" }, settle: 800, timeout: 30_000 }
