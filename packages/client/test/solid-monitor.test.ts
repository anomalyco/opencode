import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type MonitorInfo, type OpenCodeEvent } from "../src/promise"
import { Monitor } from "@opencode/schema/monitor"

const monitor: MonitorInfo = {
  id: "mon_ci",
  sessionID: "ses_ci",
  shellID: "sh_ci",
  description: "CI jobs",
  delivery: "steer",
  log: "/tmp/ci.log",
  startedAt: 1,
  expiresAt: 300001,
  eventCount: 0,
  outputBytes: 0,
  status: "running",
}

function fixture(fetch: () => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({ baseUrl: "http://opencode.local", fetch })
  return createRoot((dispose) => {
    return {
      data: createData({
        api: () => api,
        directory: "/project",
        connection: { status: () => "connected" },
        event: {
          on: () => () => {},
          listen(handler) {
            listeners.add(handler)
            return () => listeners.delete(handler)
          },
        },
      }),
      emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event })),
      dispose,
    }
  })
}

test("monitor stream updates the owning session and retains ended tasks", async () => {
  const setup = fixture(async () => Response.json([]))
  try {
    await setup.data.monitor.sync(monitor.sessionID)
    setup.emit({ id: "evt_start", created: 1, type: "monitor.started", data: { info: monitor } })
    expect(setup.data.monitor.list("ses_other")).toEqual([])
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([monitor])
    const progress = { ...monitor, eventCount: 1, outputBytes: 16 }
    setup.emit({
      id: "evt_output",
      created: 2,
      type: "monitor.event",
      data: { info: progress, lines: ["shard 1 success"] },
    })
    expect(setup.data.monitor.list(monitor.sessionID)[0]?.eventCount).toBe(1)
    const ended = { ...progress, status: "ended" as const, reason: "exited" as const, exitCode: 1, endedAt: 3 }
    setup.emit({ id: "evt_end", created: 3, type: "monitor.ended", data: { info: ended } })
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([ended])
  } finally {
    setup.dispose()
  }
})

test("bounds live ended history while retaining running monitors", async () => {
  const setup = fixture(async () => Response.json([monitor]))
  try {
    await setup.data.monitor.sync(monitor.sessionID)
    for (let index = 0; index < Monitor.ENDED_LIMIT + 5; index++) {
      const info = { ...monitor, id: `mon_${index}`, status: "ended" as const, endedAt: index, startedAt: index }
      setup.emit({ id: `evt_${index}`, created: index, type: "monitor.ended", data: { info } })
    }
    const items = setup.data.monitor.list(monitor.sessionID)
    expect(items).toHaveLength(Monitor.ENDED_LIMIT + 1)
    expect(items.some((info) => info.id === monitor.id && info.status === "running")).toBe(true)
    expect(items.some((info) => info.id === "mon_4")).toBe(false)
    expect(items.some((info) => info.id === "mon_5")).toBe(true)
  } finally {
    setup.dispose()
  }
})

test("monitor events do not retain unopened or evicted session caches", async () => {
  const setup = fixture(async () => Response.json([monitor]))
  const event: OpenCodeEvent = { id: "evt_start", created: 1, type: "monitor.started", data: { info: monitor } }
  try {
    setup.emit(event)
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([])
    await setup.data.monitor.sync(monitor.sessionID)
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([monitor])
    setup.data.session.evict(monitor.sessionID)
    setup.emit(event)
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([])
  } finally {
    setup.dispose()
  }
})

test("a monitor list response cannot repopulate an evicted session", async () => {
  const response = Promise.withResolvers<Response>()
  const setup = fixture(() => response.promise)
  try {
    const read = setup.data.monitor.sync(monitor.sessionID)
    setup.data.session.evict(monitor.sessionID)
    response.resolve(Response.json([monitor]))
    await read
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([])
  } finally {
    response.resolve(Response.json([]))
    setup.dispose()
  }
})

test("an old monitor list response cannot overwrite live progress or exit", async () => {
  const response = Promise.withResolvers<Response>()
  const setup = fixture(() => response.promise)
  try {
    const read = setup.data.monitor.sync(monitor.sessionID)
    const ended = { ...monitor, status: "ended" as const, reason: "expired" as const, eventCount: 3 }
    setup.emit({ id: "evt_end", created: 4, type: "monitor.ended", data: { info: ended } })
    response.resolve(Response.json([monitor]))
    await read
    expect(setup.data.monitor.list(monitor.sessionID)).toEqual([ended])
  } finally {
    response.resolve(Response.json([]))
    setup.dispose()
  }
})

test("invalidating a monitor snapshot reloads server restart status", async () => {
  let snapshot = monitor
  const setup = fixture(async () => Response.json([snapshot]))
  try {
    await setup.data.monitor.sync(monitor.sessionID)
    expect(setup.data.monitor.list(monitor.sessionID)[0]?.status).toBe("running")
    snapshot = { ...monitor, status: "ended", reason: "server_restarted" }
    setup.data.monitor.invalidate(monitor.sessionID)
    await setup.data.monitor.sync(monitor.sessionID)
    expect(setup.data.monitor.list(monitor.sessionID)[0]?.reason).toBe("server_restarted")
  } finally {
    setup.dispose()
  }
})
