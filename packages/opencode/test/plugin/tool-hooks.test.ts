import { describe, test, expect, mock, beforeEach } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

// Mock BunProc and default plugins to prevent actual installations during tests
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"

// Shared hook call tracker - reset before each test
const hookCalls: Array<{ id: string; hook: string; input: any; output: any }> = []

beforeEach(() => {
  hookCalls.length = 0
  ;(globalThis as any).__hookCalls = hookCalls
})

// Helper to create plugin file content
function createPluginContent(options: {
  id?: string
  beforeHook?: {
    track?: boolean
    modify?: Record<string, any>
    throw?: string
  }
  afterHook?: {
    track?: boolean
    modifyTitle?: string
    modifyOutput?: string
    modifyMetadata?: Record<string, any>
  }
}) {
  const id = options.id || "default"
  return `
export default async function(ctx) {
  return {
    ${
      options.beforeHook
        ? `
    "tool.execute.before": async (input, output) => {
      ${options.beforeHook.track ? `globalThis.__hookCalls.push({ id: "${id}", hook: "before", input: {...input}, output: { args: {...output.args} } })` : ""}
      ${options.beforeHook.modify ? `Object.assign(output.args, ${JSON.stringify(options.beforeHook.modify)})` : ""}
      ${options.beforeHook.throw ? `throw new Error("${options.beforeHook.throw}")` : ""}
    },`
        : ""
    }
    ${
      options.afterHook
        ? `
    "tool.execute.after": async (input, output) => {
      ${options.afterHook.track ? `globalThis.__hookCalls.push({ id: "${id}", hook: "after", input: {...input}, output: { title: output.title, output: output.output, metadata: {...output.metadata} } })` : ""}
      ${options.afterHook.modifyTitle ? `output.title = "${options.afterHook.modifyTitle}"` : ""}
      ${options.afterHook.modifyOutput ? `output.output = "${options.afterHook.modifyOutput}"` : ""}
      ${options.afterHook.modifyMetadata ? `Object.assign(output.metadata, ${JSON.stringify(options.afterHook.modifyMetadata)})` : ""}
    },`
        : ""
    }
  }
}
`
}

// Helper to set up a test environment with plugins
async function setupTestEnv(dir: string, plugins: Array<{ filename: string; content: string }>) {
  for (const plugin of plugins) {
    await Bun.write(path.join(dir, plugin.filename), plugin.content)
  }
  await Bun.write(
    path.join(dir, "opencode.json"),
    JSON.stringify({
      plugin: plugins.map((p) => pathToFileURL(path.join(dir, p.filename)).href),
    }),
  )
}

describe("plugin.tool.execute.before", () => {
  test("hook receives correct input parameters", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          { filename: "plugin.ts", content: createPluginContent({ beforeHook: { track: true } }) },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.before",
          { tool: "test-tool", sessionID: "sess-123", callID: "call-456" },
          { args: { foo: "bar" } },
        )

        expect(hookCalls).toHaveLength(1)
        expect(hookCalls[0].hook).toBe("before")
        expect(hookCalls[0].input).toEqual({
          tool: "test-tool",
          sessionID: "sess-123",
          callID: "call-456",
        })
      },
    })
  })

  test("hook receives args in output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          { filename: "plugin.ts", content: createPluginContent({ beforeHook: { track: true } }) },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.before",
          { tool: "test", sessionID: "s", callID: "c" },
          { args: { command: "ls", timeout: 5000 } },
        )

        expect(hookCalls[0].output.args).toEqual({
          command: "ls",
          timeout: 5000,
        })
      },
    })
  })

  test("hook can modify args", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin.ts",
            content: createPluginContent({
              beforeHook: { track: true, modify: { injected: true, extra: "value" } },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.before",
          { tool: "test", sessionID: "s", callID: "c" },
          { args: { original: true } as Record<string, unknown> },
        )

        expect(result.args).toEqual({
          original: true,
          injected: true,
          extra: "value",
        })
      },
    })
  })

  test("hook can throw to block execution", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin.ts",
            content: createPluginContent({
              beforeHook: { throw: "Blocked by plugin" },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          Plugin.trigger("tool.execute.before", { tool: "test", sessionID: "s", callID: "c" }, { args: {} }),
        ).rejects.toThrow("Blocked by plugin")
      },
    })
  })

  test("multiple hooks called sequentially", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin1.ts",
            content: createPluginContent({
              id: "first",
              beforeHook: { track: true, modify: { fromFirst: true } },
            }),
          },
          {
            filename: "plugin2.ts",
            content: createPluginContent({
              id: "second",
              beforeHook: { track: true, modify: { fromSecond: true } },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.before",
          { tool: "test", sessionID: "s", callID: "c" },
          { args: { original: true } as Record<string, unknown> },
        )

        expect(hookCalls).toHaveLength(2)
        expect(hookCalls[0].id).toBe("first")
        expect(hookCalls[1].id).toBe("second")
        expect(hookCalls[1].output.args.fromFirst).toBe(true)
        expect(result.args).toEqual({
          original: true,
          fromFirst: true,
          fromSecond: true,
        })
      },
    })
  })

  test("no hooks registered returns output unchanged", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const output = { args: { unchanged: true } }
        const result = await Plugin.trigger(
          "tool.execute.before",
          { tool: "test", sessionID: "s", callID: "c" },
          output,
        )

        expect(result).toBe(output)
        expect(result.args).toEqual({ unchanged: true })
      },
    })
  })
})

describe("plugin.tool.execute.after", () => {
  test("hook receives correct input parameters", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          { filename: "plugin.ts", content: createPluginContent({ afterHook: { track: true } }) },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.after",
          { tool: "bash", sessionID: "sess-abc", callID: "call-xyz" },
          { title: "Executed command", output: "result", metadata: {} },
        )

        expect(hookCalls).toHaveLength(1)
        expect(hookCalls[0].hook).toBe("after")
        expect(hookCalls[0].input).toEqual({
          tool: "bash",
          sessionID: "sess-abc",
          callID: "call-xyz",
        })
      },
    })
  })

  test("hook receives result in output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          { filename: "plugin.ts", content: createPluginContent({ afterHook: { track: true } }) },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.after",
          { tool: "read", sessionID: "s", callID: "c" },
          {
            title: "Read file",
            output: "file contents here",
            metadata: { lines: 100, path: "/test.txt" },
          },
        )

        expect(hookCalls[0].output).toEqual({
          title: "Read file",
          output: "file contents here",
          metadata: { lines: 100, path: "/test.txt" },
        })
      },
    })
  })

  test("hook can modify output text", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin.ts",
            content: createPluginContent({
              afterHook: { track: true, modifyOutput: "REDACTED" },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.after",
          { tool: "test", sessionID: "s", callID: "c" },
          { title: "Title", output: "sensitive data", metadata: {} },
        )

        expect(result.output).toBe("REDACTED")
      },
    })
  })

  test("hook can modify title", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin.ts",
            content: createPluginContent({
              afterHook: { track: true, modifyTitle: "Modified Title" },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.after",
          { tool: "test", sessionID: "s", callID: "c" },
          { title: "Original Title", output: "output", metadata: {} },
        )

        expect(result.title).toBe("Modified Title")
      },
    })
  })

  test("hook can modify metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin.ts",
            content: createPluginContent({
              afterHook: { track: true, modifyMetadata: { processed: true, timestamp: 12345 } },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.after",
          { tool: "test", sessionID: "s", callID: "c" },
          { title: "Title", output: "output", metadata: { original: true } as Record<string, unknown> },
        )

        expect(result.metadata).toEqual({
          original: true,
          processed: true,
          timestamp: 12345,
        })
      },
    })
  })

  test("multiple hooks called sequentially", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await setupTestEnv(dir, [
          {
            filename: "plugin1.ts",
            content: createPluginContent({
              id: "first",
              afterHook: { track: true, modifyMetadata: { step1: true } },
            }),
          },
          {
            filename: "plugin2.ts",
            content: createPluginContent({
              id: "second",
              afterHook: { track: true, modifyMetadata: { step2: true } },
            }),
          },
        ])
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Plugin.trigger(
          "tool.execute.after",
          { tool: "test", sessionID: "s", callID: "c" },
          { title: "Title", output: "output", metadata: { initial: true } as Record<string, unknown> },
        )

        expect(hookCalls).toHaveLength(2)
        expect(hookCalls[0].id).toBe("first")
        expect(hookCalls[1].id).toBe("second")
        expect(hookCalls[1].output.metadata.step1).toBe(true)
        expect(result.metadata).toEqual({
          initial: true,
          step1: true,
          step2: true,
        })
      },
    })
  })
})
