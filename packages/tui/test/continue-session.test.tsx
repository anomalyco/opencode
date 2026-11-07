import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "project", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

const resumed = {
  id: "ses_resumed",
  title: "Resumed session",
  projectID: "project",
  location: { directory: location.directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

// `--continue` asks the server for the newest session after mount, so the launch route carries a
// placeholder id for a moment. The server rejects ids that are not sessions, so nothing may
// request it.
async function launch(options: { sessions?: readonly unknown[]; status?: number } = {}) {
  const requested: string[] = []
  const resumedRequested = Promise.withResolvers<void>()
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { continue: true },
    fetch: async (url, request) => {
      requested.push(url.pathname)
      if (url.pathname === "/api/session" && request.method === "GET") {
        if (options.status) return json({ message: "list failed" }, { status: options.status })
        return json({ data: options.sessions ?? [], cursor: {} })
      }
      if (url.pathname === `/api/session/${resumed.id}`) return json({ data: resumed })
      if (url.pathname === `/api/session/${resumed.id}/message`) {
        resumedRequested.resolve()
        return json({ data: [], cursor: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname)) return json({ data: [] })
      if (/^\/api\/session\/[^/]+\/form$/.test(url.pathname)) return json({ data: [] })
      return undefined
    },
  })
  return { setup, requested, resumedRequested: resumedRequested.promise }
}

function placeholderRequests(requested: readonly string[]) {
  return requested.filter((path) => path.split("/").includes("pending"))
}

test("--continue without a session opens the home screen", async () => {
  const started = await launch()
  await using setup = started.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Ask anything"))
  expect(placeholderRequests(started.requested)).toEqual([])
})

test("--continue resumes the newest session in the location", async () => {
  const started = await launch({ sessions: [resumed] })
  await using setup = started.setup

  await setup.ready
  await started.resumedRequested
  expect(placeholderRequests(started.requested)).toEqual([])
})

test("--continue opens the home screen when the session list fails", async () => {
  const started = await launch({ status: 500 })
  await using setup = started.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Ask anything"))
  expect(placeholderRequests(started.requested)).toEqual([])
})
