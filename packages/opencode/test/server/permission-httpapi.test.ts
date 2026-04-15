import { describe, expect } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { ExperimentalHttpApiServer } from "../../src/server/instance/httpapi/server"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Effect, Fiber } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

Log.init({ print: false })

const it = testEffect(ExperimentalHttpApiServer.layerTest)

describe("experimental permission httpapi", () => {
  it.live("lists pending permissions, replies, and serves docs", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir({ git: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => tmp[Symbol.asyncDispose]()))
      yield* Effect.addFinalizer(() => Effect.promise(() => Instance.disposeAll()))

      const headers = {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      }

      const ctx = yield* Effect.promise(() =>
        Instance.provide({
          directory: tmp.path,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          fn: () => Instance.current,
        }),
      )

      const svc = yield* Permission.Service
      const pending = yield* svc
        .ask({
          sessionID: SessionID.make("ses_test"),
          permission: "bash",
          patterns: ["ls"],
          metadata: { cmd: "ls" },
          always: ["ls"],
          ruleset: [],
        })
        .pipe(Effect.provideService(InstanceRef, ctx), Effect.forkScoped)

      let items: Array<any> = []
      for (let i = 0; i < 10; i++) {
        const list = yield* HttpClient.execute(
          HttpClientRequest.get("/experimental/httpapi/permission").pipe(HttpClientRequest.setHeaders(headers)),
        )
        expect(list.status).toBe(200)
        items = (yield* list.json) as Array<any>
        if (items.length > 0) break
        yield* Effect.sleep("50 millis")
      }

      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        permission: "bash",
        patterns: ["ls"],
        metadata: { cmd: "ls" },
        always: ["ls"],
      })

      const doc = yield* HttpClient.execute(
        HttpClientRequest.get("/experimental/httpapi/permission/doc").pipe(HttpClientRequest.setHeaders(headers)),
      )
      expect(doc.status).toBe(200)
      const spec = (yield* doc.json) as any
      expect(spec.paths["/experimental/httpapi/permission"]?.get?.operationId).toBe("permission.list")
      expect(spec.paths["/experimental/httpapi/permission/{requestID}/reply"]?.post?.operationId).toBe(
        "permission.reply",
      )

      const reply = yield* HttpClient.execute(
        yield* HttpClientRequest.post(`/experimental/httpapi/permission/${items[0].id}/reply`).pipe(
          HttpClientRequest.setHeaders(headers),
          HttpClientRequest.bodyJson({ reply: "once" }),
        ),
      )
      expect(reply.status).toBe(200)
      expect(yield* reply.json).toBe(true)
      yield* Fiber.join(pending)
    }),
  )
})
