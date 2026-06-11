import { describe, expect, test } from "bun:test"
import { directoryPickerKind } from "./directory-picker-policy"

const sidecar = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://localhost:4096" },
} as const

const wsl = {
  type: "sidecar",
  variant: "wsl",
  distro: "Ubuntu",
  http: { url: "http://localhost:4097" },
} as const

const httpLocalhost = {
  type: "http",
  http: { url: "http://localhost:4096" },
} as const

const httpRemote = {
  type: "http",
  http: { url: "http://192.168.1.100:4096" },
} as const

const ssh = {
  type: "ssh",
  host: "example.test",
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for the built-in sidecar", () => {
    // Only the embedded sidecar process is guaranteed to share the OS with the Desktop app
    expect(directoryPickerKind("desktop", sidecar)).toBe("native")

    // All HTTP connections use the server-side picker — a localhost URL could be a
    // port-forwarded remote server (e.g. Linux behind SSH tunnel from Windows)
    expect(directoryPickerKind("desktop", httpLocalhost)).toBe("server")
    expect(directoryPickerKind("desktop", httpRemote)).toBe("server")

    // WSL and SSH are always remote filesystems
    expect(directoryPickerKind("desktop", wsl)).toBe("server")
    expect(directoryPickerKind("desktop", ssh)).toBe("server")

    // Web platform never has access to the native picker
    expect(directoryPickerKind("web", sidecar)).toBe("server")
  })
})
