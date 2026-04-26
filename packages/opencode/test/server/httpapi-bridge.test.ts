import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { FilePaths } from "../../src/server/routes/instance/httpapi/file"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app(input?: { password?: string; username?: string }) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  Flag.OPENCODE_SERVER_PASSWORD = input?.password
  Flag.OPENCODE_SERVER_USERNAME = input?.username
  return InstanceRoutes(websocket)
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function fileUrl(input?: { directory?: string; token?: string }) {
  const url = new URL(`http://localhost${FilePaths.content}`)
  url.searchParams.set("path", "hello.txt")
  if (input?.directory) url.searchParams.set("directory", input.directory)
  if (input?.token) url.searchParams.set("auth_token", input.token)
  return url
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi Hono bridge", () => {
  test("allows requests when auth is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app().request(fileUrl(), {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "hello" })
  })

  test("provides instance context to bridged handlers", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await app().request("/project/current", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ worktree: tmp.path })
  })

  test("requires credentials when auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const [missing, bad, good] = await Promise.all([
      app({ password: "secret" }).request(fileUrl(), {
        headers: { "x-opencode-directory": tmp.path },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "wrong"),
          "x-opencode-directory": tmp.path,
        },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "secret"),
          "x-opencode-directory": tmp.path,
        },
      }),
    ])

    expect(missing.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
  })

  test("accepts auth_token query credentials", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app({ password: "secret" }).request(
      fileUrl({ token: Buffer.from("opencode:secret").toString("base64") }),
      {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      },
    )

    expect(response.status).toBe(200)
  })

  test("selects instance from query before directory header", async () => {
    await using header = await tmpdir({ git: true })
    await using query = await tmpdir({ git: true })
    await Bun.write(`${header.path}/hello.txt`, "header")
    await Bun.write(`${query.path}/hello.txt`, "query")

    const response = await app().request(fileUrl({ directory: query.path }), {
      headers: {
        "x-opencode-directory": header.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "query" })
  })
})
