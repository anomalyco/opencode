// Sessions and routes the C.2 (`session`) scenarios share. Times are fixed epoch milliseconds; both
// clients format them in the machine's time zone.
import path from "node:path"
import type { Route } from "../../lib/fake-server"

export const directory = "/srv/project/app"

export function session(id: string, title: string | null | undefined, updated: number) {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated - 60_000, updated },
    location: { directory },
  }
}

export const sessions = [
  session("ses_aaaaaaaa0001", "Fix the parser", 1_762_268_645_123),
  session("ses_bbbbbbbb0002", "Tabs\tand\nnewlines", 1_762_230_000_000),
  session("ses_cccccccc0003", undefined, 1_700_000_000_000),
]

export const location: Route = {
  path: "/api/location",
  json: { directory, project: { id: "proj_test", directory: "/srv/project", canonical: "/srv/project" } },
}

export function list(data: unknown[]): Route {
  return { path: "/api/session", json: { location: location.json, data, cursor: {} } }
}

export const exported = {
  info: sessions[0],
  messages: [{ id: "msg_aaaaaaaa0001", role: "user", text: "hello" }],
}

export function exportRoute(): Route {
  return { path: "/api/experimental/session/:id/export", json: { data: exported } }
}

// A transcript file for `session import`, with a `location` the command replaces in place.
export const importFile = path.join(import.meta.dir, "import.json")
