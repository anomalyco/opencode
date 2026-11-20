import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "@opencode/client/solid"
import { OpenCode, type JobInfo, type OpenCodeEvent } from "@opencode/client/promise"
import { running } from "./project-avatar-state"
import { createDesktopData } from "@/runtime/server/data"

const job = (id: string, sessionID: string, status: JobInfo["status"] = "running"): JobInfo => ({
  kind: "codemode",
  id,
  sessionID,
  status,
  time: { started: 1 },
})

const parents = new Map([
  ["ses_root", undefined],
  ["ses_child", "ses_root"],
])

function setup(jobs: JobInfo[]) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const lists: URLSearchParams[] = []
  const gets: string[] = []

  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL((input instanceof Request ? input : new Request(input, init)).url)

        if (url.pathname.includes("/job")) {
          lists.push(url.searchParams)

          return Response.json({ data: jobs })
        }

        const id = url.pathname.split("/").find((part) => parents.has(part))

        if (!id) return Response.json({ data: [] })

        gets.push(id)

        return Response.json({
          data: {
            id,
            parentID: parents.get(id),
            projectID: "project",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            location: { directory: "/project" },
          },
        })
      },
      { preconnect: () => {} },
    ),
  })

  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))

  const root = createRoot((dispose) => {
    const source = createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: (handler) => (listeners.add(handler), () => listeners.delete(handler)) },
      connection: { status: () => "connected" },
      onError: () => {},
    })

    // As the server runtime does, once per server.
    void source.job.syncRunning().catch(() => undefined)

    const data = createDesktopData({ data: source, remove: async () => {} })

    return { data, dispose }
  })

  return { ...root, emit, lists, gets }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test("one server-wide request serves every row", async () => {
  const { data, dispose, lists } = setup([])

  try {
    const roots = ["ses_a", "ses_b", "ses_c", "ses_d", "ses_e"]
    roots.forEach((id) => running(data, id, true))
    await settle()
    roots.forEach((id) => expect(running(data, id, true)).toBe(false))
    expect(lists).toHaveLength(1)
    expect(lists[0].get("sessionID")).toBeNull()
    expect(lists[0].get("status")).toBe("running")
  } finally {
    dispose()
  }
})

test("a job owned by an unloaded child spins its root once the child loads, and stops when it settles", async () => {
  const { data, dispose, emit, lists, gets } = setup([job("job_shell", "ses_child")])

  try {
    expect(running(data, "ses_root", true)).toBe(false)
    await settle()
    expect(gets).toContain("ses_child")
    expect(data.session.status("ses_child")).not.toBe("running")
    expect(running(data, "ses_root", true)).toBe(true)

    // SAFETY: the test emits the event shapes the client's handler reads.

    emit({
      id: "evt_settled",
      created: 2,
      type: "experimental.job.updated",
      data: { info: job("job_shell", "ses_child", "completed") },
    } as OpenCodeEvent)
    expect(running(data, "ses_root", true)).toBe(false)

    // SAFETY: the test emits the event shapes the client's handler reads.

    emit({ id: "evt_connected", created: 3, type: "server.connected", data: {} } as OpenCodeEvent)
    await settle()
    expect(lists).toHaveLength(2)
  } finally {
    dispose()
  }
})
