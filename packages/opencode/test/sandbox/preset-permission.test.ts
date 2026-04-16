import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

function getAgent(name: string) {
  return AppRuntime.runPromise(Agent.Service.use((svc) => svc.get(name)))
}

describe("sandbox preset permission overlay", () => {
  test("applies the preset overlay when no explicit override exists", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            preset: "strict",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await getAgent("build")
        expect(Permission.evaluate("bash", "echo hello", build!.permission).action).toBe("ask")
      },
    })
  })

  test("agent-specific config still overrides the preset overlay", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            preset: "strict",
          },
        },
        agent: {
          build: {
            permission: {
              bash: "allow",
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await getAgent("build")
        expect(Permission.evaluate("bash", "echo hello", build!.permission).action).toBe("allow")
      },
    })
  })

  test("top-level user config overrides the preset overlay when no agent override exists", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            preset: "strict",
          },
        },
        permission: {
          bash: "deny",
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await getAgent("build")
        expect(Permission.evaluate("bash", "echo hello", build!.permission).action).toBe("deny")
      },
    })
  })

  test("general inherits the preset overlay", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            preset: "strict",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const general = await getAgent("general")
        expect(Permission.evaluate("bash", "ls", general!.permission).action).toBe("ask")
      },
    })
  })

  test("no preset keeps existing behavior", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await getAgent("build")
        expect(Permission.evaluate("bash", "echo hello", build!.permission).action).toBe("allow")
      },
    })
  })
})
