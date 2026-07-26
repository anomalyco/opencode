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
    expect(availableStartupServer(key, undefined)).toBe("sidecar")
    expect(availableStartupServer(key, state("starting"))).toBe("sidecar")
    expect(availableStartupServer(key, state("ready"))).toBe(key)
  })
})
