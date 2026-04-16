import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config"
import { Instance } from "../../src/project/instance"
import { SandboxPreset } from "../../src/sandbox/preset"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("sandbox.preset", () => {
  test("resolves built-in presets", () => {
    expect(SandboxPreset.resolve("default")).toEqual({
      mode: "workspace-write",
      network: false,
      protected_roots: [".git", ".opencode"],
      permission: {},
      extra_read_roots: [],
      extra_write_roots: [],
    })

    expect(SandboxPreset.resolve("strict")).toEqual({
      mode: "read-only",
      network: false,
      protected_roots: [".git", ".opencode"],
      permission: {
        bash: "ask",
        edit: "ask",
      },
      extra_read_roots: [],
      extra_write_roots: [],
    })
  })

  test("resolves custom presets from config", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            preset: "ci",
            presets: {
              ci: {
                mode: "workspace-write",
                network: true,
                protected_roots: [".git", ".opencode", ".env"],
                extra_read_roots: ["/tmp/ci-read"],
                extra_write_roots: ["/tmp/ci-write"],
                permission: {
                  bash: "allow",
                },
              },
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()
        expect(
          SandboxPreset.resolve("ci", {
            presets: cfg.experimental?.sandbox?.presets,
          }),
        ).toEqual({
          mode: "workspace-write",
          network: true,
          protected_roots: [".git", ".opencode", ".env"],
          permission: {
            bash: "allow",
          },
          extra_read_roots: ["/tmp/ci-read"],
          extra_write_roots: ["/tmp/ci-write"],
        })
      },
    })
  })

  test("lets explicit overrides win over preset defaults", () => {
    expect(
      SandboxPreset.resolve("default", {
        overrides: {
          mode: "read-only",
          network: true,
          protected_roots: [".git", ".opencode", ".env"],
        },
      }),
    ).toEqual({
      mode: "read-only",
      network: true,
      protected_roots: [".git", ".opencode", ".env"],
      permission: {},
      extra_read_roots: [],
      extra_write_roots: [],
    })
  })

  test("rejects custom presets that shadow built-ins", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            presets: {
              default: {
                mode: "read-only",
              },
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Config.get()).rejects.toThrow()
      },
    })
  })
})
