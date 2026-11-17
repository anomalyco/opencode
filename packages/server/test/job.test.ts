import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Deferred, Effect, Layer } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("lists background jobs by session, kind, and descendants until completion notice clears them", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-job-api-")).path
    const global = path.join(dir, "global")
    const project = path.join(dir, "project")
    yield* Effect.promise(() => Promise.all([global, project].map((item) => fs.mkdir(item, { recursive: true }))))

    const captured = yield* Deferred.make<Job.Interface>()
    const jobNode = makeGlobalNode({
      service: Job.Service,
      layer: Layer.effect(
        Job.Service,
        Job.make.pipe(Effect.tap((service) => Deferred.succeed(captured, service))),
      ),
      deps: [Database.node],
    })
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test" },
        database: { path: path.join(dir, "opencode.db") },
        config: { directory: global, project: false, claude: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      { overrides: [Job.node.replace(jobNode)] },
    )
    const jobs = yield* Deferred.await(captured)
    const api = client(handler)

    const root = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const child = yield* Effect.promise(() => api.session.create({ parentID: root.id }))
    const other = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const rootID = Session.ID.make(root.id)
    const childID = Session.ID.make(child.id)
    const otherID = Session.ID.make(other.id)

    yield* Effect.promise(async () => {
      await expect(api.experimental.job.list({ sessionID: Session.ID.create() })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
    })

    const fgGate = yield* Deferred.make<string>()
    const shellGate = yield* Deferred.make<string>()
    const subagentGate = yield* Deferred.make<string>()
    const childShellGate = yield* Deferred.make<string>()
    const imageGate = yield* Deferred.make<string>()

    // Foreground jobs stay invisible until moved to the background.
    yield* jobs.start({
      id: "sh_fg",
      type: "shell",
      title: "echo fg",
      recovery: { kind: "shell", sessionID: rootID, shellID: "sh_fg", command: "echo fg" },
      run: Deferred.await(fgGate),
    })
    expect(yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id }))).toEqual([])

    yield* jobs.start({
      id: "sh_root",
      type: "shell",
      title: "bun test",
      recovery: { kind: "shell", sessionID: rootID, shellID: "sh_root", command: "bun test" },
      run: Deferred.await(shellGate),
    })
    const shellBg = yield* jobs.background("sh_root")

    yield* jobs.start({
      id: child.id,
      type: "subagent",
      title: "audit routes",
      recovery: {
        kind: "subagent",
        parentSessionID: rootID,
        childSessionID: childID,
        agent: "explore",
        description: "audit routes",
      },
      run: Deferred.await(subagentGate),
    })
    const subagentBg = yield* jobs.background(child.id)

    yield* jobs.start({
      id: "sh_child",
      type: "shell",
      title: "pytest",
      recovery: { kind: "shell", sessionID: childID, shellID: "sh_child", command: "pytest" },
      run: Deferred.await(childShellGate),
    })
    const childShellBg = yield* jobs.background("sh_child")

    yield* jobs.start({
      id: "img_other",
      type: "experimental_image_generate",
      title: "diagram",
      recovery: { kind: "image", sessionID: otherID, path: "/tmp/diagram", model: "openai/gpt-image-1" },
      run: Deferred.await(imageGate),
    })
    const imageBg = yield* jobs.background("img_other")

    // Direct session query returns only root's own shell + subagent jobs, not child's shell or other's image.
    const direct = yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id }))
    expect(direct).toMatchObject([
      { kind: "shell", id: "sh_root", sessionID: root.id, status: "running", shellID: "sh_root", command: "bun test" },
      {
        kind: "subagent",
        id: child.id,
        sessionID: root.id,
        status: "running",
        childSessionID: child.id,
        agent: "explore",
        description: "audit routes",
      },
    ])

    // Kind filter selects shell jobs for that session directly.
    const rootShells = yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id, kind: "shell" }))
    expect(rootShells.map((item) => item.id)).toEqual(["sh_root"])

    // Descendants includes child session jobs while excluding unrelated sessions.
    const withDescendants = yield* Effect.promise(() =>
      api.experimental.job.list({ sessionID: root.id, descendants: true }),
    )
    expect(withDescendants.map((item) => item.id)).toEqual(["sh_root", child.id, "sh_child"])

    // Unfiltered list returns every unconsumed background job on the server.
    const all = yield* Effect.promise(() => api.experimental.job.list())
    expect(all.map((item) => item.id)).toEqual(["sh_root", child.id, "sh_child", "img_other"])

    // Settled background work stays visible as "completed" until completeBackground clears its notice.
    yield* Deferred.succeed(shellGate, "passed")
    yield* jobs.wait({ id: "sh_root" })
    const settled = yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id, kind: "shell" }))
    expect(settled).toMatchObject([
      {
        kind: "shell",
        id: "sh_root",
        status: "completed",
        time: { started: expect.any(Number), completed: expect.any(Number) },
      },
    ])
    expect(
      (yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id, status: "running" }))).map(
        (item) => item.id,
      ),
    ).toEqual([child.id])
    expect(
      (yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id, status: "completed" }))).map(
        (item) => item.id,
      ),
    ).toEqual(["sh_root"])

    if (shellBg?.notificationID) yield* jobs.completeBackground(shellBg.notificationID)
    expect(yield* Effect.promise(() => api.experimental.job.list({ sessionID: root.id, kind: "shell" }))).toEqual([])

    // Cleanup remaining test jobs.
    yield* Deferred.succeed(fgGate, "done")
    yield* Deferred.succeed(subagentGate, "done")
    yield* Deferred.succeed(childShellGate, "done")
    yield* Deferred.succeed(imageGate, "done")
    if (subagentBg?.notificationID) yield* jobs.completeBackground(subagentBg.notificationID)
    if (childShellBg?.notificationID) yield* jobs.completeBackground(childShellBg.notificationID)
    if (imageBg?.notificationID) yield* jobs.completeBackground(imageBg.notificationID)
  }),
)
