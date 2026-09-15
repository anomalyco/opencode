import { afterEach, describe, expect, test } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

function app() {
  return Server.Default().app
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("permission auto lease HttpApi", () => {
  test("acquires, lists, renews and releases a lease", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const jsonHeaders = { ...headers, "content-type": "application/json" }

    const empty = await app().request("/permission/auto", { headers })
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual([])

    const acquired = await app().request("/permission/auto", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ scope: { type: "instance" } }),
    })
    expect(acquired.status).toBe(200)
    const lease = await acquired.json()
    expect(lease.id).toStartWith("pal_")
    expect(lease).toMatchObject({ scope: { type: "instance" }, ttl: PermissionV1.AUTO_LEASE_TTL_DEFAULT })

    const listed = await app().request("/permission/auto", { headers })
    expect(await listed.json()).toEqual([lease])

    const renewed = await app().request(`/permission/auto/${lease.id}/renew`, { method: "POST", headers })
    expect(renewed.status).toBe(200)
    expect((await renewed.json()).expires).toBeGreaterThanOrEqual(lease.expires)

    const released = await app().request(`/permission/auto/${lease.id}`, { method: "DELETE", headers })
    expect(released.status).toBe(200)
    expect(await released.json()).toBe(true)
    expect(await (await app().request("/permission/auto", { headers })).json()).toEqual([])

    const missing = await app().request(`/permission/auto/${lease.id}/renew`, { method: "POST", headers })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      _tag: "PermissionAutoLeaseNotFoundError",
      leaseID: lease.id,
      message: `Permission auto lease not found: ${lease.id}`,
    })
  })

  test("accepts a session scope and clamps the requested ttl", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const created = await app().request("/session", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ title: "run" }),
    })
    expect(created.status).toBe(200)
    const session = await created.json()

    const acquired = await app().request("/permission/auto", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ scope: { type: "session", sessionID: session.id }, ttl: 1 }),
    })
    expect(acquired.status).toBe(200)
    expect(await acquired.json()).toMatchObject({
      scope: { type: "session", sessionID: session.id },
      ttl: PermissionV1.AUTO_LEASE_TTL_MIN,
    })
  })

  test("rejects a scope it does not understand", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request("/permission/auto", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ scope: { type: "everything" } }),
    })
    expect(response.status).toBe(400)
  })
})
