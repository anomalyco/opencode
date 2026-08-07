/** @jsxImportSource @opentui/solid */
import { expect, spyOn, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { createEffect, createRoot } from "solid-js"
import { tmpdir } from "../../../fixture/fixture"
import type { FetchHandler } from "../../../fixture/tui-sdk"
import { directory, json, mount } from "./sync-fixture"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => (resolvePromise = resolve))
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error("deferred promise is not initialized")
      resolvePromise(value)
    },
  }
}

function observe(check: () => boolean) {
  return new Promise<void>((resolve) =>
    createRoot((dispose) =>
      createEffect(() => {
        if (!check()) return
        dispose()
        resolve()
      }),
    ),
  )
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function connected(id: string) {
  return global({ id, type: "server.connected", properties: {} })
}

function session(id: string, title: string, parentID?: string) {
  return {
    id,
    slug: id,
    projectID: "proj_test",
    title,
    parentID,
    time: { created: 0, updated: 0 },
    version: "1.18.3",
    directory,
  }
}

function message(sessionID: string, id: string, completed = true) {
  return {
    id,
    sessionID,
    role: "assistant" as const,
    agent: "build",
    modelID: "model",
    providerID: "test",
    mode: "build",
    parentID: "msg_user",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, ...(completed ? { completed: 2 } : {}) },
  }
}

function payload(sessionID: string, id: string, text: string) {
  return [{ info: message(sessionID, id), parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text }] }]
}

async function scenario(
  override: FetchHandler | undefined,
  run: (app: Awaited<ReturnType<typeof mount>>) => Promise<void>,
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const app = await mount(override, tmp.path)
  try {
    await run(app)
  } finally {
    app.app.renderer.destroy()
  }
}

test("later connection epochs repair all loaded domains without changing initial counts", async () => {
  const parentID = "ses_parent"
  const childID = "ses_child"
  const counts = new Map<string, number>()
  const listed = deferred<void>()
  const forced = new Map([parentID, childID].map((id) => [id, deferred<void>()]))
  let current: "initial" | "reconnected" = "initial"
  const sessions = () => [session(parentID, `${current} parent`), session(childID, `${current} child`, parentID)]
  await scenario(
    (url) => {
      const count = (counts.get(url.pathname) ?? 0) + 1
      counts.set(url.pathname, count)
      if (url.pathname === "/session") {
        if (count === 2) listed.resolve()
        return json(sessions())
      }
      if (url.pathname === "/session/status")
        return json({ [parentID]: { type: current === "initial" ? "idle" : "busy" }, [childID]: { type: "idle" } })
      for (const id of [parentID, childID]) {
        if (url.pathname === `/session/${id}`) return json(sessions().find((item) => item.id === id))
        if (url.pathname === `/session/${id}/message`) {
          if (count === 2) forced.get(id)?.resolve()
          if (current === "initial") return json(payload(id, `msg_${id}_old`, "old"))
          return json(
            Array.from(
              { length: id === parentID ? 101 : 1 },
              (_, index) => payload(id, `msg_${id}_${String(index).padStart(3, "0")}`, `new ${index}`)[0],
            ),
          )
        }
        if (url.pathname === `/session/${id}/todo`)
          return json([{ content: current, status: "pending", priority: "high" }])
        if (url.pathname === `/session/${id}/diff`)
          return json([{ file: `${current}.ts`, patch: current, additions: 1, deletions: 0, status: "modified" }])
      }
    },
    async ({ emit, sync }) => {
      await Promise.all([sync.session.sync(parentID), sync.session.sync(childID)])
      const initial = new Map(counts)
      emit(connected("initial"))
      await Promise.resolve()
      expect(counts).toEqual(initial)
      current = "reconnected"
      emit(connected("reconnect"))
      await Promise.all([listed.promise, ...[...forced.values()].map((item) => item.promise)])
      await Promise.all([sync.session.sync(parentID), sync.session.sync(childID)])
      expect(counts.get("/session")).toBe(2)
      for (const id of [parentID, childID])
        expect(["", "/message", "/todo", "/diff"].map((suffix) => counts.get(`/session/${id}${suffix}`))).toEqual([
          2, 2, 2, 2,
        ])
      expect([sync.session.get(parentID)?.title, sync.session.get(childID)?.parentID]).toEqual([
        "reconnected parent",
        parentID,
      ])
      expect(sync.data.session_status[parentID]).toEqual({ type: "busy" })
      expect(sync.data.todo[parentID]).toEqual([{ content: "reconnected", status: "pending", priority: "high" }])
      expect(sync.data.session_diff[parentID]).toEqual([
        { file: "reconnected.ts", patch: "reconnected", additions: 1, deletions: 0, status: "modified" },
      ])
      expect(sync.data.message[parentID]).toHaveLength(100)
      expect(sync.data.message[parentID][0]?.id).toBe(`msg_${parentID}_001`)
      expect(sync.data.part[`msg_${parentID}_old`]).toBeUndefined()
      expect(sync.data.part[`msg_${parentID}_000`]).toBeUndefined()
      expect(sync.data.part[`msg_${parentID}_100`]?.[0]).toMatchObject({ text: "new 100" })
      expect(sync.data.part[`msg_${childID}_000`]?.[0]).toMatchObject({ text: "new 0" })
    },
  )
})

test("reconnect waits for old hydration and live updates win over stale responses", async () => {
  const id = "ses_inflight"
  const messageID = "msg_inflight"
  const old = deferred<Response>()
  const forced = deferred<Response>()
  const listed = deferred<void>()
  const forceRequested = deferred<void>()
  let lists = 0
  let messages = 0
  await scenario(
    (url) => {
      if (url.pathname === "/session") {
        if (++lists === 2) listed.resolve()
        return json([session(id, "current")])
      }
      if (url.pathname === `/session/${id}`) return json(session(id, "current"))
      if (url.pathname === `/session/${id}/message`)
        return ++messages === 1 ? old.promise : (forceRequested.resolve(), forced.promise)
      if (url.pathname === `/session/${id}/todo` || url.pathname === `/session/${id}/diff`) return json([])
    },
    async ({ emit, sync }) => {
      const oldHydration = sync.session.sync(id)
      emit(connected("initial"))
      emit(connected("reconnect"))
      await listed.promise
      expect(messages).toBe(1)
      const livePart = {
        id: `prt_${messageID}`,
        sessionID: id,
        messageID,
        type: "text" as const,
        text: "live before force",
      }
      const live = observe(() => sync.data.part[messageID]?.[0]?.type === "text")
      emit(
        global({
          id: "message",
          type: "message.updated",
          properties: { sessionID: id, info: { ...message(id, messageID, false), time: { created: 10 } } },
        }),
      )
      emit(
        global({ id: "part", type: "message.part.updated", properties: { sessionID: id, time: 10, part: livePart } }),
      )
      await live
      old.resolve(json(payload(id, messageID, "stale old")))
      await Promise.all([oldHydration, forceRequested.promise])
      const forceLive = observe(
        () =>
          sync.data.part[messageID]?.[0]?.type === "text" && sync.data.part[messageID][0].text === "live during force",
      )
      emit(
        global({
          id: "force-part",
          type: "message.part.updated",
          properties: { sessionID: id, time: 11, part: { ...livePart, text: "live during force" } },
        }),
      )
      await forceLive
      forced.resolve(json(payload(id, messageID, "stale force")))
      await sync.session.sync(id)
      expect(messages).toBe(2)
      expect(sync.data.message[id]).toHaveLength(1)
      expect(sync.data.part[messageID]?.[0]).toMatchObject({ text: "live during force" })
    },
  )
})

test("bootstrap and session failures isolate and remain route and epoch retryable", async () => {
  const failedID = "ses_failed"
  const healthyID = "ses_healthy"
  const gets = new Map<string, number>()
  const requested = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()]
  let reconnecting = false
  let recover = false
  let lists = 0
  await scenario(
    (url) => {
      if (url.pathname === "/session") {
        if (++lists === 2) requested[0].resolve()
        return json([session(failedID, recover ? "recovered" : "failed"), session(healthyID, "healthy")])
      }
      if (url.pathname === "/config/providers" && reconnecting && !recover) return json({}, { status: 500 })
      for (const id of [failedID, healthyID]) {
        if (url.pathname === `/session/${id}`) {
          const count = (gets.get(id) ?? 0) + 1
          gets.set(id, count)
          if (count === 2) requested[id === failedID ? 1 : 2].resolve()
          if (id === failedID && count === 4) requested[3].resolve()
          if (id === failedID && reconnecting && !recover) return json({}, { status: 500 })
          return json(session(id, recover ? "recovered" : id))
        }
        if (url.pathname === `/session/${id}/message`) return json(payload(id, `msg_${id}`, id))
        if (url.pathname === `/session/${id}/todo` || url.pathname === `/session/${id}/diff`) return json([])
      }
    },
    async ({ emit, sync }) => {
      await Promise.all([sync.session.sync(failedID), sync.session.sync(healthyID)])
      emit(connected("initial"))
      reconnecting = true
      emit(connected("reconnect"))
      await Promise.all(requested.slice(0, 3).map((item) => item.promise))
      await expect(sync.session.sync(failedID)).rejects.toBeDefined()
      await expect(sync.session.sync(healthyID)).resolves.toBeUndefined()
      await expect(sync.session.sync(failedID)).rejects.toBeDefined()
      expect(gets.get(failedID)).toBe(3)
      recover = true
      emit(connected("retry"))
      await requested[3].promise
      await sync.session.sync(failedID)
      expect(gets.get(failedID)).toBe(4)
      expect(sync.session.get(failedID)?.title).toBe("recovered")
      expect(sync.data.message[healthyID]?.[0]?.id).toBe(`msg_${healthyID}`)
    },
  )
})

test("ordinary session refresh replaces only the session list", async () => {
  const id = "ses_refresh_omitted"
  let omitted = false
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json(omitted ? [] : [session(id, "present")])
      if (url.pathname === "/session/status") return json({ [id]: { type: "busy" } })
      if (url.pathname === `/session/${id}`) return json(session(id, "present"))
      if (url.pathname === `/session/${id}/message`) return json(payload(id, "msg_refresh", "present"))
      if (url.pathname === `/session/${id}/todo`)
        return json([{ content: "present", status: "pending", priority: "high" }])
      if (url.pathname === `/session/${id}/diff`)
        return json([{ file: "present.ts", patch: "present", additions: 1, deletions: 0, status: "modified" }])
    },
    async ({ sync }) => {
      await sync.session.sync(id)
      sync.set("permission", id, [])
      sync.set("question", id, [])
      omitted = true
      await sync.session.refresh()

      expect(sync.session.get(id)).toBeUndefined()
      expect(sync.data.session_status[id]).toEqual({ type: "busy" })
      expect(sync.data.permission[id]).toEqual([])
      expect(sync.data.question[id]).toEqual([])
      expect(sync.data.message[id]?.[0]?.id).toBe("msg_refresh")
      expect(sync.data.part.msg_refresh?.[0]).toMatchObject({ text: "present" })
      expect(sync.data.todo[id]).toEqual([{ content: "present", status: "pending", priority: "high" }])
      expect(sync.data.session_diff[id]).toEqual([
        { file: "present.ts", patch: "present", additions: 1, deletions: 0, status: "modified" },
      ])
    },
  )
})

test("ordinary session refresh tolerates list HTTP failures", async () => {
  const id = "ses_refresh_failure"
  let failing = false
  await scenario(
    (url) => {
      if (url.pathname === "/session") return failing ? json({}, { status: 500 }) : json([session(id, "present")])
    },
    async ({ sync }) => {
      failing = true
      const outcome = await sync.session.refresh().then(
        () => "resolved" as const,
        () => "rejected" as const,
      )
      expect(outcome).toBe("resolved")
    },
  )
})

test("default bootstrap keeps tolerant status semantics", async () => {
  const id = "ses_bootstrap_policy"
  let failing = false
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json([session(id, "present")])
      if (url.pathname === "/session/status")
        return failing ? json({}, { status: 500 }) : json({ [id]: { type: "idle" } })
    },
    async ({ sync }) => {
      const reports: string[] = []
      const error = spyOn(console, "error").mockImplementation((message) => {
        if (typeof message === "string") reports.push(message)
      })
      try {
        failing = true
        await sync.bootstrap({ wait: true })
        expect(reports).toEqual([])
        expect(sync.data.session_status[id]).toBeUndefined()
      } finally {
        error.mockRestore()
      }
    },
  )
})

test("session list snapshot governs status in either settlement order", async () => {
  const id = "ses_status_order"
  const firstList = Promise.withResolvers<Response>()
  const firstStatusRequested = Promise.withResolvers<void>()
  const secondListRequested = Promise.withResolvers<void>()
  const secondStatus = Promise.withResolvers<Response>()
  let phase: "initial" | "status-first" | "list-first" = "initial"
  await scenario(
    (url) => {
      if (url.pathname === "/session") {
        if (phase === "status-first") return firstList.promise
        if (phase === "list-first") {
          secondListRequested.resolve()
          return json([])
        }
        return json([session(id, "present")])
      }
      if (url.pathname === "/session/status") {
        if (phase === "status-first") {
          firstStatusRequested.resolve()
          return json({ [id]: { type: "busy" } })
        }
        if (phase === "list-first") return secondStatus.promise
        return json({ [id]: { type: "idle" } })
      }
    },
    async ({ sync }) => {
      phase = "status-first"
      const first = sync.bootstrap({ wait: true, fatal: false, report: false, recovery: true })
      await firstStatusRequested.promise
      firstList.resolve(json([session(id, "present")]))
      await first
      expect(sync.data.session_status[id]).toEqual({ type: "busy" })

      phase = "list-first"
      const second = sync.bootstrap({ wait: true, fatal: false, report: false, recovery: true })
      await secondListRequested.promise
      expect(sync.session.get(id)?.title).toBe("present")
      secondStatus.resolve(json({ [id]: { type: "busy" } }))
      await second
      expect(sync.session.get(id)).toBeUndefined()
      expect(sync.data.session_status[id]).toBeUndefined()
    },
  )
})

test("reconnect status failure preserves sessions and dependent state", async () => {
  const id = "ses_status_failure"
  const statusFailed = Promise.withResolvers<void>()
  const reconnectFailed = Promise.withResolvers<void>()
  let recovering = false
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json(recovering ? [] : [session(id, "present")])
      if (url.pathname === "/session/status") {
        if (!recovering) return json({ [id]: { type: "busy" } })
        statusFailed.resolve()
        return json({}, { status: 500 })
      }
      if (url.pathname === `/session/${id}`) return json(session(id, "present"))
      if (url.pathname === `/session/${id}/message`) return json(payload(id, "msg_status_failure", "present"))
      if (url.pathname === `/session/${id}/todo`)
        return json([{ content: "present", status: "pending", priority: "high" }])
      if (url.pathname === `/session/${id}/diff`)
        return json([{ file: "present.ts", patch: "present", additions: 1, deletions: 0, status: "modified" }])
    },
    async ({ emit, sync }) => {
      await sync.session.sync(id)
      sync.set("permission", id, [])
      sync.set("question", id, [])
      emit(connected("initial"))
      const error = spyOn(console, "error").mockImplementation((message) => {
        if (message === "tui reconnect reconciliation failed") reconnectFailed.resolve()
      })
      try {
        recovering = true
        emit(connected("status-failed"))
        await Promise.all([statusFailed.promise, reconnectFailed.promise])
      } finally {
        error.mockRestore()
      }

      expect(sync.session.get(id)?.title).toBe("present")
      expect(sync.data.session_status[id]).toEqual({ type: "busy" })
      expect(sync.data.permission[id]).toEqual([])
      expect(sync.data.question[id]).toEqual([])
      expect(sync.data.message[id]?.[0]?.id).toBe("msg_status_failure")
      expect(sync.data.part.msg_status_failure?.[0]).toMatchObject({ text: "present" })
      expect(sync.data.todo[id]).toEqual([{ content: "present", status: "pending", priority: "high" }])
      expect(sync.data.session_diff[id]).toEqual([
        { file: "present.ts", patch: "present", additions: 1, deletions: 0, status: "modified" },
      ])
    },
  )
})

for (const domain of ["message", "todo", "diff"] as const) {
  test(`forced ${domain} failure preserves every session domain`, async () => {
    const id = `ses_${domain}_failure`
    const failure = Promise.withResolvers<Response>()
    const requested = Promise.withResolvers<void>()
    let failing = false
    await scenario(
      (url) => {
        if (url.pathname === "/session") return json([session(id, "initial")])
        if (url.pathname === "/session/status") return json({ [id]: { type: "idle" } })
        if (url.pathname === `/session/${id}`) return json(session(id, failing ? "failed" : "initial"))
        if (url.pathname === `/session/${id}/${domain}` && failing) {
          requested.resolve()
          return failure.promise
        }
        const value = failing ? "failed" : "initial"
        if (url.pathname === `/session/${id}/message`) return json(payload(id, `msg_${value}`, value))
        if (url.pathname === `/session/${id}/todo`)
          return json([{ content: value, status: "pending", priority: "high" }])
        if (url.pathname === `/session/${id}/diff`)
          return json([{ file: `${value}.ts`, patch: value, additions: 1, deletions: 0, status: "modified" }])
      },
      async ({ emit, sync }) => {
        await sync.session.sync(id)
        emit(connected("initial"))
        failing = true
        emit(connected(`failed-${domain}`))
        await requested.promise
        const joined = sync.session.sync(id)
        failure.resolve(json({}, { status: 500 }))
        const outcome = await joined.then(
          () => "resolved" as const,
          () => "rejected" as const,
        )
        expect({
          outcome,
          title: sync.session.get(id)?.title,
          messageID: sync.data.message[id]?.[0]?.id,
          part: sync.data.part.msg_initial?.[0]?.type === "text" ? sync.data.part.msg_initial[0].text : undefined,
          todo: sync.data.todo[id]?.[0]?.content,
          diff: sync.data.session_diff[id]?.[0]?.file,
        }).toEqual({
          outcome: "rejected",
          title: "initial",
          messageID: "msg_initial",
          part: "initial",
          todo: "initial",
          diff: "initial.ts",
        })
      },
    )
  })
}

test("HTTP failures preserve every reconnect domain and remain retryable", async () => {
  const id = "ses_http_failure"
  const bootstrapRequests = new Set<string>()
  const failedRequests = new Set<string>()
  const domainCounts = new Map<string, number>()
  const bootstrapFailed = Promise.withResolvers<void>()
  const reconnectFailed = Promise.withResolvers<void>()
  const domainsFailed = Promise.withResolvers<void>()
  const bootstrapPaths = new Set(["/session", "/session/status"])
  const domainPaths = new Set([`/session/${id}/message`, `/session/${id}/todo`, `/session/${id}/diff`])
  const forceFailures = new Map([...domainPaths].map((pathname) => [pathname, Promise.withResolvers<Response>()]))
  let phase: "initial" | "bootstrap-failed" | "domains-failed" | "recovered" = "initial"
  await scenario(
    (url) => {
      if (domainPaths.has(url.pathname)) domainCounts.set(url.pathname, (domainCounts.get(url.pathname) ?? 0) + 1)
      if (phase === "bootstrap-failed" && bootstrapPaths.has(url.pathname)) {
        bootstrapRequests.add(url.pathname)
        if (bootstrapRequests.size === bootstrapPaths.size) bootstrapFailed.resolve()
        return json({}, { status: 500 })
      }
      if (phase === "domains-failed" && domainPaths.has(url.pathname)) {
        failedRequests.add(url.pathname)
        if (failedRequests.size === domainPaths.size) domainsFailed.resolve()
        const deferredFailure = forceFailures.get(url.pathname)
        if (domainCounts.get(url.pathname) === 1 && deferredFailure) return deferredFailure.promise
        return json({}, { status: 500 })
      }
      const stable = phase === "recovered" ? "recovered" : "initial"
      const hydration = phase === "domains-failed" ? phase : stable
      if (url.pathname === "/session") return json([session(id, stable)])
      if (url.pathname === "/session/status") return json({ [id]: { type: phase === "recovered" ? "busy" : "idle" } })
      if (url.pathname === `/session/${id}`) return json(session(id, hydration))
      if (url.pathname === `/session/${id}/message`) return json(payload(id, `msg_${hydration}`, hydration))
      if (url.pathname === `/session/${id}/todo`)
        return json([{ content: hydration, status: "pending", priority: "high" }])
      if (url.pathname === `/session/${id}/diff`)
        return json([{ file: `${hydration}.ts`, patch: hydration, additions: 1, deletions: 0, status: "modified" }])
    },
    async ({ emit, sync }) => {
      await sync.session.sync(id)
      emit(connected("initial"))
      const error = spyOn(console, "error").mockImplementation((message) => {
        if (message === "tui reconnect reconciliation failed") reconnectFailed.resolve()
      })
      try {
        phase = "bootstrap-failed"
        emit(connected("bootstrap-failed"))
        await Promise.all([bootstrapFailed.promise, reconnectFailed.promise])
      } finally {
        error.mockRestore()
      }

      expect(sync.session.get(id)?.title).toBe("initial")
      expect(sync.data.session_status[id]).toEqual({ type: "idle" })

      domainCounts.clear()
      phase = "domains-failed"
      emit(connected("domains-failed"))
      await domainsFailed.promise
      const joined = sync.session.sync(id)
      for (const failure of forceFailures.values()) failure.resolve(json({}, { status: 500 }))
      const joinedOutcome = await joined.then(
        () => "resolved" as const,
        () => "rejected" as const,
      )
      expect({
        outcome: joinedOutcome,
        requests: [...domainPaths].map((pathname) => domainCounts.get(pathname)),
      }).toEqual({
        outcome: "rejected",
        requests: [1, 1, 1],
      })

      expect(sync.session.get(id)?.title).toBe("initial")
      expect(sync.data.session_status[id]).toEqual({ type: "idle" })
      expect(sync.data.message[id]?.[0]?.id).toBe("msg_initial")
      expect(sync.data.part.msg_initial?.[0]).toMatchObject({ text: "initial" })
      expect(sync.data.todo[id]).toEqual([{ content: "initial", status: "pending", priority: "high" }])
      expect(sync.data.session_diff[id]).toEqual([
        { file: "initial.ts", patch: "initial", additions: 1, deletions: 0, status: "modified" },
      ])

      const routeOutcome = await sync.session.sync(id).then(
        () => "resolved" as const,
        () => "rejected" as const,
      )
      expect({
        outcome: routeOutcome,
        requests: [...domainPaths].map((pathname) => domainCounts.get(pathname)),
        title: sync.session.get(id)?.title,
        messageID: sync.data.message[id]?.[0]?.id,
        partText: sync.data.part.msg_initial?.[0]?.type === "text" ? sync.data.part.msg_initial[0].text : undefined,
        todo: sync.data.todo[id]?.[0]?.content,
        diff: sync.data.session_diff[id]?.[0]?.file,
      }).toEqual({
        outcome: "rejected",
        requests: [2, 2, 2],
        title: "initial",
        messageID: "msg_initial",
        partText: "initial",
        todo: "initial",
        diff: "initial.ts",
      })

      phase = "recovered"
      await sync.session.sync(id)
      expect({
        requests: [...domainPaths].map((pathname) => domainCounts.get(pathname)),
        title: sync.session.get(id)?.title,
        messageID: sync.data.message[id]?.[0]?.id,
        todo: sync.data.todo[id]?.[0]?.content,
        diff: sync.data.session_diff[id]?.[0]?.file,
      }).toEqual({
        requests: [3, 3, 3],
        title: "recovered",
        messageID: "msg_recovered",
        todo: "recovered",
        diff: "recovered.ts",
      })
      await sync.session.sync(id)
      expect([...domainPaths].map((pathname) => domainCounts.get(pathname))).toEqual([3, 3, 3])
    },
  )
})

test("successful reconnect bootstrap skips a loaded session deleted during the outage", async () => {
  const id = "ses_deleted"
  let deleted = false
  let gets = 0
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json(deleted ? [] : [session(id, "present")])
      if (url.pathname === "/session/status") return json({ [id]: { type: "busy" } })
      if (url.pathname === `/session/${id}`) return ((gets += 1), json(session(id, "present")))
      if (url.pathname === `/session/${id}/message`) return json(payload(id, "msg_deleted", "present"))
      if (url.pathname === `/session/${id}/todo`)
        return json([{ content: "present", status: "pending", priority: "high" }])
      if (url.pathname === `/session/${id}/diff`)
        return json([{ file: "present.ts", patch: "present", additions: 1, deletions: 0, status: "modified" }])
    },
    async ({ emit, sync }) => {
      await sync.session.sync(id)
      sync.set("permission", id, [])
      sync.set("question", id, [])
      sync.set("part", "msg_deleted", [])
      sync.set("part", "msg_orphan", [
        { id: "prt_orphan", sessionID: id, messageID: "msg_orphan", type: "text" as const, text: "orphan" },
      ])
      emit(connected("initial"))
      deleted = true
      const removed = observe(() => sync.data.session.length === 0)
      emit(connected("reconnect"))
      await removed
      await Promise.resolve()
      expect(gets).toBe(1)
      expect(sync.session.get(id)).toBeUndefined()
      expect(sync.data.session_status[id]).toBeUndefined()
      expect(sync.data.message[id]).toBeUndefined()
      expect(sync.data.part.msg_deleted).toBeUndefined()
      expect(sync.data.part.msg_orphan).toBeUndefined()
      expect(sync.data.todo[id]).toBeUndefined()
      expect(sync.data.session_diff[id]).toBeUndefined()
      expect(sync.data.permission[id]).toBeUndefined()
      expect(sync.data.question[id]).toBeUndefined()

      deleted = false
      emit(
        global({
          id: "restored",
          type: "session.updated",
          properties: { sessionID: id, info: session(id, "restored") },
        }),
      )
      await observe(() => sync.session.get(id)?.title === "restored")
      await sync.session.sync(id)
      expect(gets).toBe(2)
    },
  )
})

test("reconnect prunes every adjacent deleted session", async () => {
  const ids = ["ses_deleted_a", "ses_deleted_b"]
  let deleted = false
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json(deleted ? [] : ids.map((id) => session(id, "present")))
      if (url.pathname === "/session/status") return json(Object.fromEntries(ids.map((id) => [id, { type: "busy" }])))
      for (const id of ids) {
        if (url.pathname === `/session/${id}`) return json(session(id, "present"))
        if (url.pathname === `/session/${id}/message`) return json(payload(id, `msg_${id}`, "present"))
        if (url.pathname === `/session/${id}/todo`)
          return json([{ content: "present", status: "pending", priority: "high" }])
        if (url.pathname === `/session/${id}/diff`)
          return json([{ file: `${id}.ts`, patch: "present", additions: 1, deletions: 0, status: "modified" }])
      }
    },
    async ({ emit, sync }) => {
      await Promise.all(ids.map((id) => sync.session.sync(id)))
      emit(connected("initial"))
      deleted = true
      emit(connected("reconnect"))
      await observe(() => sync.data.session.length === 0)

      for (const id of ids) {
        expect(sync.data.session_status[id]).toBeUndefined()
        expect(sync.data.message[id]).toBeUndefined()
        expect(sync.data.part[`msg_${id}`]).toBeUndefined()
        expect(sync.data.todo[id]).toBeUndefined()
        expect(sync.data.session_diff[id]).toBeUndefined()
      }
    },
  )
})

test("deleting a session invalidates in-flight hydration", async () => {
  const id = "ses_deleted_inflight"
  const response = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  await scenario(
    (url) => {
      if (url.pathname === "/session") return json([session(id, "present")])
      if (url.pathname === "/session/status") return json({ [id]: { type: "busy" } })
      if (url.pathname === `/session/${id}`) return json(session(id, "stale"))
      if (url.pathname === `/session/${id}/message`) {
        requested.resolve()
        return response.promise
      }
      if (url.pathname === `/session/${id}/todo`)
        return json([{ content: "stale", status: "pending", priority: "high" }])
      if (url.pathname === `/session/${id}/diff`)
        return json([{ file: "stale.ts", patch: "stale", additions: 1, deletions: 0, status: "modified" }])
    },
    async ({ emit, sync }) => {
      const hydration = sync.session.sync(id)
      await requested.promise
      emit(
        global({ id: "deleted", type: "session.deleted", properties: { sessionID: id, info: session(id, "deleted") } }),
      )
      await observe(() => sync.session.get(id) === undefined)
      response.resolve(json(payload(id, "msg_stale", "stale")))
      await hydration

      expect(sync.session.get(id)).toBeUndefined()
      expect(sync.data.session_status[id]).toBeUndefined()
      expect(sync.data.message[id]).toBeUndefined()
      expect(sync.data.part.msg_stale).toBeUndefined()
      expect(sync.data.todo[id]).toBeUndefined()
      expect(sync.data.session_diff[id]).toBeUndefined()
    },
  )
})

test("disposal prevents old work and remount storms produce one trailing pass", async () => {
  let firstRequests = 0
  await scenario(
    (url) => {
      if (url.pathname === "/session") firstRequests += 1
      return undefined
    },
    async ({ app, emit }) => {
      app.renderer.destroy()
      expect(() => emit(connected("after-dispose"))).toThrow("event source not ready")
      await Promise.resolve()
      expect(firstRequests).toBe(1)
    },
  )
  const id = "ses_remount"
  let lists = 0
  let messages = 0
  await scenario(
    (url) => {
      if (url.pathname === "/session") return ((lists += 1), json([session(id, `pass ${lists}`)]))
      if (url.pathname === `/session/${id}`) return json(session(id, `pass ${lists}`))
      if (url.pathname === `/session/${id}/message`)
        return ((messages += 1), json(payload(id, `msg_pass_${messages}`, `pass ${messages}`)))
      if (url.pathname === `/session/${id}/todo` || url.pathname === `/session/${id}/diff`) return json([])
    },
    async ({ emit, sync }) => {
      await sync.session.sync(id)
      for (const epoch of ["initial", "two", "three", "four"]) emit(connected(epoch))
      await observe(() => sync.data.message[id]?.[0]?.id === "msg_pass_3")
      expect([lists, messages]).toEqual([3, 3])
    },
  )
})
