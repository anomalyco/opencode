import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { BashTool } from "../../src/tool/bash"

describe("plugin.agent-hooks", () => {
  // Direct Plugin.trigger tests — verify hooks receive the agent field
  // These test the contract: Plugin.trigger passes input.agent to hook functions

  test("shell.env hook receives agent value", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "shell.env": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-shell-env.json"),',
            "      JSON.stringify({ agent: hookInput.agent, cwd: hookInput.cwd }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger("shell.env", { cwd: tmp.path, agent: "taste" }, { env: {} })

        const raw = await fs.readFile(path.join(tmp.path, ".capture-shell-env.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("taste")
        expect(captured.cwd).toBe(tmp.path)
      },
    })
  })

  test("tool.execute.before hook receives agent value", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "tool.execute.before": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-before.json"),',
            "      JSON.stringify({ agent: hookInput.agent, tool: hookInput.tool }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.before",
          { tool: "bash", sessionID: "s", callID: "c", agent: "cook" },
          { args: {} },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".capture-before.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("cook")
        expect(captured.tool).toBe("bash")
      },
    })
  })

  test("tool.execute.after hook receives agent value", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "tool.execute.after": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-after.json"),',
            "      JSON.stringify({ agent: hookInput.agent, tool: hookInput.tool }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.after",
          { tool: "edit", sessionID: "s", callID: "c", args: {}, agent: "eat" },
          { title: "", output: "", metadata: {} },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".capture-after.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("eat")
        expect(captured.tool).toBe("edit")
      },
    })
  })

  test("shell.env hook receives undefined agent for PTY case", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "shell.env": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-pty.json"),',
            "      JSON.stringify({ agent: hookInput.agent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger("shell.env", { cwd: tmp.path, agent: undefined }, { env: {} })

        const raw = await fs.readFile(path.join(tmp.path, ".capture-pty.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBeNull()
      },
    })
  })

  // parentAgent tests — verify delegation chain is exposed to hooks
  test("tool.execute.before hook receives parentAgent for subagent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "tool.execute.before": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-parent-before.json"),',
            "      JSON.stringify({ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.before",
          { tool: "bash", sessionID: "s", callID: "c", agent: "explore", parentAgent: "build" },
          { args: {} },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".capture-parent-before.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("explore")
        expect(captured.parentAgent).toBe("build")
      },
    })
  })

  test("tool.execute.after hook receives parentAgent for subagent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "tool.execute.after": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-parent-after.json"),',
            "      JSON.stringify({ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.after",
          { tool: "edit", sessionID: "s", callID: "c", args: {}, agent: "explore", parentAgent: "build" },
          { title: "", output: "", metadata: {} },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".capture-parent-after.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("explore")
        expect(captured.parentAgent).toBe("build")
      },
    })
  })

  test("shell.env hook receives parentAgent for subagent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "shell.env": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-parent-shell.json"),',
            "      JSON.stringify({ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger("shell.env", { cwd: tmp.path, agent: "explore", parentAgent: "build" }, { env: {} })

        const raw = await fs.readFile(path.join(tmp.path, ".capture-parent-shell.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("explore")
        expect(captured.parentAgent).toBe("build")
      },
    })
  })

  test("top-level agent has undefined parentAgent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "tool.execute.before": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".capture-no-parent.json"),',
            "      JSON.stringify({ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.trigger(
          "tool.execute.before",
          { tool: "bash", sessionID: "s", callID: "c", agent: "build" },
          { args: {} },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".capture-no-parent.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("build")
        expect(captured.parentAgent).toBeNull()
      },
    })
  })

  // Integration: bash tool end-to-end with real plugin
  test("bash tool end-to-end: plugin receives ctx.agent via shell.env", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "shell.env": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".bash-agent.json"),',
            "      JSON.stringify({ agent: hookInput.agent }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await bash.execute(
          { command: "echo hello", description: "test" },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "taste",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".bash-agent.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("taste")
      },
    })
  })

  test("bash tool end-to-end: plugin receives ctx.parentAgent via shell.env", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const pluginsDir = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(pluginsDir, { recursive: true })

        await Bun.write(
          path.join(pluginsDir, "capture.ts"),
          [
            "const plugin = async (input) => ({",
            '  "shell.env": async (hookInput, output) => {',
            '    const fs = await import("fs/promises")',
            '    const path = await import("path")',
            "    await fs.writeFile(",
            '      path.join(input.directory, ".bash-parent.json"),',
            "      JSON.stringify({ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }),",
            "    )",
            "  },",
            "})",
            "export default plugin",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await bash.execute(
          { command: "echo hello", description: "test" },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "explore",
            parentAgent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        const raw = await fs.readFile(path.join(tmp.path, ".bash-parent.json"), "utf-8")
        const captured = JSON.parse(raw)
        expect(captured.agent).toBe("explore")
        expect(captured.parentAgent).toBe("build")
      },
    })
  })
})
