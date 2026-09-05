import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { OpenCode } from "@opencode-ai/client"
import { initRepo } from "../../core/test/fixture/git"

it.live(
  "lists, creates, and removes worktrees through the same location",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-endpoint-")))
      const project = path.join(tmp.path, "project")
      const destination = path.join(tmp.path, "worktrees")
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      yield* Effect.promise(() => $`git init`.cwd(project).quiet())
      yield* Effect.promise(() => $`git config user.email test@opencode.test`.cwd(project).quiet())
      yield* Effect.promise(() => $`git config user.name Test`.cwd(project).quiet())
      yield* Effect.promise(() => $`git commit --allow-empty -m root`.cwd(project).quiet())
      const server = yield* startServer(path.join(tmp.path, "config"))
      const url = new URL("/api/worktree", server.base)
      url.searchParams.set("location[directory]", project)

      const initial = yield* Effect.promise(() =>
        fetch(url, { headers: server.headers }).then((response) => response.json()),
      )
      expect(initial).toEqual([{ directory: project }])

      const created = yield* Effect.promise(() =>
        fetch(url, {
          method: "POST",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ strategy: "git", directory: destination, name: "api" }),
        }).then((response) => response.json()),
      )
      expect(created).toEqual({ directory: path.join(destination, "api") })

      const listed = yield* Effect.promise(() =>
        fetch(url, { headers: server.headers }).then((response) => response.json()),
      )
      expect(listed).toContainEqual({
        directory: path.join(destination, "api"),
        strategy: "git",
      })

      const removed = yield* Effect.promise(() =>
        fetch(url, {
          method: "DELETE",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ directory: path.join(destination, "api"), force: false }),
        }),
      )
      expect(removed.status).toBe(204)
    }),
  30_000,
)

it.live(
  "derives the project and creation defaults when the SDK omits its input",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-default-location-")))
      const project = path.join(tmp.path, "project")
      const config = path.join(tmp.path, "config")
      const destination = path.join(tmp.path, "copies")
      yield* Effect.promise(async () => {
        await fs.mkdir(project)
        await initRepo(project)
        await fs.mkdir(config)
        await Bun.write(path.join(config, "opencode.json"), JSON.stringify({ worktree: { directory: destination } }))
      })
      const server = yield* startServer(config)
      const api = OpenCode.make({
        baseUrl: server.base,
        headers: { ...server.headers, "x-opencode-directory": encodeURIComponent(project) },
      })
      yield* Effect.promise(async () => {
        const created = await api.worktree.create()
        expect(path.dirname(created.directory)).toBe(destination)
        await api.worktree.refresh()
        expect(await api.worktree.list()).toContainEqual({
          directory: created.directory,
          strategy: "git",
        })
        await api.worktree.remove({ directory: created.directory, force: false })
        expect(await api.worktree.list()).toEqual([{ directory: project }])
      })
    }),
  30_000,
)

it.live(
  "uses checkout-local plugins and configuration for clones sharing a project",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-plugins-")))
      const first = path.join(tmp.path, "first")
      const second = path.join(tmp.path, "second")
      const nested = path.join(first, "nested")
      const config = path.join(tmp.path, "config")
      const destination = path.join(tmp.path, "worktrees")
      yield* Effect.promise(async () => {
        await fs.mkdir(first)
        await initRepo(first)
        await $`git remote add origin git@github.com:example/worktree-fixture.git`.cwd(first).quiet()
        await $`git clone --no-hardlinks ${first} ${second}`.quiet()
        await $`git remote set-url origin https://github.com/example/worktree-fixture.git`.cwd(second).quiet()
        await fs.mkdir(nested)
        await fs.mkdir(config)
        await Bun.write(path.join(config, "opencode.json"), JSON.stringify({ worktree: { directory: destination } }))
        await Bun.write(
          path.join(nested, "opencode.json"),
          JSON.stringify({
            plugins: [
              { package: path.join(import.meta.dir, "fixture/worktree-plugin"), options: { strategy: "test-copy" } },
            ],
          }),
        )
      })
      const server = yield* startServer(config)
      const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
      yield* Effect.promise(async () => {
        const a = await api.location.get({ location: { directory: nested } })
        const b = await api.location.get({ location: { directory: second } })
        expect(a.project.id).toBe(b.project.id)
        const custom = await api.worktree.create({ location: { directory: nested }, name: "custom" })
        const builtin = await api.worktree.create({ location: { directory: second }, name: "builtin" })
        expect(custom.directory).toBe(path.join(destination, "custom"))
        expect(builtin.directory).toBe(path.join(destination, "builtin"))
        const otherRows = await api.worktree.list({ location: { directory: second } })
        expect(otherRows).toContainEqual({ directory: custom.directory, strategy: "test-copy" })
        const rows = await api.worktree.list({ location: { directory: nested } })
        expect(rows).toContainEqual({
          directory: custom.directory,
          strategy: "test-copy",
        })
        expect(rows).toContainEqual({ directory: builtin.directory, strategy: "git" })

        await Bun.write(path.join(custom.directory, "dirty.txt"), "keep me")
        const remove = new URL("/api/worktree", server.base)
        remove.searchParams.set("location[directory]", second)
        const unavailable = await fetch(remove, {
          method: "DELETE",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ directory: custom.directory, force: true }),
        })
        expect(unavailable.status).toBe(400)
        expect(await unavailable.json()).toMatchObject({
          data: { message: "Worktree strategy unavailable: test-copy" },
        })
        expect(await Bun.file(path.join(custom.directory, "dirty.txt")).text()).toBe("keep me")
        remove.searchParams.set("location[directory]", nested)
        const failure = await fetch(remove, {
          method: "DELETE",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ directory: custom.directory, force: false }),
        })
        expect(failure.status).toBe(400)
        expect(await failure.json()).toMatchObject({ data: { forceRequired: true } })
        expect(await Bun.file(path.join(custom.directory, "dirty.txt")).text()).toBe("keep me")

        await api.worktree.remove({
          location: { directory: nested },
          directory: custom.directory,
          force: true,
        })
        await api.worktree.remove({
          location: { directory: second },
          directory: builtin.directory,
          force: false,
        })
        expect((await api.worktree.list({ location: { directory: nested } })).filter((row) => row.strategy)).toEqual([])
      })
    }),
  30_000,
)

it.live(
  "plugin calls await a different location's strategy and directory configuration",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-delegate-")))
      const source = path.join(tmp.path, "source")
      const target = path.join(tmp.path, "target")
      const destination = path.join(tmp.path, "copies")
      yield* Effect.promise(async () => {
        for (const directory of [source, target]) {
          await fs.mkdir(directory)
          await initRepo(directory)
          await $`git remote add origin git@github.com:example/delegate-fixture.git`.cwd(directory).quiet()
        }
        await Bun.write(
          path.join(source, "opencode.json"),
          JSON.stringify({
            plugins: [
              { package: path.join(import.meta.dir, "fixture/worktree-delegate"), options: { directory: target } },
            ],
          }),
        )
        await Bun.write(
          path.join(target, "opencode.json"),
          JSON.stringify({
            worktree: { directory: destination },
            plugins: [
              { package: path.join(import.meta.dir, "fixture/worktree-plugin"), options: { strategy: "target-copy" } },
            ],
          }),
        )
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
      yield* Effect.promise(async () => {
        await api.location.get({ location: { directory: source } })
        const url = new URL("/api/plugin/await-activation", server.base)
        url.searchParams.set("location[directory]", source)
        expect((await fetch(url, { method: "POST", headers: server.headers })).status).toBe(204)
        expect(await api.worktree.list({ location: { directory: target } })).toContainEqual({
          directory: path.join(destination, "delegated"),
          strategy: "target-copy",
        })
      })
    }),
  30_000,
)
