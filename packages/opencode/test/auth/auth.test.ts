import { test, expect } from "bun:test"
import path from "path"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

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

test("file resolves OPENCODE_AUTH_PATH relative to data dir", () => {
  const prev = process.env.OPENCODE_AUTH_PATH
  process.env.OPENCODE_AUTH_PATH = "custom-auth.json"
  try {
    expect(Auth.file()).toBe(path.join(Global.Path.data, "custom-auth.json"))
  } finally {
    if (prev === undefined) {
      delete process.env.OPENCODE_AUTH_PATH
      return
    }
    process.env.OPENCODE_AUTH_PATH = prev
  }
})

test("file keeps OPENCODE_AUTH_PATH absolute", () => {
  const prev = process.env.OPENCODE_AUTH_PATH
  const auth = path.join(Global.Path.data, "auth-alt.json")
  process.env.OPENCODE_AUTH_PATH = auth
  try {
    expect(Auth.file()).toBe(auth)
  } finally {
    if (prev === undefined) {
      delete process.env.OPENCODE_AUTH_PATH
      return
    }
    process.env.OPENCODE_AUTH_PATH = prev
  }
})
