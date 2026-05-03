import { afterEach, describe, expect, test } from "bun:test"
import { resolveNetworkOptionsNoConfig, type NetworkOptions } from "../../src/cli/network"

const argv = [...process.argv]

afterEach(() => {
  process.argv = [...argv]
})

const defaults = (): NetworkOptions => ({
  port: 0,
  hostname: "127.0.0.1",
  "base-path": "",
  mdns: false,
  "mdns-domain": "opencode.local",
  cors: [],
})

describe("resolveNetworkOptionsNoConfig", () => {
  test("uses and normalizes basePath from config when flag is not set", () => {
    process.argv = ["node", "opencode"]

    const result = resolveNetworkOptionsNoConfig(defaults(), {
      server: {
        basePath: "/opencode/",
      },
    })

    expect(result.basePath).toBe("/opencode")
  })

  test("prefers explicit basePath flag over config", () => {
    process.argv = ["node", "opencode", "--base-path"]

    const result = resolveNetworkOptionsNoConfig(
      {
        ...defaults(),
        "base-path": "nested/ui",
      },
      {
        server: {
          basePath: "/opencode",
        },
      },
    )

    expect(result.basePath).toBe("/nested/ui")
  })
})
