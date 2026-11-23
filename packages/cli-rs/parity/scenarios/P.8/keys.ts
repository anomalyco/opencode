// The session of `host-keys`: a session whose prompt can be sent, as a primary agent and a model are loaded, and the
// keys that type into it and send it.
import { assistant, session, user } from "../../lib/app"

const id = "ses_d"
const location = { directory: "/tmp/opencode/packages/tui" }

export const keysApp = {
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Run it", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Run it", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Ran.", 2000), user("msg_1", "Run it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: `/api/session/${id}/prompt`, json: { data: { id: "inb_1" } } },
    { method: "POST", path: `/api/session/${id}/agent`, status: 204 },
    { method: "POST", path: `/api/session/${id}/model`, status: 204 },
    {
      path: "/api/agent",
      json: {
        location,
        data: [
          {
            id: "build",
            name: "build",
            mode: "primary",
            hidden: false,
            permissions: [],
            request: { settings: {}, headers: {}, body: {} },
          },
        ],
      },
    },
    {
      path: "/api/model",
      json: {
        location,
        data: [
          {
            id: "model",
            modelID: "model",
            providerID: "provider",
            name: "Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [],
            time: { released: 0 },
            cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
            status: "active",
            enabled: true,
            limit: { context: 200000, output: 32000 },
          },
        ],
      },
    },
  ],
  // `r` and a space typed, then Enter, which sends the prompt: the requests compared hold its POST with the text. No
  // checkpoint follows it, as the host shows a prompt being sent differently from TS with no plugin at all (TS clears
  // the composer and shows the message at once; the Rust client keeps the text until the server answers).
  steps: [
    { checkpoint: "session", until: "Ran." },
    { type: "refresh" },
    { keys: ["space"] },
    { type: "rr" },
    { checkpoint: "typed", until: "refresh rr" },
    { keys: ["enter"] },
  ],
}
