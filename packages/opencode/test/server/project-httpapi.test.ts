import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Instance } from "../../src/project/instance"
import { ExperimentalHttpApiServer } from "../../src/server/instance/httpapi/server"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("experimental project httpapi", () => {
  test("lists projects, returns current project, and serves docs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      const listRes = yield* HttpClientRequest.get("/experimental/httpapi/project").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", tmp.path),
        client.execute,
      )
      const list: any[] = JSON.parse(yield* listRes.text)
      expect(list.length).toBeGreaterThan(0)
      expect(list[0].worktree).toBeDefined()

      const currentRes = yield* HttpClientRequest.get("/experimental/httpapi/project/current").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", tmp.path),
        client.execute,
      )
      const project: any = JSON.parse(yield* currentRes.text)
      expect(project.worktree).toBe(tmp.path)

      const docRes = yield* HttpClientRequest.get("/experimental/httpapi/project/doc").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", tmp.path),
        client.execute,
      )
      const spec: any = JSON.parse(yield* docRes.text)
      expect(spec.paths["/experimental/httpapi/project"]?.get?.operationId).toBe("project.list")
      expect(spec.paths["/experimental/httpapi/project/current"]?.get?.operationId).toBe("project.current")
    }).pipe(Effect.scoped, Effect.provide(ExperimentalHttpApiServer.layerTest), Effect.runPromise)
  })
})
