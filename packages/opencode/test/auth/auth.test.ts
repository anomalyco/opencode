import { test, expect } from "bun:test"
import { Auth } from "../../src/auth"

test("set normalizes trailing slashes and stores as providerID:default", async () => {
  await Auth.set("https://example.com/", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  const data = await Auth.all()
  expect(data["https://example.com:default"]).toBeDefined()
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
  expect(keys).toEqual(["https://example.com:default"])
  const entry = data["https://example.com:default"]!
  expect(entry.type).toBe("wellknown")
  if (entry.type === "wellknown") expect(entry.token).toBe("new")
})

test("remove deletes exact key without normalization", async () => {
  // Set stores as normalized (providerID:default for bare keys)
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  const data = await Auth.all()
  expect(data["https://example.com:default"]).toBeDefined()
  // remove deletes exact key passed - so bare key won't delete the :default entry
  await Auth.remove("https://example.com")
  const after = await Auth.all()
  // Exact key "https://example.com" doesn't exist (it was stored as "https://example.com:default")
  expect(after["https://example.com:default"]).toBeDefined()
})

test("remove deletes exact key when it exists", async () => {
  // Set stores as normalized (providerID:default for bare keys)
  await Auth.set("https://example.com", {
    type: "wellknown",
    key: "TOKEN",
    token: "abc",
  })
  // remove deletes exact key - pass the actual stored key
  await Auth.remove("https://example.com:default")
  const after = await Auth.all()
  expect(after["https://example.com:default"]).toBeUndefined()
})

// Phase 1: Multi-profile auth tests

test("normalizeKey stores keys as providerID:default format", async () => {
  await Auth.set("openai", {
    type: "api",
    key: "sk-test-openai",
  })
  const data = await Auth.all()
  expect(data["openai:default"]).toBeDefined()
  expect(data["openai"]).toBeUndefined()
})

test("get returns credential for normalized key", async () => {
  await Auth.set("openai", {
    type: "api",
    key: "sk-test-openai",
  })
  const cred = await Auth.get("openai")
  expect(cred).toBeDefined()
  if (cred && cred.type === "api") {
    expect(cred.key).toBe("sk-test-openai")
  }
})

test("get falls back to bare key for backward compat", async () => {
  // Inject a bare key directly into the file for backward compat test
  // This simulates old data that wasn't migrated
  const data = await Auth.all()
  // @ts-expect-error - directly manipulating internal state for testing
  const file = require("path").join(require("@/global").Global.Path.data, "auth.json")
  const fs = require("fs/promises")
  await fs.writeFile(file, JSON.stringify({ "bare-provider": { type: "api", key: "sk-bare" } }), "utf-8")
  // Force reload by calling all()
  const allData = await Auth.all()
  expect(allData["bare-provider"]).toBeDefined()
  // get() should find it via the bare key fallback
  const cred = await Auth.get("bare-provider")
  expect(cred).toBeDefined()
  if (cred && cred.type === "api") {
    expect(cred.key).toBe("sk-bare")
  }
  // Clean up
  await Auth.remove("bare-provider")
})

test("get returns undefined for non-existent key", async () => {
  const cred = await Auth.get("non-existent-provider")
  expect(cred).toBeUndefined()
})

test("remove deletes exact key only", async () => {
  await Auth.set("to-remove", {
    type: "api",
    key: "sk-remove",
  })
  // Stored as to-remove:default
  expect(await Auth.get("to-remove")).toBeDefined()
  // Must pass exact key to delete
  await Auth.remove("to-remove:default")
  expect(await Auth.get("to-remove")).toBeUndefined()
})

test("set with trailing slash normalizes correctly", async () => {
  await Auth.set("provider-with-slash/", {
    type: "api",
    key: "sk-test",
  })
  const data = await Auth.all()
  expect(data["provider-with-slash:default"]).toBeDefined()
  expect(data["provider-with-slash/"]).toBeUndefined()
})
