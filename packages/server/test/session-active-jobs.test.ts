import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { Effect, Layer, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("reports Sessions held by backgrounded work in /api/session/active until Stop cancels it", () =>
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
      deps: [Database.node],
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

    const session = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", "POST", {})).data
    const sessionID = Session.ID.make(session.id)
    if (!jobsService) throw new Error("Expected Job.Service")
    const jobs = jobsService
    const tool = (id: string) =>
      jobs.start({ id, type: "tool", recovery: { kind: "tool", sessionID, tool: "deploy" }, run: Effect.never })

    // A foreground tool and a detached dev server never make an idle Session look busy.
    yield* tool("job_foreground")
    yield* tool("job_dev_server")
    yield* jobs.background("job_dev_server", { detach: true })
    expect(yield* request("/api/session/active")).toEqual({ data: {} })

    yield* tool("job_deploy")
    yield* jobs.background("job_deploy")
    expect(yield* request("/api/session/active")).toEqual({ data: { [session.id]: { type: "running" } } })

    expect(yield* request(`/api/session/${session.id}/interrupt`, "POST")).toEqual({ interrupted: true })
    expect((yield* jobs.get("job_deploy"))?.status).toBe("cancelled")
    expect((yield* jobs.get("job_dev_server"))?.status).toBe("running")
    expect(yield* request("/api/session/active")).toEqual({ data: {} })
    yield* jobs.cancel("job_foreground")
    yield* jobs.cancel("job_dev_server")
  }).pipe(Effect.scoped),
)
