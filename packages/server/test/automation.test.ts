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

const hourly = { type: "every" as const, every: "1 hour" }

it.live(
  "manages automations through the experimental API when enabled and honors experimental.automations: false",
  () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-automation-api-")).path
      const global = path.join(dir, "global")
      const enabled = path.join(dir, "enabled")
      const ask = path.join(dir, "ask")
      yield* Effect.promise(async () => {
        await Promise.all([global, enabled, ask].map((item) => fs.mkdir(item, { recursive: true })))
        await fs.writeFile(path.join(enabled, "opencode.json"), JSON.stringify({ experimental: { automations: true } }))
        await fs.writeFile(
          path.join(ask, "opencode.json"),
          JSON.stringify({ experimental: { automations: true }, permission: { execute: "ask" } }),
        )
      })
      const handler = yield* ServerFetch.make({
        app: { version: "test" },
        database: { path: path.join(dir, "opencode.db") },
        config: { directory: global, project: true, claude: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      })
      const api = client(handler)
      const post = (body: unknown) =>
        handler(
          new Request("http://opencode.local/api/experimental/automation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )

      yield* Effect.promise(async () => {
        const session = await api.session.create({ location: { directory: enabled } })
        const created = await api.experimental.automation.create({
          sessionID: session.id,
          name: "build",
          trigger: hourly,
          expires: "in 8 hours",
          action: { type: "prompt", prompt: "check the build" },
        })
        expect(created).toMatchObject({
          sessionID: session.id,
          directory: enabled,
          name: "build",
          trigger: hourly,
          action: { type: "prompt", prompt: "check the build", to: { session: session.id } },
          status: "active",
        })
        expect(created.expires).toBeDefined()
        expect(await api.experimental.automation.list({ sessionID: session.id })).toMatchObject([{ id: created.id }])
        expect(await api.experimental.automation.list({ directory: enabled })).toMatchObject([{ id: created.id }])
        expect(await api.experimental.automation.list({})).toMatchObject([{ id: created.id }])
        await expect(api.experimental.automation.list({ directory: "relative" })).rejects.toMatchObject({
          _tag: "InvalidRequestError",
        })
        expect(await api.experimental.automation.get({ automationID: created.id })).toMatchObject({ id: created.id })
        expect(await api.experimental.automation.pause({ automationID: created.id })).toMatchObject({
          status: "paused",
        })
        expect(await api.experimental.automation.resume({ automationID: created.id })).toMatchObject({
          status: "active",
        })
        await api.experimental.automation.delete({ automationID: created.id })
        await expect(api.experimental.automation.get({ automationID: created.id })).rejects.toMatchObject({
          _tag: "AutomationNotFoundError",
        })

        // Without a Session, in a directory, prompting an existing Session.
        const standalone = await api.experimental.automation.create({
          name: "standalone",
          directory: enabled,
          trigger: hourly,
          action: { type: "prompt", prompt: "hello", to: { session: session.id } },
        })
        expect(standalone).toMatchObject({ directory: enabled, action: { to: { session: session.id } } })
        expect(standalone.sessionID).toBeUndefined()
        // A subagent target needs a creating Session to be the parent of each run's child.
        await expect(
          api.experimental.automation.create({
            name: "orphan",
            directory: enabled,
            trigger: hourly,
            action: { type: "prompt", prompt: "hello", to: { subagent: "general" } },
          }),
        ).rejects.toMatchObject({ _tag: "InvalidRequestError" })
        const triage = await api.experimental.automation.create({
          sessionID: session.id,
          name: "triage",
          trigger: hourly,
          action: { type: "prompt", prompt: "triage", to: { subagent: "general" } },
        })
        expect(triage).toMatchObject({ sessionID: session.id, action: { to: { subagent: "general" } } })
        await api.experimental.automation.delete({ automationID: triage.id })

        await expect(
          api.experimental.automation.create({
            sessionID: session.id,
            name: "bad",
            trigger: { type: "every", every: "soon" },
            action: { type: "prompt", prompt: "ping" },
          }),
        ).rejects.toMatchObject({ _tag: "InvalidRequestError" })
        // A trigger without its type, or a target naming both a Session and an agent, is rejected rather than guessed.
        expect(
          (
            await post({
              sessionID: session.id,
              name: "x",
              trigger: { every: "1 hour" },
              action: { type: "prompt", prompt: "x" },
            })
          ).status,
        ).toBe(400)
        expect(
          (
            await post({
              sessionID: session.id,
              name: "x",
              trigger: hourly,
              action: { type: "prompt", prompt: "x", to: { session: session.id, subagent: "general" } },
            })
          ).status,
        ).toBe(400)
        expect(await api.experimental.automation.list({ sessionID: session.id })).toEqual([])

        // Turn off the directory that still owns the standalone automation. Even unfiltered lists must hide it.
        await fs.writeFile(
          path.join(enabled, "opencode.json"),
          JSON.stringify({ experimental: { automations: false } }),
        )
        await api.location.reload()
        expect(await api.experimental.automation.list({})).toEqual([])
        await expect(api.experimental.automation.get({ automationID: standalone.id })).rejects.toMatchObject({
          _tag: "ForbiddenError",
        })
        await expect(
          api.experimental.automation.create({
            sessionID: session.id,
            name: "x",
            trigger: hourly,
            action: { type: "prompt", prompt: "ping" },
          }),
        ).rejects.toMatchObject({ _tag: "ForbiddenError" })
        await expect(api.experimental.automation.list({ sessionID: session.id })).rejects.toMatchObject({
          _tag: "ForbiddenError",
        })

        // A code action that would need an interactive approval is refused over stateless HTTP instead of hanging.
        const askSession = await api.session.create({ location: { directory: ask } })
        await expect(
          api.experimental.automation.create({
            sessionID: askSession.id,
            name: "blocked",
            trigger: hourly,
            action: { type: "code", code: "return" },
          }),
        ).rejects.toMatchObject({ _tag: "ForbiddenError" })
      })
    }).pipe(Effect.scoped),
)

it.live("runs due automations in standalone ServerProcess.start without lifecycle", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-automation-serve-")).path
    const server = yield* startServer(dir)
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })

    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { automations: true } }))
      const session = await api.session.create({ location: { directory: dir } })
      const created = await api.experimental.automation.create({
        sessionID: session.id,
        name: "models",
        trigger: { type: "at", at: "in 150 millis" },
        action: {
          type: "code",
          code: 'const models = await tools.opencode.models({}); console.log("models=" + models.total); return { state: { total: models.total } }',
        },
      })
      expect(created.status).toBe("active")

      const deadline = Date.now() + 5_000
      let current = created
      while (current.status === "active" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        current = await api.experimental.automation.get({ automationID: created.id })
      }
      expect(current).toMatchObject({
        status: "done",
        runCount: 1,
        lastOutcome: "fired",
        lastOutput: expect.stringContaining("models="),
        state: { total: expect.any(Number) },
      })
    })
  }).pipe(Effect.scoped),
)

it.live("elects one leader when two server processes boot against a due automation", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-automation-leader-")).path
    const dbPath = path.join(dir, "shared.db")
    yield* Effect.promise(() =>
      fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { automations: true } })),
    )

    // Seed an active automation in a short-lived scope so it falls due while no server is running.
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
          const parent = await seededApi.session.create({ location: { directory: dir } })
          const created = await seededApi.experimental.automation.create({
            sessionID: parent.id,
            name: "single leader",
            trigger: { type: "at", at: "in 80 millis" },
            action: { type: "prompt", prompt: "single leader check", to: { subagent: "general" } },
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
    // Both servers start against the same already-due row; without leader election both start a Session.
    const [first] = yield* Effect.all([boot(), boot()], { concurrency: 2 })
    const base = `http://127.0.0.1:${"port" in first.address ? first.address.port : 0}`
    const api = OpenCode.make({
      baseUrl: base,
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })

    yield* Effect.promise(async () => {
      const deadline = Date.now() + 5_000
      let current = await api.experimental.automation.get({ automationID: createdID })
      while (current.status === "active" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        current = await api.experimental.automation.get({ automationID: createdID })
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      const started = (await api.session.list({})).data.filter((session) => session.title === "single leader")
      expect(current).toMatchObject({ status: "done", runCount: 1 })
      expect(started).toHaveLength(1)
    })
  }).pipe(Effect.scoped),
)
