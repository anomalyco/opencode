import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { CredentialPool } from "../../src/credentials/pool"
import { CredentialStore } from "../../src/credentials/store"
import { RotatingFetch } from "../../src/inference/rotating-fetch"

async function resetCredentials() {
  await fs.rm(path.join(Global.Path.data, "credentials"), { recursive: true, force: true })
}

describe("RotatingFetch", () => {
  test("rotates credentials on 429 within the same request", async () => {
    await resetCredentials()

    const id1 = "cred-1"
    const id2 = "cred-2"

    await CredentialStore.put({
      id: id1,
      providerId: "openai",
      namespace: "default",
      kind: "oauth",
      label: "default",
      secret: { accessToken: "t1", refreshToken: "r1" },
    })
    await CredentialStore.put({
      id: id2,
      providerId: "openai",
      namespace: "default",
      kind: "oauth",
      label: "second",
      secret: { accessToken: "t2", refreshToken: "r2" },
	    })

	    const seenAuth: Array<string | null> = []
	    const baseFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	      const req = new Request(input, init)
	      const auth = req.headers.get("Authorization")
	      seenAuth.push(auth)

      if (auth === "Bearer t1") {
        return new Response("rate_limited", { status: 429, headers: { "Retry-After": "0" } })
      }
      if (auth === "Bearer t2") {
        return new Response("ok", { status: 200 })
      }
      return new Response("missing_auth", { status: 401 })
    }

    const rotating = RotatingFetch.create(baseFetch, { providerId: "openai", namespace: "default" })
    const resp = await rotating("https://example.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })

    expect(resp.status).toBe(200)
    expect(seenAuth).toEqual(["Bearer t1", "Bearer t2"])

    const ordered = await CredentialPool.getOrderedIds("openai", "default", [id1, id2])
    expect(ordered).toEqual([id2, id1])

    const updated1 = await CredentialStore.getRecordFile(id1)
    const updated2 = await CredentialStore.getRecordFile(id2)
    expect(updated1?.meta.health.lastStatusCode).toBe(429)
    expect((updated1?.meta.health.failureCount ?? 0) >= 1).toBe(true)
    expect(updated1?.meta.health.cooldownUntil).toBeDefined()
    expect(updated2?.meta.health.lastStatusCode).toBe(200)
    expect((updated2?.meta.health.successCount ?? 0) >= 1).toBe(true)
  })

  test("rotates credentials on 401 within the same request", async () => {
    await resetCredentials()

    const id1 = "cred-1"
    const id2 = "cred-2"

    await CredentialStore.put({
      id: id1,
      providerId: "github-copilot",
      namespace: "default",
      kind: "oauth",
      label: "default",
      secret: { accessToken: "t1", refreshToken: "r1" },
    })
    await CredentialStore.put({
      id: id2,
      providerId: "github-copilot",
      namespace: "default",
      kind: "oauth",
      label: "second",
      secret: { accessToken: "t2", refreshToken: "r2" },
    })

    const seenAuth: Array<string | null> = []
    const baseFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input, init)
      const auth = req.headers.get("Authorization")
      seenAuth.push(auth)

      if (auth === "Bearer t1") return new Response("expired", { status: 401 })
      if (auth === "Bearer t2") return new Response("ok", { status: 200 })
      return new Response("missing_auth", { status: 401 })
    }

    const rotating = RotatingFetch.create(baseFetch, { providerId: "github-copilot", namespace: "default" })
    const resp = await rotating("https://example.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })

    expect(resp.status).toBe(200)
    expect(seenAuth).toEqual(["Bearer t1", "Bearer t2"])

    const ordered = await CredentialPool.getOrderedIds("github-copilot", "default", [id1, id2])
    expect(ordered).toEqual([id2, id1])

    const updated1 = await CredentialStore.getRecordFile(id1)
    expect(updated1?.meta.health.lastStatusCode).toBe(401)
    expect((updated1?.meta.health.failureCount ?? 0) >= 1).toBe(true)
    expect(updated1?.meta.health.cooldownUntil).toBeDefined()
  })

  test("uses canonical provider pool + credentials across alias ids", async () => {
    await resetCredentials()

    await CredentialStore.put({
      id: "cred-1",
      providerId: "github-copilot",
      namespace: "default",
      kind: "oauth",
      label: "default",
      secret: { accessToken: "t1", refreshToken: "r1" },
    })

    const seenAuth: Array<string | null> = []
    const baseFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input, init)
      const auth = req.headers.get("Authorization")
      seenAuth.push(auth)
      if (auth === "Bearer t1") return new Response("ok", { status: 200 })
      return new Response("missing_auth", { status: 401 })
    }

    const rotating = RotatingFetch.create(baseFetch, { providerId: "github-copilot-enterprise", namespace: "default" })
    const resp = await rotating("https://example.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })

    expect(resp.status).toBe(200)
    expect(seenAuth).toEqual(["Bearer t1"])
  })
})
