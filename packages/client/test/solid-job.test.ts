import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type JobInfo, type OpenCodeEvent } from "../src/promise"

const job = (id: string, status: JobInfo["status"] = "running"): JobInfo => ({
  kind: "codemode",
  id,
  sessionID: "ses_root",
  status,
  time: { started: 1 },
})

test("lists running jobs for a session tree and keeps them current from job events", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL((input instanceof Request ? input : new Request(input, init)).url)
      requests.push(url)
      return Response.json({ data: [job("job_listed")] })
    },
  })
  const emit = (info: JobInfo) => {
    const event: OpenCodeEvent = {
      id: `evt_${info.id}_${info.status}`,
      created: 2,
      type: "experimental.job.updated",
      data: { info },
    }
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
  }
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: (handler) => (listeners.add(handler), () => listeners.delete(handler)) },
      connection: { status: () => "connected" },
    }),
    dispose,
  }))

  try {
    emit(job("job_stale"))
    await setup.data.job.sync("ses_root")
    expect(requests[0]?.searchParams.get("sessionID")).toBe("ses_root")
    expect(requests[0]?.searchParams.get("status")).toBe("running")
    expect(setup.data.job.list("ses_root").map((item) => item.id)).toEqual(["job_listed"])

    emit(job("job_live"))
    expect(setup.data.job.list("ses_root").map((item) => item.id)).toEqual(["job_listed", "job_live"])
    emit(job("job_listed", "cancelled"))
    expect(setup.data.job.list("ses_root").map((item) => item.id)).toEqual(["job_live"])
  } finally {
    setup.dispose()
  }
})
