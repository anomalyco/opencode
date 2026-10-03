import { afterAll, describe, expect, test } from "bun:test"
import type { OpencodeClientConfig } from "../src/client"

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    return Response.json({
      headers: Object.fromEntries(request.headers),
      url: request.url,
      body: await request.text(),
    })
  },
})

afterAll(() => server.stop(true))

describe.each(["v1", "v2"] as const)("%s client headers", (version) => {
  test.each([
    ["Headers", () => new Headers({ authorization: "Bearer test", "x-custom": "kept" })],
    ["record", () => ({ authorization: "Bearer test", "x-custom": "kept" })],
  ] as const)("preserves %s headers with a configured directory", async (_, headers) => {
    const result = await request(version, { headers: headers(), directory: "/tmp/測試 project" })

    expect(result.data).toMatchObject({
      headers: { authorization: "Bearer test", "x-custom": "kept" },
      url: `${server.url}project?directory=%2Ftmp%2F%E6%B8%AC%E8%A9%A6+project`,
    })
    expect(result.request.headers.has("x-opencode-directory")).toBe(false)
  })

  test("keeps scope headers and JSON content type on POST requests", async () => {
    const result = await request(
      version,
      { headers: new Headers({ authorization: "Bearer test" }), directory: "/tmp/測試 project" },
      "POST",
    )

    expect(result.data).toMatchObject({
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "x-opencode-directory": encodeURIComponent("/tmp/測試 project"),
      },
      body: JSON.stringify({ title: "test" }),
    })
  })

  test("preserves extended record header values", async () => {
    const result = await request(version, {
      directory: "/tmp/project",
      headers: {
        authorization: "Bearer test",
        "x-values": ["one", "two"],
        "x-count": 2,
        "x-enabled": true,
        "x-object": { key: "value" },
        "x-empty": null,
        "x-unset": undefined,
      },
    })

    expect(result.data).toMatchObject({
      headers: {
        authorization: "Bearer test",
        "x-values": "one, two",
        "x-count": "2",
        "x-enabled": "true",
        "x-object": '{"key":"value"}',
      },
    })
    expect(result.request.headers.has("x-empty")).toBe(false)
    expect(result.request.headers.has("x-unset")).toBe(false)
  })

  test("configured directory overrides the supplied scope header", async () => {
    const result = await request(version, {
      directory: "/tmp/configured",
      headers: new Headers({ "X-Opencode-Directory": "/tmp/original", authorization: "Bearer test" }),
    })

    expect(result.data).toMatchObject({
      headers: { authorization: "Bearer test" },
      url: `${server.url}project?directory=%2Ftmp%2Fconfigured`,
    })
  })

  test("keeps caller-owned headers and configuration unchanged", async () => {
    const { createOpencodeClient } = await import(version === "v1" ? "../src/client" : "../src/v2/client")
    const headers = new Headers({ authorization: "Bearer test" })
    const config = {
      baseUrl: server.url.href,
      fetch,
      directory: "/tmp/configured",
      experimental_workspaceID: "workspace-configured",
      headers,
    }
    const client = createOpencodeClient(config)
    const result = await client.project.list()

    expect(config.headers).toBe(headers)
    expect(Object.fromEntries(headers)).toEqual({ authorization: "Bearer test" })
    expect(config.directory).toBe("/tmp/configured")
    expect(config.experimental_workspaceID).toBe("workspace-configured")
    expect(result.data).toMatchObject({ headers: { authorization: "Bearer test" } })
    expect(new URL(result.request.url).searchParams.get("directory")).toBe("/tmp/configured")
    expect(new URL(result.request.url).searchParams.get("workspace")).toBe(
      version === "v2" ? "workspace-configured" : null,
    )
  })
})

test.each([undefined, "/tmp/project"])("v2 preserves headers with workspace and directory %s", async (directory) => {
  const result = await request("v2", {
    directory,
    experimental_workspaceID: "workspace-configured",
    headers: new Headers({ authorization: "Bearer test", "X-Opencode-Workspace": "workspace-original" }),
  })

  expect(result.data).toMatchObject({ headers: { authorization: "Bearer test" } })
  expect(new URL(result.request.url).searchParams.get("workspace")).toBe("workspace-configured")
  expect(result.request.headers.has("x-opencode-workspace")).toBe(false)
})

test("v2 keeps explicit request scope and header overrides", async () => {
  const { createOpencodeClient } = await import("../src/v2/client")
  const client = createOpencodeClient({
    baseUrl: server.url.href,
    directory: "/tmp/configured",
    experimental_workspaceID: "workspace-configured",
    headers: new Headers({ authorization: "Bearer configured", "x-remove": "configured" }),
  })
  const result = await client.project.list(
    { directory: "/tmp/request", workspace: "workspace-request" },
    { headers: { authorization: "Bearer request", "x-remove": null } },
  )

  expect(result.data).toMatchObject({ headers: { authorization: "Bearer request" } })
  expect(new URL(result.request.url).searchParams.get("directory")).toBe("/tmp/request")
  expect(new URL(result.request.url).searchParams.get("workspace")).toBe("workspace-request")
  expect(result.request.headers.has("x-remove")).toBe(false)
})

async function request(
  version: "v1" | "v2",
  config: OpencodeClientConfig & { directory?: string; experimental_workspaceID?: string },
  method: "GET" | "POST" = "GET",
) {
  if (version === "v1") {
    const { createOpencodeClient } = await import("../src/client")
    const client = createOpencodeClient({ baseUrl: server.url.href, ...config })
    return method === "GET" ? client.project.list() : client.session.create({ body: { title: "test" } })
  }
  const { createOpencodeClient } = await import("../src/v2/client")
  const client = createOpencodeClient({ baseUrl: server.url.href, ...config })
  return method === "GET" ? client.project.list() : client.session.create({ title: "test" })
}
