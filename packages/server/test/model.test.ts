import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("reports the same canonical aliased default used by execution", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-model-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
        const global = path.join(tmp.path, "global")
        const project = path.join(tmp.path, "project")
        yield* Effect.promise(() => Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(project, "opencode.json"),
            JSON.stringify({
              model: "azure-cognitive-services/chat#high",
              providers: {
                azure: {
                  package: "aisdk:@ai-sdk/openai",
                  settings: { apiKey: "configured" },
                  models: { chat: { variants: [{ id: "high" }] } },
                },
              },
            }),
          ),
        )
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          config: { directory: global },
          fs: { filewatcher: false },
        })
        const url = new URL("/api/model/default", HttpServer.formatAddress(server.address))
        url.searchParams.set("location[directory]", project)
        const response = yield* Effect.promise(() =>
          fetch(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
        )
        const body = (yield* Effect.promise(() => response.json())) as {
          readonly data?: { readonly providerID?: string; readonly id?: string }
        }

        expect(response.status).toBe(200)
        expect(body.data).toMatchObject({ providerID: "azure", id: "chat" })
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)
