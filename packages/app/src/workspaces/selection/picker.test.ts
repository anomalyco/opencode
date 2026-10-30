import { describe, expect, test } from "bun:test"
import { directoryPickerKind } from "./policy"

const local = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://127.0.0.1:28894" },
} as const

const remote = {
  type: "plugin",
  key: "ssh:example",
  plugin: "ssh",
  state: "ready",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for local desktop projects", () => {
    expect(directoryPickerKind("desktop", local, local.http.url)).toBe("native")
    expect(
      directoryPickerKind("desktop", { type: "http", http: { url: "http://localhost:28894" } }, local.http.url),
    ).toBe("native")
    expect(
      directoryPickerKind("desktop", { type: "http", http: { url: "http://localhost:4096" } }, local.http.url),
    ).toBe("server")
    expect(
      directoryPickerKind("desktop", { type: "http", http: { url: "http://localhost:49374" } }, local.http.url),
    ).toBe("server")
    expect(directoryPickerKind("desktop", remote, local.http.url)).toBe("server")
    expect(
      directoryPickerKind("desktop", { ...remote, key: "wsl:Ubuntu", plugin: "wsl", managed: false }, local.http.url),
    ).toBe("server")
    expect(directoryPickerKind("web", local, local.http.url)).toBe("server")
  })
})
