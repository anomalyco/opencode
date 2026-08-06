import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Config } from "@opencode-ai/schema/config"
import { Effect, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("returns ordered config entries for the requested directory", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-config-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
        const global = path.join(tmp.path, "global")
        const project = path.join(tmp.path, "project")
        const config = path.join(project, "opencode.json")
        yield* Effect.promise(() => Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]))
        yield* Effect.promise(() =>
          fs.writeFile(
            config,
            JSON.stringify({
              permissions: [
                { action: "shell", resource: "*", effect: "ask" },
                { action: "shell", resource: "git status", effect: "allow" },
              ],
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
        const url = new URL("/api/config", HttpServer.formatAddress(server.address))
        url.searchParams.set("location[directory]", project)
        const response = yield* Effect.promise(() =>
          fetch(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
        )
        const entries = Schema.decodeUnknownSync(Schema.Array(Config.Entry))(
          yield* Effect.promise(() => response.json()),
        )

        expect(response.status).toBe(200)
        expect(Array.isArray(entries)).toBe(true)
        const document = entries.find(
          (entry): entry is Config.Document => entry.type === "document" && entry.path === config,
        )
        expect(document?.info.permissions).toEqual([
          { action: "shell", resource: "*", effect: "ask" },
          { action: "shell", resource: "git status", effect: "allow" },
        ])
        expect(entries.some((entry) => entry.type === "file" && entry.path === config)).toBe(true)
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)
