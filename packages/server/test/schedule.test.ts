import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { ServerProcess } from "../src/process"
import { startServer } from "./fixture/server"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("manages schedules through the experimental API when enabled and honors experimental.schedules: false", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-api-")).path
    const global = path.join(dir, "global")
    const enabled = path.join(dir, "enabled")
    const disabled = path.join(dir, "disabled")
    yield* Effect.promise(async () => {
      await Promise.all([global, enabled, disabled].map((item) => fs.mkdir(item, { recursive: true })))
      await fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(enabled, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(disabled, "opencode.json"), JSON.stringify({ experimental: { schedules: false } }))
    })
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)
    const handlerRequest = (route: string, body: unknown) =>
      handler(
        new Request(`http://opencode.local${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )

    yield* Effect.promise(async () => {
      const session = await api.session.create({ location: { directory: enabled } })
      const created = await api.experimental.schedule.create({
        sessionID: session.id,
        name: "build",
        when: { every: "1 hour" },
        ends: { times: 3 },
        prompt: "check the build",
      })
      expect(created).toMatchObject({
        sessionID: session.id,
        name: "build",
        when: { type: "every", every: "1 hour" },
        action: { type: "prompt", prompt: "check the build" },
        status: "active",
        remainingRuns: 3,
      })
      expect(await api.experimental.schedule.list({ sessionID: session.id })).toMatchObject([{ id: created.id }])
      expect(await api.experimental.schedule.get({ scheduleID: created.id })).toMatchObject({ id: created.id })
      expect(await api.experimental.schedule.pause({ scheduleID: created.id })).toMatchObject({ status: "paused" })
      expect(await api.experimental.schedule.resume({ scheduleID: created.id })).toMatchObject({ status: "active" })
      await api.experimental.schedule.delete({ scheduleID: created.id })
      await expect(api.experimental.schedule.get({ scheduleID: created.id })).rejects.toMatchObject({
        _tag: "ScheduleNotFoundError",
      })

      // No Session: the command stands on its own, follows the global flag, and stores a null session_id.
      const standalone = await api.experimental.schedule.create({
        when: { in: "5 minutes" },
        run: "echo hi",
        timeout: "1 minute",
      })
      expect(standalone.sessionID).toBeUndefined()
      expect(standalone).toMatchObject({
        action: { type: "shell", run: "echo hi", timeout: "1 minute" },
        status: "active",
      })
      expect(standalone.nextDueAt).toBeDefined()
      // A session-less row follows the global flag and reads without a Session.
      expect(await api.experimental.schedule.get({ scheduleID: standalone.id })).toMatchObject({ id: standalone.id })
      expect(await api.experimental.schedule.list()).toMatchObject([{ id: standalone.id }])
      expect(await api.experimental.schedule.list({ sessionID: session.id })).toEqual([])
      expect(await api.experimental.schedule.pause({ scheduleID: standalone.id })).toMatchObject({ status: "paused" })
      expect(await api.experimental.schedule.resume({ scheduleID: standalone.id })).toMatchObject({ status: "active" })
      await api.experimental.schedule.delete({ scheduleID: standalone.id })
      await expect(api.experimental.schedule.get({ scheduleID: standalone.id })).rejects.toMatchObject({
        _tag: "ScheduleNotFoundError",
      })
      await expect(
        api.experimental.schedule.create({ when: { in: "5 minutes" }, run: "echo hi", prompt: "ping" }),
      ).rejects.toMatchObject({ _tag: "InvalidRequestError" })
      await expect(api.experimental.schedule.create({ when: { in: "5 minutes" } })).rejects.toMatchObject({
        _tag: "InvalidRequestError",
      })
      // A prompt needs a Session to wake until session-less prompt firing lands.
      await expect(
        api.experimental.schedule.create({ when: { in: "5 minutes" }, prompt: "ping" }),
      ).rejects.toMatchObject({ _tag: "InvalidRequestError" })

      await expect(
        api.experimental.schedule.create({ sessionID: session.id, when: { every: "soon" }, prompt: "ping" }),
      ).rejects.toMatchObject({ _tag: "InvalidRequestError" })
      // Two triggers would otherwise decode as the first one, silently turning a repeat into a one-shot.
      const twoTriggers = await handlerRequest("/api/experimental/schedule", {
        sessionID: session.id,
        when: { in: "5 minutes", every: "1 hour" },
        prompt: "ping",
      })
      expect(twoTriggers.status).toBe(400)
      expect(await api.experimental.schedule.list({ sessionID: session.id })).toEqual([])
      await expect(
        api.experimental.schedule.create({ sessionID: session.id, when: { in: "0 seconds" }, prompt: "ping" }),
      ).rejects.toMatchObject({ _tag: "InvalidRequestError", message: "Duration must be positive: 0 seconds" })

      // Off where the Session lives: nothing can be created or read.
      const off = await api.session.create({ location: { directory: disabled } })
      await expect(
        api.experimental.schedule.create({ sessionID: off.id, when: { in: "5 minutes" }, prompt: "ping" }),
      ).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(api.experimental.schedule.list({ sessionID: off.id })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })

      // Shell until check that already passes returns done immediately with its output.
      const matched = await api.experimental.schedule.create({
        sessionID: session.id,
        until: { run: "printf ready" },
        prompt: "ready now",
      })
      expect(matched).toMatchObject({
        status: "done",
        lastOutcome: "fired",
        lastOutput: "ready",
        until: { type: "shell", run: "printf ready" },
      })

      // Stateless HTTP create settles an "ask" command as 403 ForbiddenError instead of hanging.
      const askDir = path.join(dir, "ask")
      await fs.mkdir(askDir, { recursive: true })
      await fs.writeFile(
        path.join(askDir, "opencode.json"),
        JSON.stringify({ experimental: { schedules: true }, permission: { shell: "ask" } }),
      )
      const askSession = await api.session.create({ location: { directory: askDir } })
      await expect(
        api.experimental.schedule.create({
          sessionID: askSession.id,
          until: { run: "printf blocked" },
          prompt: "never",
        }),
      ).rejects.toMatchObject({ _tag: "ForbiddenError" })

      // Code Mode until check works end-to-end with no allow field, and { run, code } together is 400.
      const codeMatched = await api.experimental.schedule.create({
        sessionID: session.id,
        until: { code: 'return { wake: true, message: "models=" + (await tools.opencode.models({})).total }' },
        prompt: "models checked",
      })
      expect(codeMatched).toMatchObject({
        status: "done",
        lastOutcome: "fired",
        lastOutput: expect.stringContaining("models="),
        until: { type: "code" },
      })
      const mixed = await handlerRequest("/api/experimental/schedule", {
        sessionID: session.id,
        until: { run: "true", code: "return true" },
        prompt: "ping",
      })
      expect(mixed.status).toBe(400)
    })
  }).pipe(Effect.scoped),
)

it.live("session-less schedule reads follow the global flag", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-global-")).path
    const global = path.join(dir, "global")
    const enabled = path.join(dir, "enabled")
    const dbPath = path.join(dir, "opencode.db")
    yield* Effect.promise(async () => {
      await Promise.all([global, enabled].map((item) => fs.mkdir(item, { recursive: true })))
      await fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(enabled, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
    })

    // Seeded while the global flag is on; both schedules are an hour out so neither instance fires them.
    const ids = yield* Effect.scoped(
      Effect.gen(function* () {
        const handler = yield* ServerFetch.make({
          app: { version: "test" },
          database: { path: dbPath },
          config: { directory: global, project: true, claude: false },
          models: { fetch: false },
          fs: { filewatcher: false },
        })
        const api = client(handler)
        return yield* Effect.promise(async () => {
          const session = await api.session.create({ location: { directory: enabled } })
          const standalone = await api.experimental.schedule.create({ when: { in: "1 hour" }, run: "true" })
          const created = await api.experimental.schedule.create({
            sessionID: session.id,
            when: { in: "1 hour" },
            prompt: "still here",
          })
          return { sessionID: session.id, standaloneID: standalone.id, createdID: created.id }
        })
      }),
    )

    yield* Effect.promise(() =>
      fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ experimental: { schedules: false } })),
    )

    // A second ServerFetch reads the rewritten global config instead of the first instance's cached copy.
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: dbPath },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)
    yield* Effect.promise(async () => {
      await expect(api.experimental.schedule.get({ scheduleID: ids.standaloneID })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      await expect(api.experimental.schedule.pause({ scheduleID: ids.standaloneID })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      await expect(api.experimental.schedule.delete({ scheduleID: ids.standaloneID })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      await expect(api.experimental.schedule.list()).rejects.toMatchObject({ _tag: "ForbiddenError" })

      // A schedule with a Session still follows the flag where that Session lives.
      expect(await api.experimental.schedule.list({ sessionID: ids.sessionID })).toMatchObject([{ id: ids.createdID }])
      expect(await api.experimental.schedule.get({ scheduleID: ids.createdID })).toMatchObject({ id: ids.createdID })
    })
  }).pipe(Effect.scoped),
)

it.live("filters a session-less list by each Session's location flag", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-list-")).path
    const global = path.join(dir, "global")
    const on = path.join(dir, "on")
    const off = path.join(dir, "off")
    const dbPath = path.join(dir, "opencode.db")
    yield* Effect.promise(async () => {
      await Promise.all([global, on, off].map((item) => fs.mkdir(item, { recursive: true })))
      await fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(on, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(off, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
    })

    // Seeded while every location has the flag on, so the off rows exist before its flag turns off.
    const ids = yield* Effect.scoped(
      Effect.gen(function* () {
        const handler = yield* ServerFetch.make({
          app: { version: "test" },
          database: { path: dbPath },
          config: { directory: global, project: true, claude: false },
          models: { fetch: false },
          fs: { filewatcher: false },
        })
        const api = client(handler)
        return yield* Effect.promise(async () => {
          const session = await api.session.create({ location: { directory: on } })
          const offSession = await api.session.create({ location: { directory: off } })
          const goneSession = await api.session.create({ location: { directory: on } })
          const standalone = await api.experimental.schedule.create({ when: { in: "1 hour" }, run: "true" })
          const kept = await api.experimental.schedule.create({
            sessionID: session.id,
            when: { in: "1 hour" },
            prompt: "kept",
          })
          const offFirst = await api.experimental.schedule.create({
            sessionID: offSession.id,
            when: { in: "1 hour" },
            prompt: "off",
          })
          const offSecond = await api.experimental.schedule.create({
            sessionID: offSession.id,
            when: { in: "1 hour" },
            prompt: "off too",
          })
          const orphan = await api.experimental.schedule.create({
            sessionID: goneSession.id,
            when: { in: "1 hour" },
            prompt: "orphan",
          })
          // The schedule stays behind, so a gone Session must hide it rather than fail the whole list.
          await api.session.remove({ sessionID: goneSession.id })
          return {
            sessionID: session.id,
            offSessionID: offSession.id,
            standaloneID: standalone.id,
            keptID: kept.id,
            offIDs: [offFirst.id, offSecond.id],
            orphanID: orphan.id,
          }
        })
      }),
    )

    yield* Effect.promise(() =>
      fs.writeFile(path.join(off, "opencode.json"), JSON.stringify({ experimental: { schedules: false } })),
    )

    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: dbPath },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)
    yield* Effect.promise(async () => {
      // The global flag is still on, so the session-less list works, keeps the session-less row, and hides the rows
      // whose Session lives where the flag is off or whose Session is gone.
      const listed = await api.experimental.schedule.list()
      expect(listed.map((row) => row.id).sort()).toEqual([ids.keptID, ids.standaloneID].sort())
      expect(listed.map((row) => row.id)).not.toContain(ids.offIDs[0])
      expect(listed.map((row) => row.id)).not.toContain(ids.offIDs[1])
      expect(listed.map((row) => row.id)).not.toContain(ids.orphanID)

      // An explicit session list is unchanged: still 403 where that Session's location is off.
      await expect(api.experimental.schedule.list({ sessionID: ids.offSessionID })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      expect(await api.experimental.schedule.list({ sessionID: ids.sessionID })).toMatchObject([{ id: ids.keptID }])
    })
  }).pipe(Effect.scoped),
)

it.live("ticks due schedules in standalone ServerProcess.start without lifecycle", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-serve-")).path
    const server = yield* startServer(dir)
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })

    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { schedules: true }, permission: { shell: "allow" } }))
      const session = await api.session.create({ location: { directory: dir } })
      const created = await api.experimental.schedule.create({
        sessionID: session.id,
        when: { in: "150 millis" },
        if: { run: "false" },
        prompt: "wake from serve",
      })
      expect(created.status).toBe("active")

      const deadline = Date.now() + 5_000
      let current = created
      while (current.status === "active" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        current = await api.experimental.schedule.get({ scheduleID: created.id })
      }
      expect(current).toMatchObject({
        status: "done",
        lastOutcome: "checked",
      })
    })
  }).pipe(Effect.scoped),
)

it.live("elects one scheduler leader when two server processes boot against a due schedule", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-leader-")).path
    const dbPath = path.join(dir, "shared.db")
    const marker = path.join(dir, "runs.txt")
    yield* Effect.promise(() =>
      fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { schedules: true }, permission: { shell: "allow" } })),
    )

    // Seed an active schedule in a short-lived scope so it falls due while no server is running.
    const createdID = yield* Effect.scoped(
      Effect.gen(function* () {
        const handler = yield* ServerFetch.make({
          app: { version: "test" },
          database: { path: dbPath },
          config: { directory: dir, project: true, claude: false },
          models: { fetch: false },
          fs: { filewatcher: false },
        })
        const seededApi = client(handler)
        return yield* Effect.promise(async () => {
          const session = await seededApi.session.create({ location: { directory: dir } })
          const created = await seededApi.experimental.schedule.create({
            sessionID: session.id,
            when: { in: "80 millis" },
            if: { run: `printf 'x\\n' >> ${JSON.stringify(marker)} && false` },
            prompt: "single leader check",
          })
          return created.id
        })
      }),
    )
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 120)))

    const boot = () =>
      ServerProcess.start<never, never>({
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        app: { version: "test-version" },
        database: { path: dbPath },
        config: { directory: dir },
        fs: { filewatcher: false },
        models: { fetch: false },
      })
    // Both servers start against the same already-due row at t=0; without leader election both run the check.
    const [first] = yield* Effect.all([boot(), boot()], { concurrency: 2 })
    const base = `http://127.0.0.1:${"port" in first.address ? first.address.port : 0}`
    const api = OpenCode.make({
      baseUrl: base,
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })

    yield* Effect.promise(async () => {
      const deadline = Date.now() + 5_000
      let current = await api.experimental.schedule.get({ scheduleID: createdID })
      while (current.status === "active" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        current = await api.experimental.schedule.get({ scheduleID: createdID })
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      const lines = (await fs.readFile(marker, "utf8")).trim().split("\n").filter(Boolean)
      expect(current.status).toBe("done")
      expect(lines).toEqual(["x"])
    })
  }).pipe(Effect.scoped),
)
