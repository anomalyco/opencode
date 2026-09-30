import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const widgetFile = (root: string, id: string, asset: string) => path.join(root, "widgets", id, asset)

it.live("lists widgets and serves assets from a public path", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const config = path.join(tmp.path, "config")
    yield* Effect.promise(async () => {
      await fs.mkdir(widgetFile(config, "demo", ""), { recursive: true })
      await fs.writeFile(widgetFile(config, "demo", "widget.json"), JSON.stringify({ title: "Demo", capabilities: ["read"] }))
      await fs.writeFile(widgetFile(config, "demo", "index.html"), "<h1>Demo</h1>")
      await fs.writeFile(widgetFile(config, "demo", "app.js"), "console.log('demo')")
    })
    const server = yield* startServer(config)

    // The list is authorized and reports the requested capabilities.
    const listed = yield* Effect.promise(async () => {
      const response = await fetch(new URL("/api/widget", server.base), { headers: server.headers })
      expect(response.status).toBe(200)
      return response.json()
    })
    const demo = listed.data.find((item: { id: string }) => item.id === "demo")
    expect(demo.title).toBe("Demo")
    expect(demo.requests).toEqual(["read"])

    // The asset path is public: a sandboxed frame loads it without credentials.
    const asset = yield* Effect.promise(async () => {
      const response = await fetch(new URL("/widget/demo/", server.base))
      expect(response.status).toBe(200)
      return { body: await response.text(), type: response.headers.get("content-type") }
    })
    expect(asset.body).toContain("Demo")
    expect(asset.type).toContain("text/html")

    // A nested asset resolves relative to the widget folder.
    const script = yield* Effect.promise(() => fetch(new URL("/widget/demo/app.js", server.base)))
    expect(script.status).toBe(200)
    expect(yield* Effect.promise(() => script.text())).toContain("console.log('demo')")

    // The bridge helper is served for the reserved id, also publicly.
    const helper = yield* Effect.promise(() => fetch(new URL("/widget/@opencode/bridge.js", server.base)))
    expect(helper.status).toBe(200)
    expect(yield* Effect.promise(() => helper.text())).toContain("window.opencode")

    // Path traversal out of the widget root is refused: the request falls back to
    // the widget entry rather than serving a file outside the folder.
    const traversal = yield* Effect.promise(() => fetch(new URL("/widget/demo/..%2f..%2fopencode.json", server.base)))
    const traversalBody = yield* Effect.promise(() => traversal.text())
    expect(traversalBody).toContain("Demo")
    expect(traversalBody).not.toContain("capabilities")

    // The list still requires credentials.
    const unauthorized = yield* Effect.promise(() => fetch(new URL("/api/widget", server.base)))
    expect(unauthorized.status).toBe(401)
  }),
)
