import { describe, expect, test } from "bun:test"
import { directoryPickerKind } from "./policy"

const local = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://localhost:4096" },
} as const
const remote = {
  type: "extension",
  key: "ssh:example",
  extension: "ssh",
  state: "ready",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for local desktop projects", () => {
    expect(directoryPickerKind("desktop", local)).toBe("native")
    expect(directoryPickerKind("desktop", remote)).toBe("server")
    expect(directoryPickerKind("desktop", { ...remote, key: "wsl:Ubuntu", extension: "wsl", managed: false })).toBe(
      "server",
    )
    expect(directoryPickerKind("web", local)).toBe("server")
  })
})
