// A session the home prompt creates (D131): the fake server echoes the ID the client minted, answers the session's
// reads, and admits the prompt; nothing replies. Without `session.renamed` the session stays untitled, as when the
// server generates no title.
import type { Logged, Options } from "../../lib/fake-server"
import { catalog, inbox } from "../C.13/catalog"

const location = { directory: "/tmp/opencode/packages/tui" }

function info(id: string) {
  return {
    id,
    projectID: "proj_test",
    agent: "build",
    model: { providerID: "demo", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    location,
  }
}

const id = (entry: Logged) => entry.path.split("/")[3]

// With `title`, the server publishes `session.renamed` once it has admitted the prompt, as after generating a title.
export function server(title?: string): Options {
  return {
    fallback: "tui",
    routes: [
      // In place of the fallback's stream, which `then` does not reach.
      { path: "/api/event", events: [{ id: "evt_connected", type: "server.connected", data: {} }] },
      ...catalog,
      { method: "POST", path: "/api/session", json: (entry: Logged) => ({ data: info((entry.body as { id: string }).id) }) },
      { path: "/api/session/:id", json: (entry: Logged) => ({ data: info(id(entry)) }) },
      { path: "/api/session/:id/message", json: { data: [], cursor: {} } },
      { path: "/api/session/:id/inbox", json: { data: [] } },
      {
        method: "POST",
        path: "/api/session/:id/prompt",
        json: (entry: Logged) => ({ data: inbox(id(entry)) }),
        then: (entry) => (title ? [renamed(id(entry), title)] : []),
        thenDelay: 500,
      },
    ],
  }
}

function renamed(sessionID: string, title: string) {
  return {
    id: "evt_renamed",
    created: 3,
    type: "session.renamed",
    location,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, title },
  }
}

// Without animations the running session's spinner holds still, so the screen settles.
export const config = JSON.stringify({
  experimental: { "new-designs": true },
  animations: false,
  debug: { devtools: false },
})

export const masks = [{ pattern: /ses_[0-9A-Za-z]+/g, reason: "the session ID the client mints" }]
