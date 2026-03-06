import { test, expect } from "bun:test"
import { Auth } from "../../src/auth"

test("set normalizes trailing slashes in keys", async () => {
  await Auth.set("https://example.com/", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  const data = await Auth.all()
  expect(data["https://example.com"]).toBeDefined()
  expect(data["https://example.com/"]).toBeUndefined()
})

test("set cleans up pre-existing trailing-slash entry", async () => {
  // Simulate a pre-fix entry with trailing slash
  await Auth.set("https://example.com/", {
    type: "wellknown",
    key: "TOKEN",
    token: "old",
  })
  // Re-login with normalized key (as the CLI does post-fix)
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "new",
  })
  const data = await Auth.all()
  const keys = Object.keys(data).filter((k) => k.includes("example.com"))
  expect(keys).toEqual(["https://example.com"])
  const entry = data["https://example.com"]!
  expect(entry.type).toBe("wellknown")
  if (entry.type === "wellknown") expect(entry.token).toBe("new")
})

test("remove deletes both trailing-slash and normalized keys", async () => {
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  await Auth.remove("https://example.com/")
  const data = await Auth.all()
  expect(data["https://example.com"]).toBeUndefined()
  expect(data["https://example.com/"]).toBeUndefined()
})

test("set and remove are no-ops on keys without trailing slashes", async () => {
  await Auth.set("anthropic", {
    type: "api",
    key: "sk-test",
  })
  const data = await Auth.all()
  expect(data["anthropic"]).toBeDefined()
  await Auth.remove("anthropic")
  const after = await Auth.all()
  expect(after["anthropic"]).toBeUndefined()
})

test("api auth preserves provider options", async () => {
  await Auth.set("anthropic", {
    type: "api",
    key: "sk-test",
    options: {
      baseURL: "https://example.com/v1",
      tls: {
        key: "./client-key.pem",
        cert: "./client-cert.pem",
      },
      headers: {
        "x-test": "1",
      },
    },
  })
  const data = await Auth.all()
  expect(data["anthropic"]).toBeDefined()
  expect(data["anthropic"].type).toBe("api")
  if (data["anthropic"].type === "api") {
    expect(data["anthropic"].options?.baseURL).toBe("https://example.com/v1")
    expect(data["anthropic"].options?.tls).toEqual({
      key: "./client-key.pem",
      cert: "./client-cert.pem",
    })
    expect(data["anthropic"].options?.headers).toEqual({
      "x-test": "1",
    })
  }
  await Auth.remove("anthropic")
})
