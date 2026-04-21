import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { Instance } from "../src/project/instance"

const dirs: string[] = []

afterEach(async () => {
  await Instance.dispose().catch(() => {})
  await Promise.all(dirs.splice(0).map((dir) => Bun.$`rm -rf ${dir}`.quiet().nothrow()))
})

describe("config.find_up", () => {
  test("stops at the current git root by default", async () => {
    const root = await fixture()
    await write(path.join(root.outer, "opencode.json"), {
      theme: "outer-only-theme",
    })

    const result = await within(root.innerWork, async () => {
      const { Config } = await import("../src/config/config")
      return Config.get()
    })

    expect(result.theme).not.toBe("outer-only-theme")
  })

  test("loads the next enclosing git root when configured as git_submodule", async () => {
    const root = await fixture()
    await write(path.join(root.outer, "opencode.json"), {
      theme: "outer-theme",
      instructions: ["shared/*.md"],
    })
    await write(path.join(root.inner, "opencode.json"), {
      config: { find_up: "git_submodule" },
      model: "openai/gpt-5",
    })
    await Bun.write(path.join(root.outer, "AGENTS.md"), "OUTER_AGENT_RULE")
    await Bun.write(path.join(root.outer, "shared", "outer.md"), "OUTER_INSTRUCTION")
    await Bun.write(
      path.join(root.outer, ".opencode", "agent", "shared.md"),
      ["---", 'description: "outer agent"', 'mode: "subagent"', "---", "OUTER_AGENT_PROMPT"].join("\n"),
    )
    await Bun.write(
      path.join(root.outer, ".opencode", "plugin", "outer-plugin.ts"),
      [
        "export async function OuterPlugin() {",
        "  return {",
        '    async ["tool.register"](_input, { registerHTTP }) {',
        "      registerHTTP({",
        '        id: "outer-plugin-tool",',
        '        description: "outer plugin tool",',
        '        parameters: { type: "object", properties: {} },',
        '        callbackUrl: "http://localhost:9999/outer"',
        "      })",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    )

    const result = await within(root.innerWork, async () => {
      const [{ Config }, { SystemPrompt }] = await Promise.all([
        import("../src/config/config"),
        import("../src/session/system"),
      ])
      const config = await Config.get()
      const stop = await Config.searchStop()
      const custom = await SystemPrompt.custom()
      return {
        config,
        stop,
        custom,
      }
    })

    expect(result.config.theme).toBe("outer-theme")
    expect(result.stop).toBe(root.outer)
    expect(result.custom.join("\n")).toContain("OUTER_AGENT_RULE")
    expect(result.custom.join("\n")).toContain("OUTER_INSTRUCTION")
    expect(result.config.agent?.["shared"]?.prompt).toBe("OUTER_AGENT_PROMPT")
    expect(result.config.plugin).toContain(`file://${path.join(root.outer, ".opencode", "plugin", "outer-plugin.ts")}`)
  })

  test("only loads one enclosing git root", async () => {
    const root = await fixture()
    const top = root.base
    await gitInit(top)
    await write(path.join(top, "opencode.json"), {
      theme: "top-theme",
    })
    await write(path.join(root.outer, "opencode.json"), {
      theme: "outer-theme",
    })
    await write(path.join(root.inner, "opencode.json"), {
      config: { find_up: "git_submodule" },
    })

    const result = await within(root.innerWork, async () => {
      const { Config } = await import("../src/config/config")
      return Config.get()
    })

    expect(result.theme).toBe("outer-theme")
    expect(result.theme).not.toBe("top-theme")
  })

  test("cannot be enabled only by the enclosing git root", async () => {
    const root = await fixture()
    await write(path.join(root.outer, "opencode.json"), {
      config: { find_up: "git_submodule" },
      theme: "outer-theme",
    })

    const result = await within(root.innerWork, async () => {
      const { Config } = await import("../src/config/config")
      return Config.get()
    })

    expect(result.theme).not.toBe("outer-theme")
    expect(result.config?.find_up).toBeUndefined()
  })
})

async function fixture() {
  const base = path.join(os.tmpdir(), `opencode-find-up-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const outer = path.join(base, "outer")
  const inner = path.join(outer, "vendor", "inner")
  const innerWork = path.join(inner, "workspace", "src")
  dirs.push(base)
  await Bun.$`mkdir -p ${path.join(outer, ".opencode", "agent")}`
  await Bun.$`mkdir -p ${path.join(outer, ".opencode", "plugin")}`
  await Bun.$`mkdir -p ${path.join(outer, "shared")}`
  await Bun.$`mkdir -p ${innerWork}`
  await gitInit(outer)
  await gitInit(inner)
  return {
    base,
    outer,
    inner,
    innerWork,
  }
}

async function within<T>(directory: string, fn: () => Promise<T>) {
  return Instance.provide(directory, fn)
}

async function write(file: string, value: unknown) {
  await Bun.write(file, JSON.stringify(value, null, 2))
}

async function gitInit(dir: string) {
  await Bun.$`mkdir -p ${dir}`
  await Bun.$`git init`.cwd(dir).quiet()
  await Bun.write(path.join(dir, ".gitkeep"), "")
  await Bun.$`git add .gitkeep`.cwd(dir).quiet()
  await Bun.$`git -c user.email=test@example.com -c user.name=opencode-test commit -m init`.cwd(dir).quiet()
}
