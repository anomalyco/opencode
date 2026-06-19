import { describe, expect, test } from "bun:test"
import { directoryPickerKind } from "./directory-picker-policy"

const local = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://localhost:4096" },
} as const
const wsl = {
  type: "sidecar",
  variant: "wsl",
  distro: "Debian",
  http: { url: "http://localhost:4097" },
} as const
const remote = {
  type: "ssh",
  host: "example.test",
  http: { url: "http://localhost:4096" },
} as const
const httpLocalhost = {
  type: "http",
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for base sidecar on desktop", () => {
    expect(directoryPickerKind("desktop", local)).toBe("native")
    expect(directoryPickerKind("desktop", wsl)).toBe("server")
    expect(directoryPickerKind("desktop", remote)).toBe("server")
    expect(directoryPickerKind("desktop", httpLocalhost)).toBe("server")
    expect(directoryPickerKind("web", local)).toBe("server")
  })
})
