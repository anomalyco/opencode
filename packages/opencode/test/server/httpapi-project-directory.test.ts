import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { disposeMiddleware } from "../../src/server/routes/instance/httpapi/lifecycle"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const handler = HttpRouter.toWebHandler(HttpApiApp.routes, { disableLogger: true, middleware: disposeMiddleware }).handler
const request = (url: string, init?: RequestInit) =>
  handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)
const route = (path: string, directory: string) => `${path}?directory=${encodeURIComponent(directory)}`

async function projectAt(directory: string) {
  const response = await request(route("/project/current", directory))
  expect(response.status).toBe(200)
  return (await response.json()) as { id: string; worktree: string; vcs: string | null; sandboxes: string[] }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("associating a previously opened directory takes effect on the next request", async () => {
  await using checkout = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
  const owner = await projectAt(checkout.path)
  expect((await projectAt(workspace.path)).id).toBe("global")

  // Routing to the target first boots its cached global instance. The association
  // handler must dispose that instance after responding so the next request resolves again.
  const create = await request(route(`/project/${owner.id}/directories`, workspace.path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: workspace.path, strategy: "manual" }),
  })
  expect(create.status).toBe(200)
  expect(await create.json()).toEqual(expect.arrayContaining([{ directory: workspace.path, strategy: "manual" }]))

  const associated = await projectAt(workspace.path)
  expect(associated.id).toBe(owner.id)
  expect(associated.worktree).toBe(checkout.path)
  expect(associated.vcs).toBe("git")
  expect(associated.sandboxes).not.toContain(workspace.path)

  const remove = await request(route(`/project/${owner.id}/directories`, workspace.path), { method: "DELETE" })
  expect(remove.status).toBe(200)
  expect((await projectAt(workspace.path)).id).toBe("global")
})

test("association rejects an unknown project", async () => {
  await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
  const response = await request(route("/project/missing/directories", workspace.path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: workspace.path }),
  })
  expect(response.status).toBe(404)
})

test("association canonicalizes symlink paths and rejects relative paths", async () => {
  await using checkout = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
  await using aliases = await tmpdir({ config: { formatter: false, lsp: false } })
  const alias = path.join(aliases.path, "workspace-link")
  await fs.symlink(workspace.path, alias)
  const owner = await projectAt(checkout.path)

  const relative = await request(route(`/project/${owner.id}/directories`, workspace.path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: "relative/workspace" }),
  })
  expect(relative.status).toBe(400)

  const create = await request(route(`/project/${owner.id}/directories`, workspace.path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: alias }),
  })
  expect(create.status).toBe(200)
  expect(await create.json()).toEqual(expect.arrayContaining([{ directory: workspace.path }]))
  expect((await projectAt(workspace.path)).id).toBe(owner.id)

  const remove = await request(route(`/project/${owner.id}/directories`, alias), { method: "DELETE" })
  expect(remove.status).toBe(200)
  expect((await projectAt(workspace.path)).id).toBe("global")
})
