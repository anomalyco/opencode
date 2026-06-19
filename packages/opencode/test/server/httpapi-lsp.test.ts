import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Context, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { LspFeaturePaths } from "../../src/server/routes/instance/httpapi/groups/lsp"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

// These tests exercise the real LSP service. The fixtures disable LSP servers
// (config.lsp false / plain .txt files), so every feature method resolves with
// no attached client. That is exactly the "no client for language" path: the
// endpoints must route and return an empty/null result, never a 500.

function post(route: string, directory: string, body: unknown) {
  const url = new URL(`http://localhost${route}`)
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      method: "POST",
      headers: {
        "x-opencode-directory": directory,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    context,
  )
}

function get(route: string, directory: string, query: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      method: "GET",
      headers: { "x-opencode-directory": directory },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("lsp feature HttpApi", () => {
  const loc = { path: "file.ts", line: 0, character: 0 }

  test("hover routes and returns null/empty (no client)", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    await Bun.write(`${tmp.path}/file.ts`, "const x = 1\n")
    const res = await post(LspFeaturePaths.hover, tmp.path, loc)
    expect(res.status).toBe(200)
    const body = await res.json()
    // hover returns the array of per-client results; with no clients it is empty
    expect(Array.isArray(body) ? body.length : body).toBeFalsy()
  })

  test("definition routes and returns empty array (no client)", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    await Bun.write(`${tmp.path}/file.ts`, "const x = 1\n")
    const res = await post(LspFeaturePaths.definition, tmp.path, loc)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("references routes and returns empty array (no client)", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    await Bun.write(`${tmp.path}/file.ts`, "const x = 1\n")
    const res = await post(LspFeaturePaths.references, tmp.path, loc)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("completion routes and returns null/empty (no client)", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    await Bun.write(`${tmp.path}/file.ts`, "const x = 1\n")
    const res = await post(LspFeaturePaths.completion, tmp.path, {
      ...loc,
      triggerKind: 1,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body) ? body.length : body).toBeFalsy()
  })

  test("diagnostics routes and returns empty array for the requested file", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    await Bun.write(`${tmp.path}/file.ts`, "const x = 1\n")
    const res = await get(LspFeaturePaths.diagnostics, tmp.path, { path: "file.ts" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("path escaping the directory is rejected", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    const res = await post(LspFeaturePaths.hover, tmp.path, {
      path: "../../etc/passwd",
      line: 0,
      character: 0,
    })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})

function authApp(password: string) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: password }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return (req: Request) => handler(req, HttpApiApp.context)
}

describe("lsp feature HttpApi authorization", () => {
  test("unauthorized request is rejected", async () => {
    await using tmp = await tmpdir({ git: true, config: { lsp: false } })
    const fetch = authApp("secret")
    const url = new URL(`http://localhost${LspFeaturePaths.hover}`)
    const res = await fetch(
      new Request(url, {
        method: "POST",
        headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
        body: JSON.stringify({ path: "file.ts", line: 0, character: 0 }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
