import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Job } from "@opencode/core/job"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { Deferred, Effect, Layer, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("lists running family jobs and includes job-owning sessions in /api/session/active", () =>
  Effect.gen(function* () {
    let jobsService: Job.Interface | undefined
    const captureJobs = makeGlobalNode({
      service: Job.Service,
      layer: Layer.effect(
        Job.Service,
        Job.make.pipe(
          Effect.tap((built) =>
            Effect.sync(() => {
              jobsService = built
            }),
          ),
        ),
      ),
      deps: [Database.node, Bus.node],
    })
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      { overrides: [Job.node.replace(captureJobs)] },
    )
    const request = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        expect(response.status).toBe(200)
        return response.json()
      })

    const parent = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", "POST", {})).data
    const child = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/session", "POST", { parentID: parent.id }),
    ).data
    if (!jobsService) throw new Error("Expected Job.Service")

    const latch = yield* Deferred.make<void>()
    yield* jobsService.start({
      id: "sh_child_job",
      sessionID: Session.ID.make(child.id),
      type: "shell",
      title: "bun test",
      run: Deferred.await(latch).pipe(Effect.as("ok")),
      output: Effect.succeed("running tests..."),
    })

    expect(yield* request("/api/session/active")).toEqual({
      data: { [child.id]: { type: "running" } },
    })
    expect(yield* request(`/api/experimental/session/${parent.id}/jobs`)).toMatchObject({
      data: [
        {
          id: "sh_child_job",
          sessionID: child.id,
          type: "shell",
          title: "bun test",
          status: "running",
          output: "running tests...",
        },
      ],
    })

    yield* Deferred.succeed(latch, undefined)
    yield* jobsService.wait({ id: "sh_child_job" })

    expect(yield* request("/api/session/active")).toEqual({ data: {} })
    expect(yield* request(`/api/experimental/session/${parent.id}/jobs`)).toEqual({ data: [] })
  }).pipe(Effect.scoped),
)
