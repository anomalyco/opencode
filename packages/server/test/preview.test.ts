import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer, waitForAgentPolicy } from "./fixture/server"

it.live("a linked workspace uses workspace-relative read rules, not permissions for the link target", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const parent = path.join(tmp.path, "physical")
    const root = path.join(parent, "Project")
    const alias = path.join(tmp.path, "Workspace")
    const outside = path.join(tmp.path, "outside")
    const link = process.platform === "win32" ? "junction" : "dir"
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(root, "private"), { recursive: true })
      await fs.mkdir(outside)
      await fs.symlink(parent, alias, link)
      await fs.symlink(path.join(root, "private"), path.join(root, "assets"), link)
      await fs.symlink(outside, path.join(root, "external"), link)
      await fs.writeFile(path.join(root, "index.html"), "page")
      await fs.writeFile(path.join(root, "style.css"), "control")
      await fs.writeFile(path.join(root, "private", "asset.css"), "private")
      await fs.writeFile(path.join(outside, "asset.css"), "outside")
      await fs.writeFile(
        path.join(root, "opencode.json"),
        JSON.stringify({
          permissions: [
            { action: "external_directory", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "deny" },
            { action: "read", resource: "index.html", effect: "allow" },
            { action: "read", resource: "style.css", effect: "allow" },
            { action: "read", resource: "assets/*", effect: "allow" },
            { action: "read", resource: "private/*", effect: "deny" },
          ],
        }),
      )
    })
    const server = yield* startServer(path.join(tmp.path, "config"))
    const alternate = path.join(tmp.path, "wOrKsPaCe", "pRoJeCt")
    const directory =
      (yield* Effect.promise(() =>
        fs.stat(alternate).then(
          () => alternate,
          () => path.join(alias, "Project"),
        ),
      )) + path.sep
    const data = yield* Effect.promise(async () => {
      const created = await fetch(new URL("/api/session", server.base), {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ location: { directory } }),
      })
      expect(created.ok).toBe(true)
      return (await created.json()).data
    })
    yield* waitForAgentPolicy(server, data.location.directory)
    yield* Effect.promise(async () => {
      const preview = new URL("/api/experimental/preview/read", server.base)
      preview.search = new URLSearchParams({
        "location[directory]": data.location.directory,
        sessionID: data.id,
        root: "bind",
        document: "index.html",
        path: "index.html",
        entry: "1",
      }).toString()
      const bound = await fetch(preview, { method: "HEAD", headers: server.headers })
      const pin = bound.headers.get("x-opencode-preview-root")
      expect(pin).toMatch(/^[a-f0-9]{64}$/)
      preview.searchParams.set("root", pin ?? "")
      for (const [file, guarded, status, body] of [
        ["index.html", true, 200, "page"],
        ["style.css", true, 200, "control"],
        ["private/asset.css", true, 404, ""],
        ["assets/asset.css", true, 404, ""],
        ["assets/asset.css", false, 200, "private"],
        ["external/asset.css", true, 404, ""],
        ["external/asset.css", false, 404, ""],
      ] as const) {
        preview.searchParams.set("path", file)
        const read = await fetch(preview, {
          headers: { ...server.headers, ...(guarded && { "x-opencode-preview-policy": "agent" }) },
        })
        expect([file, read.status, await read.text()]).toEqual([file, status, body])
      }
    })
  }),
)
