import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Hono } from "hono"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Global } from "@opencode-ai/core/global"
import { Instance } from "../../src/project/instance"
import { InstanceMiddleware } from "../../src/server/routes/instance/middleware"
import { MultiRootWorkspace } from "../../src/workspace"
import { MultiRootWorkspaceID } from "../../src/workspace/schema"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

function buildApp(onHit: (payload: { roots: string[]; directory: string; multiRootWorkspaceID?: string }) => void) {
  const app = new Hono()
  app.use("/probe", InstanceMiddleware())
  app.get("/probe", async (c) => {
    onHit({
      directory: Instance.directory,
      roots: Instance.roots.slice(),
      multiRootWorkspaceID: Instance.multiRootWorkspaceID,
    })
    return c.json({ ok: true })
  })
  return app
}

describe("InstanceMiddleware x-opencode-multiroot-workspace", () => {
  test("expands roots using the referenced multi-root workspace", async () => {
    await using primary = await tmpdir({ git: true })
    await using secondary = await tmpdir({ git: true })

    const workspace = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.create({
          name: `test-${Date.now()}`,
          folders: [{ path: primary.path }, { path: secondary.path }],
        }),
      ),
    )

    let captured: { roots: string[]; directory: string; multiRootWorkspaceID?: string } | undefined
    const app = buildApp((p) => (captured = p))

    const response = await app.request("/probe", {
      headers: {
        "x-opencode-multiroot-workspace": workspace.id,
      },
    })

    expect(response.status).toBe(200)
    expect(captured).toBeDefined()
    expect(captured!.multiRootWorkspaceID).toBe(workspace.id)
    expect(captured!.roots).toEqual([primary.path, secondary.path])
    expect(captured!.directory).toBe(primary.path)
  })

  test("keeps explicit x-opencode-directory as the primary when it matches a folder", async () => {
    await using primary = await tmpdir({ git: true })
    await using secondary = await tmpdir({ git: true })

    const workspace = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.create({
          name: `test-explicit-${Date.now()}`,
          folders: [{ path: primary.path }, { path: secondary.path }],
        }),
      ),
    )

    let captured: { roots: string[]; directory: string; multiRootWorkspaceID?: string } | undefined
    const app = buildApp((p) => (captured = p))

    const response = await app.request("/probe", {
      headers: {
        "x-opencode-multiroot-workspace": workspace.id,
        "x-opencode-directory": secondary.path,
      },
    })

    expect(response.status).toBe(200)
    expect(captured!.directory).toBe(secondary.path)
    expect(captured!.roots[0]).toBe(secondary.path)
    expect(captured!.roots).toContain(primary.path)
    expect(captured!.multiRootWorkspaceID).toBe(workspace.id)
  })

  test("falls back to single-root when header references an unknown workspace", async () => {
    await using primary = await tmpdir({ git: true })

    let captured: { roots: string[]; directory: string; multiRootWorkspaceID?: string } | undefined
    const app = buildApp((p) => (captured = p))

    const response = await app.request("/probe", {
      headers: {
        "x-opencode-multiroot-workspace": "unknown-workspace",
        "x-opencode-directory": primary.path,
      },
    })

    expect(response.status).toBe(200)
    expect(captured!.multiRootWorkspaceID).toBeUndefined()
    expect(captured!.roots).toEqual([primary.path])
  })

  test("without the header keeps single-root semantics", async () => {
    await using primary = await tmpdir({ git: true })

    let captured: { roots: string[]; directory: string; multiRootWorkspaceID?: string } | undefined
    const app = buildApp((p) => (captured = p))

    const response = await app.request("/probe", {
      headers: {
        "x-opencode-directory": primary.path,
      },
    })

    expect(response.status).toBe(200)
    expect(captured!.multiRootWorkspaceID).toBeUndefined()
    expect(captured!.roots).toEqual([primary.path])
  })
})

describe("MultiRootWorkspace external import", () => {
  test("copies imported workspace files before managing them", async () => {
    await using primary = await tmpdir({ git: true })
    await using secondary = await tmpdir({ git: true })

    const name = `external-${Date.now()}`
    const externalDir = path.join(Global.Path.home, ".cursor", "workspaces")
    const externalFile = path.join(externalDir, `${name}.code-workspace`)
    await mkdir(externalDir, { recursive: true })
    await Bun.write(
      externalFile,
      JSON.stringify({
        folders: [{ path: primary.path }],
        settings: {},
      }),
    )

    const imported = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.list().pipe(
          Effect.map((list) => {
            const workspace = list.find((item) => item.name === name)
            expect(workspace).toBeDefined()
            return workspace!
          }),
        )
      ),
    )

    expect(imported.filePath).not.toBe(externalFile)
    expect(imported.filePath).toBe(path.join(Global.Path.data, "workspaces", `${name}.code-workspace`))

    await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) => svc.addFolder(imported.id, { path: secondary.path })),
    )

    expect(JSON.parse(await Bun.file(externalFile).text()).folders).toEqual([{ path: primary.path }])

    await AppRuntime.runPromise(MultiRootWorkspace.Service.use((svc) => svc.delete(imported.id)))

    expect(await Bun.file(externalFile).exists()).toBe(true)
    expect(await Bun.file(imported.filePath).exists()).toBe(false)
  })
})

describe("MultiRootWorkspace rename", () => {
  test("renames a workspace and reflects the new name in list", async () => {
    await using primary = await tmpdir({ git: true })

    const original = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.create({
          name: `rename-test-${Date.now()}`,
          folders: [{ path: primary.path }],
        }),
      ),
    )
    const newName = `renamed-${Date.now()}`

    const renamed = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) => svc.rename(original.id, newName)),
    )

    expect(renamed.name).toBe(newName)
    expect(renamed.id).toBe(original.id)
    expect(renamed.folders).toEqual(original.folders)
    expect(renamed.filePath).toContain(newName)

    const list = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) => svc.list()),
    )
    const found = list.find((w) => w.id === original.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(newName)
    expect(list.some((w) => w.name === original.name && w.id === original.id)).toBe(false)
  })

  test("rename to the same name is a no-op that returns the workspace unchanged", async () => {
    await using primary = await tmpdir({ git: true })

    const ws = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.create({
          name: `noop-rename-${Date.now()}`,
          folders: [{ path: primary.path }],
        }),
      ),
    )

    const renamed = await AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) => svc.rename(ws.id, ws.name)),
    )

    expect(renamed.name).toBe(ws.name)
    expect(renamed.filePath).toBe(ws.filePath)
  })

  test("throws WorkspaceNotFoundError when renaming a non-existent workspace", async () => {
    const fakeID = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())

    const result = AppRuntime.runPromise(
      MultiRootWorkspace.Service.use((svc) =>
        svc.rename(fakeID, "does-not-matter"),
      ),
    )

    await expect(result).rejects.toBeInstanceOf(MultiRootWorkspace.WorkspaceNotFoundError)
  })
})
