import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { OpenCode } from "@opencode/client"
import { initRepo } from "../../core/test/fixture/git"

it.live("list reads saved inventory even when its checkout is missing, without booting a location", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-list-")))
    const directory = path.join(tmp.path, "repo")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory)
      await initRepo(directory)
    })
    const server = yield* startServer(path.join(tmp.path, "config"))
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    yield* Effect.promise(async () => {
      const session = await api.session.create({ location: { directory } })
      const loaded = await api.debug.location.list()
      await fs.rm(directory, { recursive: true })
      expect(await api.worktree.list({ projectID: session.projectID })).toEqual([{ directory }])
      await expect(api.worktree.create({ projectID: session.projectID })).rejects.toMatchObject({
        name: "WorktreeError",
        data: { message: `Worktree directory unavailable: ${directory}` },
      })
      await expect(api.worktree.refresh({ projectID: session.projectID })).rejects.toMatchObject({
        name: "WorktreeError",
        data: { message: `Worktree directory unavailable: ${directory}` },
      })
      expect(await api.debug.location.list()).toEqual(loaded)
      const missing = await fetch(`${server.base}/api/worktree?projectID=unknown`, { headers: server.headers })
      expect(missing.status).toBe(404)
      const legacy = await fetch(`${server.base}/api/worktree?location[directory]=${directory}`, {
        headers: server.headers,
      })
      expect(legacy.status).toBe(400)
    })
  }),
)

it.live("refresh discovers both clones while list alone never discovers external worktrees", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-clones-")))
    const first = path.join(tmp.path, "first")
    const second = path.join(tmp.path, "second")
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    yield* Effect.promise(async () => {
      await fs.mkdir(first)
      await initRepo(first)
      await $`git remote add origin https://github.com/example/clones.git`.cwd(first).quiet()
      await $`git clone --no-hardlinks ${first} ${second}`.quiet()
      await $`git remote set-url origin https://github.com/example/clones.git`.cwd(second).quiet()
    })
    const server = yield* startServer(path.join(tmp.path, "config"))
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    yield* Effect.promise(async () => {
      const session = await api.session.create({ location: { directory: first } })
      const other = await api.session.create({ location: { directory: second } })
      const projectID = session.projectID
      expect(other.projectID).toBe(projectID)
      await $`git worktree add --detach ${a} HEAD`.cwd(first).quiet()
      await $`git worktree add --detach ${b} HEAD`.cwd(second).quiet()
      expect(await api.worktree.list({ projectID })).toHaveLength(2)
      await api.worktree.refresh({ projectID })
      expect(await api.worktree.list({ projectID })).toEqual(
        expect.arrayContaining([
          { directory: first },
          { directory: second },
          { directory: a, strategy: "git" },
          { directory: b, strategy: "git" },
        ]),
      )
      await fs.rm(second, { recursive: true })
      await $`git worktree remove ${a}`.cwd(first).quiet()
      await api.worktree.refresh({ projectID })
      const rows = await api.worktree.list({ projectID })
      expect(rows).not.toContainEqual({ directory: a, strategy: "git" })
      expect(rows).not.toContainEqual({ directory: second })
      expect(rows).toContainEqual({ directory: b, strategy: "git" })
    })
  }),
)

it.live("remove loads canonical strategies and enforces project ownership", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-remove-")))
    const directory = path.join(tmp.path, "repo")
    const other = path.join(tmp.path, "other")
    const linked = path.join(tmp.path, "linked")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory)
      await fs.mkdir(other)
      await initRepo(directory)
      await initRepo(other)
      await $`git remote add origin https://github.com/example/remove.git`.cwd(directory).quiet()
      await $`git remote add origin https://github.com/example/other.git`.cwd(other).quiet()
      await $`git worktree add --detach ${linked} HEAD`.cwd(directory).quiet()
    })
    const server = yield* startServer(path.join(tmp.path, "config"))
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    yield* Effect.promise(async () => {
      const session = await api.session.create({ location: { directory: linked } })
      const foreign = await api.session.create({ location: { directory: other } })
      await expect(
        api.worktree.remove({ projectID: foreign.projectID, directory: linked, force: true }),
      ).rejects.toMatchObject({ name: "WorktreeError" })
      expect(await fs.stat(linked).then((stat) => stat.isDirectory())).toBe(true)
      await api.worktree.remove({ projectID: session.projectID, directory: linked, force: false })
      expect(await api.debug.location.list()).toContainEqual({ directory })
      expect(await api.worktree.list({ projectID: session.projectID })).toEqual([{ directory }])
    })
  }),
)

it.live(
  "lists, creates, and removes worktrees by project ID",
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
      const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
      const session = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
      const url = new URL("/api/worktree", server.base)
      url.searchParams.set("projectID", session.projectID)

      const initial = yield* Effect.promise(() =>
        fetch(url, { headers: server.headers }).then((response) => response.json()),
      )
      expect(initial).toEqual([{ directory: project }])

      const created = yield* Effect.promise(() =>
        fetch(url, {
          method: "POST",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ projectID: session.projectID, directory: destination, name: "api" }),
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
          body: JSON.stringify({
            projectID: session.projectID,
            directory: path.join(destination, "api"),
            force: false,
          }),
        }),
      )
      expect(removed.status).toBe(204)
    }),
  30_000,
)

it.live(
  "uses project configuration independently of default location headers",
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
        headers: { ...server.headers, "x-opencode-directory": encodeURIComponent("/unrelated-missing-directory") },
      })
      yield* Effect.promise(async () => {
        const session = await api.session.create({ location: { directory: project } })
        const projectID = session.projectID
        const created = await api.worktree.create({ projectID })
        expect(path.dirname(created.directory)).toBe(destination)
        await api.worktree.refresh({ projectID })
        expect(await api.worktree.list({ projectID })).toContainEqual({
          directory: created.directory,
          strategy: "git",
        })
        await api.worktree.remove({ projectID, directory: created.directory, force: false })
        expect(await api.worktree.list({ projectID })).toEqual([{ directory: project }])
      })
    }),
  30_000,
)

it.live(
  "uses canonical plugins for shared clones and recorded strategy removal",
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
          path.join(first, "opencode.json"),
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
        const a = await api.session.create({ location: { directory: nested } })
        const b = await api.session.create({ location: { directory: second } })
        expect(a.projectID).toBe(b.projectID)
        const projectID = a.projectID
        const custom = await api.worktree.create({ projectID, name: "custom" })
        const builtin = await api.worktree.create({ projectID, from: second, name: "other-clone" })
        expect(custom.directory).toBe(path.join(destination, "custom"))
        expect(builtin.directory).toBe(path.join(destination, "other-clone"))
        const otherRows = await api.worktree.list({ projectID: b.projectID })
        expect(otherRows).toContainEqual({ directory: custom.directory, strategy: "test-copy" })
        const rows = await api.worktree.list({ projectID })
        expect(rows).toContainEqual({
          directory: custom.directory,
          strategy: "test-copy",
        })
        expect(rows).toContainEqual({ directory: builtin.directory, strategy: "test-copy" })

        await Bun.write(path.join(custom.directory, "dirty.txt"), "keep me")
        await api.debug.location.evict({ location: { directory: first } })
        const remove = new URL("/api/worktree", server.base)
        const failure = await fetch(remove, {
          method: "DELETE",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify({ projectID, directory: custom.directory, force: false }),
        })
        expect(failure.status).toBe(400)
        expect(await failure.json()).toMatchObject({ data: { forceRequired: true } })
        expect(await Bun.file(path.join(custom.directory, "dirty.txt")).text()).toBe("keep me")
        expect(await api.worktree.list({ projectID })).toEqual(rows)
        expect(await api.debug.location.list()).toContainEqual({ directory: first })

        await api.worktree.remove({
          projectID,
          directory: custom.directory,
          force: true,
        })
        await api.worktree.remove({
          projectID,
          directory: builtin.directory,
          force: false,
        })
        expect((await api.worktree.list({ projectID })).filter((row) => row.strategy)).toEqual([])
      })
    }),
  30_000,
)

it.live(
  "canonical plugin setup can create using registrations made so far",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-worktree-delegate-")))
      const source = path.join(tmp.path, "source")
      const destination = path.join(tmp.path, "copies")
      yield* Effect.promise(async () => {
        for (const directory of [source]) {
          await fs.mkdir(directory)
          await initRepo(directory)
          await $`git remote add origin git@github.com:example/delegate-fixture.git`.cwd(directory).quiet()
        }
        await Bun.write(
          path.join(source, "opencode.json"),
          JSON.stringify({
            worktree: { directory: destination },
            plugins: [
              { package: path.join(import.meta.dir, "fixture/worktree-plugin"), options: { strategy: "target-copy" } },
              { package: path.join(import.meta.dir, "fixture/worktree-delegate") },
            ],
          }),
        )
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
      yield* Effect.promise(async () => {
        const session = await api.session.create({ location: { directory: source } })
        await api.worktree.refresh({ projectID: session.projectID })
        expect(await api.worktree.list({ projectID: session.projectID })).toContainEqual({
          directory: path.join(destination, "delegated"),
          strategy: "target-copy",
        })
      })
    }),
  30_000,
)
