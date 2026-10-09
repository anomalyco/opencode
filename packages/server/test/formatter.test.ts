import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Formatter } from "@opencode/schema/formatter"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("returns formatter status for the requested directory", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-formatter-endpoint-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(project, "opencode.json"),
        JSON.stringify({
          formatter: {
            custom: { command: [process.execPath, "-e", "process.exit(0)", "$FILE"], extensions: [".custom"] },
            missing: { extensions: [".missing"] },
            gofmt: { disabled: true },
          },
        }),
      ),
    )
    const server = yield* startServer(global)
    const url = new URL("/api/formatter", server.base)
    url.searchParams.set("location[directory]", project)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    const body = Schema.decodeUnknownSync(Location.response(Schema.Array(Formatter.Status)))(
      yield* Effect.promise(() => response.json()),
    )

    expect(response.status).toBe(200)
    expect(body.location.directory).toBe(AbsolutePath.make(project))
    expect(body.data.find((item) => item.name === "custom")).toEqual({
      name: "custom",
      extensions: [".custom"],
      enabled: true,
    })
    expect(body.data.find((item) => item.name === "missing")).toEqual({
      name: "missing",
      extensions: [".missing"],
      enabled: false,
    })
    expect(body.data.find((item) => item.name === "gofmt")).toBeUndefined()
  }),
)
