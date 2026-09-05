import { describe, expect, test } from "bun:test"
import type { SshServersState } from "@opencode-ai/app/ssh/types"
import { availableStartupServer } from "../connections"
import { readySshConnections } from "./connections"

const state = (kind: "starting" | "ready" | "failed" | "stopped"): SshServersState => ({
  configHosts: [],
  hostProbes: {},
  job: null,
  servers: [
    {
      config: { id: "ssh:dev@example.com", host: "dev@example.com" },
      runtime: runtime(kind),
    },
  ],
})

function runtime(kind: "starting" | "ready" | "failed" | "stopped") {
  if (kind === "ready") return { kind, url: "http://127.0.0.1:50123", username: "opencode", password: "secret" }
  if (kind === "failed") return { kind, message: "boom" }
  return { kind }
}

describe("SSH desktop connections", () => {
  test("publishes an SSH server only after the tunnel reports ready", () => {
    expect(readySshConnections(state("starting"))).toEqual([])
    expect(readySshConnections(state("failed"))).toEqual([])
    expect(readySshConnections(state("stopped"))).toEqual([])
    expect(readySshConnections(state("ready"))).toEqual([
      expect.objectContaining({
        displayName: "dev@example.com",
        label: "SSH",
        type: "ssh",
        host: "dev@example.com",
        http: { url: "http://127.0.0.1:50123", username: "opencode", password: "secret" },
      }),
    ])
  })

  test("uses the renderer translation for the SSH connection label", () => {
    expect(readySshConnections(state("ready"), "Translated SSH")[0]?.label).toBe("Translated SSH")
  })

  test("does not block desktop startup on a configured SSH default", () => {
    const key = "ssh:dev@example.com"
    expect(availableStartupServer(key, undefined, undefined)).toBe("sidecar")
    expect(availableStartupServer(key, undefined, state("starting"))).toBe("sidecar")
    expect(availableStartupServer(key, undefined, state("ready"))).toBe(key)
    expect(availableStartupServer(null, undefined, undefined)).toBe("sidecar")
    expect(availableStartupServer("http://192.168.0.10:4096", undefined, undefined)).toBe("http://192.168.0.10:4096")
  })
})
