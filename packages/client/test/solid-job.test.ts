import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type JobInfo, type OpenCodeEvent } from "../src/promise"

const job = (id: string, status: JobInfo["status"] = "running", sessionID = "ses_root"): JobInfo => ({
  kind: "codemode",
  id,
  sessionID,
  status,
  time: { started: 1 },
})

function setup() {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  // Each job list request waits on a deferred the test resolves; `request()` hands over the next one once it arrives.
  const arrived: PromiseWithResolvers<JobInfo[]>[] = []
  const waiting: ((list: PromiseWithResolvers<JobInfo[]>) => void)[] = []
  let requests = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL((input instanceof Request ? input : new Request(input, init)).url)
      if (!url.pathname.includes("/job")) return Response.json({ data: [] })
      expect(url.searchParams.get("sessionID")).toBe("ses_root")
      expect(url.searchParams.get("status")).toBe("running")
      requests++
      const list = Promise.withResolvers<JobInfo[]>()
      const waiter = waiting.shift()
      if (waiter) waiter(list)
      else arrived.push(list)
      return Response.json({ data: await list.promise })
    },
  })
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  const update = (info: JobInfo) =>
    emit({ id: `evt_${info.id}_${info.status}`, created: 2, type: "experimental.job.updated", data: { info } })
  const root = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: (handler) => (listeners.add(handler), () => listeners.delete(handler)) },
      connection: { status: () => "connected" },
      onError: () => {},
    }),
    dispose,
  }))
  const ids = () => root.data.job.list("ses_root").map((item) => item.id)
  const request = () =>
    arrived.shift() ?? new Promise<PromiseWithResolvers<JobInfo[]>>((resolve) => waiting.push(resolve))
  const respond = async (data: JobInfo[]) => (await request()).resolve(data)
  return { ...root, emit, update, ids, request, respond, requests: () => requests }
}

test("lists a tree's running jobs, including ones whose session isn't loaded, and follows job events", async () => {
  const { data, dispose, update, ids, respond } = setup()
  try {
    update(job("job_stale"))
    const synced = data.job.sync("ses_root")
    await respond([job("job_listed"), job("job_grandchild", "running", "ses_grandchild")])
    await synced
    expect(ids()).toEqual(["job_listed", "job_grandchild"])

    update(job("job_live"))
    expect(ids()).toEqual(["job_listed", "job_grandchild", "job_live"])
    update(job("job_grandchild", "completed", "ses_grandchild"))
    update(job("job_listed", "cancelled"))
    expect(ids()).toEqual(["job_live"])
  } finally {
    dispose()
  }
})

test("applies job events that arrive while the list is in flight", async () => {
  const { data, dispose, update, ids, request } = setup()
  try {
    const synced = data.job.sync("ses_root")
    const list = await request()
    update(job("job_started"))
    update(job("job_settled", "completed"))
    list.resolve([job("job_settled")])
    await synced
    expect(ids()).toEqual(["job_started"])
  } finally {
    dispose()
  }
})

test("re-lists on reconnect, pruning jobs that settled while away, and forgets a deleted tree", async () => {
  const { data, dispose, emit, ids, respond, requests } = setup()
  try {
    const synced = data.job.sync("ses_root")
    await respond([job("job_a"), job("job_b")])
    await synced
    expect(ids()).toEqual(["job_a", "job_b"])

    emit({ id: "evt_connected", created: 3, type: "server.connected", data: {} } as OpenCodeEvent)
    await respond([job("job_b")])
    // The reconnect's list is in flight, so this joins it instead of starting another.
    await data.job.sync("ses_root")
    expect(ids()).toEqual(["job_b"])
    expect(requests()).toBe(2)

    emit({
      id: "evt_deleted",
      created: 4,
      type: "session.deleted",
      durable: { aggregateID: "ses_root", seq: 1, version: 1 },
      data: { sessionID: "ses_root" },
    } as OpenCodeEvent)
    expect(ids()).toEqual([])
    emit({ id: "evt_connected_2", created: 5, type: "server.connected", data: {} } as OpenCodeEvent)
    // The reconnect starts its reads together; once its VCS read settles, a job list would have been requested too.
    await data.location.vcs.sync().catch(() => undefined)
    expect(requests()).toBe(2)
  } finally {
    dispose()
  }
})
