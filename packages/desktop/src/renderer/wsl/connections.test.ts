import { describe, expect, test } from "bun:test"
import type { WslServersState } from "@opencode-ai/app/wsl/types"
import { availableStartupServer, readyWslConnections } from "./connections"

const state = (kind: "starting" | "ready" | "failed" | "stopped"): WslServersState => ({
  runtime: null,
  installed: [],
  online: [],
  distroProbes: {},
  opencodeChecks: {},
  pendingRestart: false,
  job: null,
  servers: [
    {
      config: { id: "wsl:Debian", distro: "Debian" },
      runtime: runtime(kind),
    },
  ],
})

function runtime(kind: "starting" | "ready" | "failed" | "stopped") {
  if (kind === "ready") return { kind, url: "http://127.0.0.1:4096", username: "opencode", password: "secret" }
  if (kind === "failed") return { kind, message: "boom" }
  return { kind }
}

describe("WSL desktop connections", () => {
  test("publishes a WSL server only after it reports ready", () => {
    expect(readyWslConnections(state("starting"))).toEqual([])
    expect(readyWslConnections(state("failed"))).toEqual([])
    expect(readyWslConnections(state("stopped"))).toEqual([])
    expect(readyWslConnections(state("ready"))).toEqual([
      expect.objectContaining({ displayName: "Debian", label: "WSL" }),
    ])
  })

  test("does not block desktop startup on a configured WSL default", () => {
    const key = "wsl:Debian"
    expect(availableStartupServer(key, undefined, { localAvailable: true })).toBe("sidecar")
    expect(availableStartupServer(key, state("starting"), { localAvailable: true })).toBe("sidecar")
    expect(availableStartupServer(key, state("ready"), { localAvailable: true })).toBe(key)
  })

  test("keeps a startup key available in client-mode startup", () => {
    expect(availableStartupServer(null, undefined, { localAvailable: false })).toBe("sidecar")
    expect(availableStartupServer("https://server.example.test", undefined, { localAvailable: false })).toBe(
      "https://server.example.test",
    )
    expect(availableStartupServer("wsl:Debian", state("starting"), { localAvailable: false })).toBe("sidecar")
    expect(availableStartupServer("wsl:Debian", state("ready"), { localAvailable: false })).toBe("wsl:Debian")
  })
})
