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

const client = (handler: (request: Request) => Promise<Response>, password?: string) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    ...(password ? { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } } : {}),
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

const fixture = Effect.fnUntraced(function* (password?: string) {
  const dir = (yield* tmpdirScoped("opencode-job-api-")).path
  const global = path.join(dir, "global")
  const project = path.join(dir, "project")
  const otherProject = path.join(dir, "other-project")
  yield* Effect.promise(() =>
    Promise.all([global, project, otherProject].map((item) => fs.mkdir(item, { recursive: true }))),
  )

  const captured = yield* Deferred.make<Job.Interface>()
  const jobNode = makeGlobalNode({
    service: Job.Service,
    layer: Layer.effect(Job.Service, Job.make.pipe(Effect.tap((service) => Deferred.succeed(captured, service)))),
    deps: [Database.node],
  })
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test" },
      password,
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: false, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    { overrides: [Job.node.replace(jobNode)] },
  )
  const jobs = yield* Deferred.await(captured)
  return { jobs, api: client(handler, password), project, otherProject, handler }
})

it.live("lists background jobs by session, kind, and descendants until completion notice clears them", () =>
  Effect.gen(function* () {
    const { jobs, api, project } = yield* fixture()
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
      type: "generate_image",
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

it.live("cancels background shells in the requested session and optionally its descendants", () =>
  Effect.gen(function* () {
    const { jobs, api, project, otherProject, handler } = yield* fixture("job-test-password")
    const root = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const child = yield* Effect.promise(() => api.session.create({ parentID: root.id }))
    const nested = yield* Effect.promise(() => api.session.create({ parentID: child.id }))
    const sibling = yield* Effect.promise(() => api.session.create({ parentID: root.id }))
    const other = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const foreign = yield* Effect.promise(() => api.session.create({ location: { directory: otherProject } }))
    const stopped: string[] = []
    const startShell = (id: string, owner: string, background: boolean) =>
      jobs.start({
        id,
        type: "shell",
        background,
        recovery: { kind: "shell", sessionID: Session.ID.make(owner), shellID: id, command: "shell command" },
        run: Effect.never,
        cancel: Effect.sync(() => {
          stopped.push(id)
        }),
      })

    yield* startShell("sh_explicit", child.id, true)
    yield* startShell("sh_promoted", child.id, false)
    yield* jobs.background("sh_promoted")
    yield* startShell("sh_foreground", child.id, false)
    yield* startShell("sh_nested", nested.id, true)
    yield* startShell("sh_sibling", sibling.id, true)
    yield* startShell("sh_other", other.id, true)
    yield* startShell("sh_foreign", foreign.id, true)
    yield* jobs.start({
      id: "img_child",
      type: "generate_image",
      background: true,
      recovery: { kind: "image", sessionID: Session.ID.make(child.id), path: "/tmp/diagram", model: "test/image" },
      run: Effect.never,
      cancel: Effect.sync(() => {
        stopped.push("img_child")
      }),
    })

    const unauthorized = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/experimental/job/cancel-shells", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionID: child.id }),
        }),
      ),
    )
    expect(unauthorized.status).toBe(401)
    expect(stopped).toEqual([])

    yield* Effect.promise(() => api.experimental.job.cancelShells({ sessionID: child.id, descendants: false }))
    expect(stopped.toSorted()).toEqual(["sh_explicit", "sh_promoted"])

    yield* Effect.promise(() => api.experimental.job.cancelShells({ sessionID: root.id, descendants: true }))
    expect(stopped.toSorted()).toEqual(["sh_explicit", "sh_nested", "sh_promoted", "sh_sibling"])
    expect(
      (yield* Effect.promise(() => api.experimental.job.list({ status: "running" }))).map((job) => job.id).toSorted(),
    ).toEqual(["img_child", "sh_foreign", "sh_other"])
    expect((yield* jobs.get("sh_foreground"))?.status).toBe("running")

    yield* Effect.promise(() => api.experimental.job.cancelShells({ sessionID: root.id, descendants: true }))
    expect(stopped).toHaveLength(4)
    yield* Effect.promise(() => api.experimental.job.cancel({ id: "sh_other" }))
    expect(stopped.at(-1)).toBe("sh_other")
    yield* Effect.promise(async () => {
      await expect(api.experimental.job.cancelShells({ sessionID: Session.ID.create() })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
    })
  }),
)

it.live("lets a background shell settle alongside a batch cancellation", () =>
  Effect.gen(function* () {
    const { jobs, api, project } = yield* fixture()
    const session = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const exit = yield* Deferred.make<string>()
    let cancellations = 0
    yield* jobs.start({
      id: "sh_exiting",
      type: "shell",
      background: true,
      recovery: { kind: "shell", sessionID: Session.ID.make(session.id), shellID: "sh_exiting", command: "exec job" },
      run: Deferred.await(exit),
      cancel: Effect.sync(() => {
        cancellations += 1
      }),
    })
    yield* Effect.all(
      [
        Deferred.succeed(exit, "done"),
        Effect.promise(() => api.experimental.job.cancelShells({ sessionID: session.id })),
      ],
      { concurrency: "unbounded" },
    )
    yield* Effect.promise(() => api.experimental.job.cancelShells({ sessionID: session.id }))
    const running = yield* Effect.promise(() => api.experimental.job.list({ sessionID: session.id, status: "running" }))
    expect(running).toEqual([])
    expect(cancellations).toBeLessThanOrEqual(1)
  }),
)
