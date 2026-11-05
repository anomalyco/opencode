// M.2's `ses_mini` server with the requests M.3's footer views answer: pending permissions and forms listed when
// mini opens the session, the replies they send, and the inbox changes the pending-prompt panel makes. Each write
// pushes the event the real server sends once it took effect.
import type { Logged, Options, Route } from "../../lib/fake-server"
import { event, server as base } from "../M.2/fixture"

export { config, event, leave, opened } from "../M.2/fixture"

// A shell call waiting for permission; its tool input lives in message `msg_tool`.
export const shellPermission = {
  id: "per_shell",
  sessionID: "ses_mini",
  action: "shell",
  resources: ["ls -la"],
  save: ["ls *"],
  source: { type: "tool", messageID: "msg_tool", id: "tool_1" },
}

// A request that saves nothing, so it offers no "Always allow".
export const fetchPermission = {
  id: "per_fetch",
  sessionID: "ses_mini",
  action: "webfetch",
  resources: ["https://example.com"],
  metadata: { url: "https://example.com" },
}

export const deployForm = {
  id: "frm_deploy",
  sessionID: "ses_mini",
  title: "Deploy the build",
  metadata: { message: "Pick where the build goes." },
  fields: [
    { type: "boolean", key: "confirm", title: "Run the deploy?", required: true },
    {
      type: "string",
      key: "target",
      title: "Target",
      options: [
        { value: "staging", label: "Staging", description: "the test cluster" },
        { value: "prod", label: "Production" },
      ],
    },
  ],
}

export const nameForm = {
  id: "frm_name",
  sessionID: "ses_mini",
  title: "Name the release",
  fields: [{ type: "string", key: "name", title: "Release name", required: true }],
}

const toolMessage = {
  id: "msg_tool",
  type: "assistant",
  sessionID: "ses_mini",
  agent: "build",
  model: { providerID: "demo", id: "model" },
  content: [
    {
      type: "tool",
      id: "tool_1",
      name: "shell",
      state: { status: "running", input: { command: "ls -la", description: "List files" }, metadata: {} },
      time: { created: 40 },
    },
  ],
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 40 },
}

type Script = Parameters<typeof base>[0] & {
  permissions?: unknown[]
  forms?: unknown[]
}

const last = (entry: Logged) => entry.path.split("/").at(-1) ?? ""

export function server(script: Script = {}): Options {
  const options = base(script)
  const routes: Route[] = [
    { path: "/api/session/ses_mini/permission", json: { data: script.permissions ?? [] } },
    { path: "/api/session/ses_mini/form", json: { data: script.forms ?? [] } },
    { path: "/api/session/ses_mini/message/msg_tool", json: { data: toolMessage } },
    {
      method: "POST",
      path: "/api/session/ses_mini/permission/:id/reply",
      status: 204,
      then: (entry: Logged) => [event("permission.replied", { requestID: entry.path.split("/").at(-2) })],
    },
    {
      method: "POST",
      path: "/api/session/ses_mini/form/:id/reply",
      status: 204,
      then: (entry: Logged) => [event("form.replied", { id: entry.path.split("/").at(-2) })],
    },
    {
      method: "DELETE",
      path: "/api/session/ses_mini/form/:id",
      status: 204,
      then: (entry: Logged) => [event("form.cancelled", { id: last(entry) })],
    },
    {
      method: "PATCH",
      path: "/api/session/ses_mini/inbox/:id",
      status: 204,
      then: (entry: Logged) => [
        event("session.inbox.delivery.changed", {
          inboxID: last(entry),
          delivery: (entry.body as { delivery: string }).delivery,
        }),
      ],
    },
    {
      method: "DELETE",
      path: "/api/session/ses_mini/inbox/:id",
      status: 204,
      then: (entry: Logged) => [event("session.inbox.cancelled", { inboxID: last(entry) })],
    },
  ]
  return { ...options, routes: [...routes, ...(options.routes ?? [])] }
}
