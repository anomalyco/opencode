import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServerSettings, parseServerSettings, readServerPassword, resolveServerSettings } from "./server-settings"
import { createSettingsStore } from "../storage/store"
import { rendererRequestHeaders } from "../windows/request-headers"

const remote = { url: "https://studio.example:4096", name: "Studio", passwordFile: "studio.password" }

test.each([
  [{}, true],
  [{ startLocalServer: false }, false],
  [{ servers: [remote] }, true],
  [{ servers: [remote], defaultServer: remote.url }, false],
  [{ servers: [remote], defaultServer: remote.url, startLocalServer: true }, true],
] as const)("local startup follows explicit settings and the remote default: %j", (input, expected) => {
  expect(parseServerSettings(input).startLocalServer).toBe(expected)
})

test.each([
  { servers: "wrong" },
  { startLocalServer: "false" },
  { defaultServer: remote.url },
  { servers: [remote], defaultServer: "https://other.example" },
  { servers: [remote, { ...remote, url: `${remote.url}/` }] },
  ...[
    "file:///private",
    "https://user:secret@example.com",
    "https://example.com/?password=secret",
    "https://example.com/#secret",
    "https://example.com/path",
  ].map((url) => ({ servers: [{ url }] })),
  { servers: [{ ...remote, password: "do-not-echo" }] },
  { servers: [{ ...remote, passwordFile: "" }] },
])("invalid settings are rejected by the parser: %j", (input) => {
  expect(() => parseServerSettings(input)).toThrow()
})

test.each([
  ["{not json: never-log-this", "opencode.settings"],
  [JSON.stringify({ servers: [{ url: "invalid-never-log-this" }] }), "servers[0].url"],
  [JSON.stringify({ servers: [{ ...remote, password: "never-log-this" }] }), "servers"],
  [JSON.stringify({ servers: [remote] }), "servers[0].passwordFile"],
  [JSON.stringify({ startLocalServer: "never-log-this" }), "startLocalServer"],
])("bad settings fall back once and renderer requests still complete: %s", (text, key) => {
  const root = mkdtempSync(path.join(tmpdir(), "desktop-settings-fallback-"))
  roots.push(root)
  const file = path.join(root, "opencode.settings")
  writeFileSync(file, text)
  const messages: string[] = []
  const settings = createServerSettings(createSettingsStore(file), (message) => messages.push(message))
  const fallback = settings.get()

  expect(fallback.fallback).toBe(true)
  expect(fallback.startLocalServer).toBe(true)
  expect(fallback.public).toEqual({ servers: [], defaultServer: undefined })
  expect(fallback.authorization(remote.url)).toBeUndefined()
  expect(settings.get()).toBe(fallback)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain(key)
  expect(messages[0]).not.toContain("never-log-this")

  const responses: unknown[] = []
  rendererRequestHeaders((url) => settings.get().authorization(url))(
    {
      url: remote.url,
      requestHeaders: {},
      frame: { parent: null, url: "oc://renderer/index.html" },
    },
    (response) => responses.push(response),
  )
  expect(responses).toEqual([{ requestHeaders: {} }])
  expect(messages).toHaveLength(1)
})

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "unreadable and shared password files fall back",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "desktop-password-fallback-"))
    roots.push(root)
    const store = createSettingsStore(path.join(root, "opencode.settings"))
    store.set("servers", [remote])
    const file = path.join(root, remote.passwordFile)
    writeFileSync(file, "never-log-this")

    for (const mode of [0o000, 0o644]) {
      chmodSync(file, mode)
      const messages: string[] = []
      const settings = createServerSettings(store, (message) => messages.push(message))
      expect(settings.get().startLocalServer).toBe(true)
      expect(settings.get().fallback).toBe(true)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain("servers[0].passwordFile")
      expect(messages[0]).not.toContain("never-log-this")
    }
  },
)

test("header callbacks still complete if a credential provider fails unexpectedly", () => {
  const responses: unknown[] = []
  rendererRequestHeaders(() => {
    throw new Error("credential provider unavailable")
  })(
    {
      url: remote.url,
      requestHeaders: {},
      frame: { parent: null, url: "oc://renderer/index.html" },
    },
    (response) => responses.push(response),
  )
  expect(responses).toEqual([{ requestHeaders: {} }])
})

test.skipIf(process.platform !== "win32")("Windows reads password files without interpreting mode bits as ACLs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "desktop-windows-password-"))
  roots.push(root)
  const file = path.join(root, "password")
  writeFileSync(file, "test-password")
  expect(readServerPassword(file, root)).toBe("test-password")
})

test("normalizes URLs and keeps only password file references", () => {
  expect(
    parseServerSettings({ servers: [{ ...remote, url: `${remote.url}/` }], defaultServer: `${remote.url}/` }),
  ).toEqual({
    servers: [remote],
    defaultServer: remote.url,
    startLocalServer: false,
  })
})

const roots: string[] = []

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

// Windows has no POSIX group/world permission bits to configure for this contract.
test.skipIf(process.platform === "win32")(
  "password files must be private regular files, resolved relative to settings",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "desktop-remote-"))
    roots.push(root)
    const file = path.join(root, "password")
    writeFileSync(file, "test-password\n", { mode: 0o600 })
    expect(readServerPassword("password", root)).toBe("test-password")

    const settings = resolveServerSettings(
      parseServerSettings({ servers: [{ ...remote, passwordFile: "password" }], defaultServer: remote.url }),
      root,
    )

    expect(settings.public).toEqual({ servers: [{ url: remote.url, name: "Studio" }], defaultServer: remote.url })
    expect(settings.authorization(`${remote.url}/api/info`)).toBe(
      `Basic ${Buffer.from("opencode:test-password").toString("base64")}`,
    )

    for (const url of [
      "https://other.example/api/info",
      "http://studio.example:4096",
      "https://studio.example:4097",
      "invalid",
    ])
      expect(settings.authorization(url)).toBeUndefined()

    for (const mode of [0o640, 0o604, 0o644]) {
      chmodSync(file, mode)
      expect(() => readServerPassword(file, root)).toThrow("accessible only by its owner")
    }

    chmodSync(file, 0o600)
    writeFileSync(file, "")
    expect(() => readServerPassword(file, root)).toThrow("non-empty line")
    expect(() => readServerPassword(root, root)).toThrow("regular file")
  },
)
