import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")
const { BunProc } = await import("../../src/bun")
const { Bus } = await import("../../src/bus")
const { Session } = await import("../../src/session")

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

afterEach(async () => {
  await Instance.disposeAll()
})

async function load(dir: string) {
  return Instance.provide({
    directory: dir,
    fn: async () => {
      await Plugin.list()
    },
  })
}

async function errs(dir: string) {
  return Instance.provide({
    directory: dir,
    fn: async () => {
      const errors: string[] = []
      const off = Bus.subscribe(Session.Event.Error, (evt) => {
        const error = evt.properties.error
        if (!error || typeof error !== "object") return
        if (!("data" in error)) return
        if (!error.data || typeof error.data !== "object") return
        if (!("message" in error.data)) return
        if (typeof error.data.message !== "string") return
        errors.push(error.data.message)
      })
      await Plugin.list()
      off()
      return errors
    },
  })
}

describe("plugin.loader.shared", () => {
  test("loads a file:// plugin function export", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default async () => {",
            `  await Bun.write(${JSON.stringify(mark)}, \"called\")`,
            "  return {}",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    await load(tmp.path)
    expect(await fs.readFile(tmp.extra.mark, "utf8")).toBe("called")
  })

  test("deduplicates same function exported as default and named", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "count.txt")
        await Bun.write(mark, "")
        await Bun.write(
          file,
          [
            "const run = async () => {",
            `  const text = await Bun.file(${JSON.stringify(mark)}).text().catch(() => \"\")`,
            `  await Bun.write(${JSON.stringify(mark)}, text + \"1\")`,
            "  return {}",
            "}",
            "export default run",
            "export const named = run",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    await load(tmp.path)
    expect(await fs.readFile(tmp.extra.mark, "utf8")).toBe("1")
  })

  test("uses only default v1 server plugin when present", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "count.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.v1-default",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "default")`,
            "    return {}",
            "  },",
            "}",
            "export const named = async () => {",
            `  await Bun.write(${JSON.stringify(mark)}, "named")`,
            "  return {}",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    await load(tmp.path)
    expect(await Bun.file(tmp.extra.mark).text()).toBe("default")
  })

  test("rejects v1 file server plugin without id", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    const errors = await errs(tmp.path)
    const called = await Bun.file(tmp.extra.mark)
      .text()
      .then(() => true)
      .catch(() => false)

    expect(called).toBe(false)
    expect(errors.some((x) => x.includes("must export id"))).toBe(true)
  })

  test("rejects v1 plugin that exports server and tui together", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.mixed",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "server")`,
            "    return {}",
            "  },",
            "  tui: async () => {},",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    const errors = await errs(tmp.path)
    const called = await Bun.file(tmp.extra.mark)
      .text()
      .then(() => true)
      .catch(() => false)

    expect(called).toBe(false)
    expect(errors.some((x) => x.includes("either server() or tui(), not both"))).toBe(true)
  })

  test("resolves npm plugin specs with explicit and default versions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const acme = path.join(dir, "node_modules", "acme-plugin")
        const scope = path.join(dir, "node_modules", "scope-plugin")
        await fs.mkdir(acme, { recursive: true })
        await fs.mkdir(scope, { recursive: true })
        await Bun.write(
          path.join(acme, "package.json"),
          JSON.stringify({ name: "acme-plugin", type: "module", main: "./index.js" }, null, 2),
        )
        await Bun.write(path.join(acme, "index.js"), "export default { server: async () => ({}) }\n")
        await Bun.write(
          path.join(scope, "package.json"),
          JSON.stringify({ name: "scope-plugin", type: "module", main: "./index.js" }, null, 2),
        )
        await Bun.write(path.join(scope, "index.js"), "export default { server: async () => ({}) }\n")

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: ["acme-plugin", "scope-plugin@2.3.4"] }, null, 2),
        )

        return { acme, scope }
      },
    })

    const install = spyOn(BunProc, "install").mockImplementation(async (pkg) => {
      if (pkg === "acme-plugin") return tmp.extra.acme
      return tmp.extra.scope
    })

    try {
      await load(tmp.path)

      expect(install.mock.calls).toContainEqual(["acme-plugin", "latest"])
      expect(install.mock.calls).toContainEqual(["scope-plugin", "2.3.4"])
    } finally {
      install.mockRestore()
    }
  })

  test("loads npm server plugin from package ./server export", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        const mark = path.join(dir, "server-called.txt")
        await fs.mkdir(mod, { recursive: true })

        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              type: "module",
              exports: {
                ".": "./index.js",
                "./server": "./server.js",
                "./tui": "./tui.js",
              },
            },
            null,
            2,
          ),
        )
        await Bun.write(path.join(mod, "index.js"), 'import "./main-throws.js"\nexport default {}\n')
        await Bun.write(path.join(mod, "main-throws.js"), 'throw new Error("main loaded")\n')
        await Bun.write(
          path.join(mod, "server.js"),
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
        await Bun.write(path.join(mod, "tui.js"), "export default {}\n")

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["acme-plugin@1.0.0"] }, null, 2))

        return {
          mod,
          mark,
        }
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

    try {
      await load(tmp.path)
      expect(await Bun.file(tmp.extra.mark).text()).toBe("called")
    } finally {
      install.mockRestore()
    }
  })

  test("loads npm server plugin from package server export without leading dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        const dist = path.join(mod, "dist")
        const mark = path.join(dir, "server-called.txt")
        await fs.mkdir(dist, { recursive: true })

        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              type: "module",
              exports: {
                ".": "./index.js",
                "./server": "dist/server.js",
              },
            },
            null,
            2,
          ),
        )
        await Bun.write(path.join(mod, "index.js"), 'import "./main-throws.js"\nexport default {}\n')
        await Bun.write(path.join(mod, "main-throws.js"), 'throw new Error("main loaded")\n')
        await Bun.write(
          path.join(dist, "server.js"),
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["acme-plugin@1.0.0"] }, null, 2))

        return {
          mod,
          mark,
        }
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

    try {
      const errors = await errs(tmp.path)
      expect(errors).toHaveLength(0)
      expect(await Bun.file(tmp.extra.mark).text()).toBe("called")
    } finally {
      install.mockRestore()
    }
  })

  test("loads npm server plugin from package main without leading dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        const dist = path.join(mod, "dist")
        const mark = path.join(dir, "main-called.txt")
        await fs.mkdir(dist, { recursive: true })

        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              type: "module",
              main: "dist/index.js",
            },
            null,
            2,
          ),
        )
        await Bun.write(
          path.join(dist, "index.js"),
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["acme-plugin@1.0.0"] }, null, 2))

        return {
          mod,
          mark,
        }
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

    try {
      const errors = await errs(tmp.path)
      expect(errors).toHaveLength(0)
      expect(await Bun.file(tmp.extra.mark).text()).toBe("called")
    } finally {
      install.mockRestore()
    }
  })

  test("does not use npm package exports dot for server entry", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        const mark = path.join(dir, "dot-server.txt")
        await fs.mkdir(mod, { recursive: true })

        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify({
            name: "acme-plugin",
            type: "module",
            exports: { ".": "./index.js" },
          }),
        )
        await Bun.write(
          path.join(mod, "index.js"),
          [
            "export default {",
            '  id: "demo.dot.server",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["acme-plugin@1.0.0"] }, null, 2))

        return { mod, mark }
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

    try {
      const errors = await errs(tmp.path)
      const called = await Bun.file(tmp.extra.mark)
        .text()
        .then(() => true)
        .catch(() => false)

      expect(called).toBe(false)
      expect(errors.some((x) => x.includes('exports["./server"]') && x.includes("package.json main"))).toBe(true)
    } finally {
      install.mockRestore()
    }
  })

  test("rejects npm server export that resolves outside plugin directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        const outside = path.join(dir, "outside")
        const mark = path.join(dir, "outside-server.txt")
        await fs.mkdir(mod, { recursive: true })
        await fs.mkdir(outside, { recursive: true })

        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              type: "module",
              exports: {
                ".": "./index.js",
                "./server": "./escape/server.js",
              },
            },
            null,
            2,
          ),
        )
        await Bun.write(path.join(mod, "index.js"), "export default {}\n")
        await Bun.write(
          path.join(outside, "server.js"),
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "outside")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
        await fs.symlink(outside, path.join(mod, "escape"), process.platform === "win32" ? "junction" : "dir")

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["acme-plugin"] }, null, 2))

        return {
          mod,
          mark,
        }
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

    try {
      const errors = await errs(tmp.path)
      const called = await Bun.file(tmp.extra.mark)
        .text()
        .then(() => true)
        .catch(() => false)
      expect(called).toBe(false)
      expect(errors.some((x) => x.includes("outside plugin directory"))).toBe(true)
    } finally {
      install.mockRestore()
    }
  })

  test("skips legacy codex and copilot auth plugin specs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify(
            {
              plugin: ["opencode-openai-codex-auth@1.0.0", "opencode-copilot-auth@1.0.0", "regular-plugin@1.0.0"],
            },
            null,
            2,
          ),
        )
      },
    })

    const install = spyOn(BunProc, "install").mockResolvedValue("")

    try {
      await load(tmp.path)

      const pkgs = install.mock.calls.map((call) => call[0])
      expect(pkgs).toContain("regular-plugin")
      expect(pkgs).not.toContain("opencode-openai-codex-auth")
      expect(pkgs).not.toContain("opencode-copilot-auth")
    } finally {
      install.mockRestore()
    }
  })

  test("publishes session.error when install fails", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["broken-plugin@9.9.9"] }, null, 2))
      },
    })

    const install = spyOn(BunProc, "install").mockRejectedValue(new Error("boom"))

    try {
      const errors = await errs(tmp.path)

      expect(errors.some((x) => x.includes("Failed to install plugin broken-plugin@9.9.9") && x.includes("boom"))).toBe(
        true,
      )
    } finally {
      install.mockRestore()
    }
  })

  test("publishes session.error when plugin init throws", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = pathToFileURL(path.join(dir, "throws.ts")).href
        await Bun.write(
          path.join(dir, "throws.ts"),
          [
            "export default {",
            '  id: "demo.throws",',
            "  server: async () => {",
            '    throw new Error("explode")',
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [file] }, null, 2))

        return { file }
      },
    })

    const errors = await errs(tmp.path)

    expect(errors.some((x) => x.includes(`Failed to load plugin ${tmp.extra.file}: explode`))).toBe(true)
  })

  test("publishes session.error when plugin module has invalid export", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = pathToFileURL(path.join(dir, "invalid.ts")).href
        await Bun.write(
          path.join(dir, "invalid.ts"),
          ["export default {", '  id: "demo.invalid",', "  nope: true,", "}", ""].join("\n"),
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [file] }, null, 2))

        return { file }
      },
    })

    const errors = await errs(tmp.path)

    expect(errors.some((x) => x.includes(`Failed to load plugin ${tmp.extra.file}`))).toBe(true)
  })

  test("publishes session.error when plugin import fails", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const missing = pathToFileURL(path.join(dir, "missing-plugin.ts")).href
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [missing] }, null, 2))

        return { missing }
      },
    })

    const errors = await errs(tmp.path)

    expect(errors.some((x) => x.includes(`Failed to load plugin ${tmp.extra.missing}`))).toBe(true)
  })

  test("loads object plugin via plugin.server", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "object-plugin.ts")
        const mark = path.join(dir, "object-called.txt")
        await Bun.write(
          file,
          [
            "const plugin = {",
            '  id: "demo.object",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, \"called\")`,
            "    return {}",
            "  },",
            "}",
            "export default plugin",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    await load(tmp.path)
    expect(await fs.readFile(tmp.extra.mark, "utf8")).toBe("called")
  })

  test("passes tuple plugin options into server plugin", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "options-plugin.ts")
        const mark = path.join(dir, "options.json")
        await Bun.write(
          file,
          [
            "const plugin = {",
            '  id: "demo.options",',
            "  server: async (_input, options) => {",
            `    await Bun.write(${JSON.stringify(mark)}, JSON.stringify(options ?? null))`,
            "    return {}",
            "  },",
            "}",
            "export default plugin",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [[pathToFileURL(file).href, { source: "tuple", enabled: true }]] }, null, 2),
        )

        return { mark }
      },
    })

    await load(tmp.path)
    expect(await Filesystem.readJson<{ source: string; enabled: boolean }>(tmp.extra.mark)).toEqual({
      source: "tuple",
      enabled: true,
    })
  })

  test("initializes server plugins in config order", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const a = path.join(dir, "a-plugin.ts")
        const b = path.join(dir, "b-plugin.ts")
        const marker = path.join(dir, "server-order.txt")
        const aSpec = pathToFileURL(a).href
        const bSpec = pathToFileURL(b).href

        await Bun.write(
          a,
          `import fs from "fs/promises"

export default {
  id: "demo.order.a",
  server: async () => {
    await fs.appendFile(${JSON.stringify(marker)}, "a-start\\n")
    await Bun.sleep(25)
    await fs.appendFile(${JSON.stringify(marker)}, "a-end\\n")
    return {}
  },
}
`,
        )
        await Bun.write(
          b,
          `import fs from "fs/promises"

export default {
  id: "demo.order.b",
  server: async () => {
    await fs.appendFile(${JSON.stringify(marker)}, "b\\n")
    return {}
  },
}
`,
        )

        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [aSpec, bSpec] }, null, 2))

        return { marker }
      },
    })

    await load(tmp.path)
    const lines = (await fs.readFile(tmp.extra.marker, "utf8")).trim().split("\n")
    expect(lines).toEqual(["a-start", "a-end", "b"])
  })

  test("skips external plugins in pure mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.pure",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, \"called\")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
    })

    const pure = process.env.OPENCODE_PURE
    process.env.OPENCODE_PURE = "1"

    try {
      await load(tmp.path)
      const called = await fs
        .readFile(tmp.extra.mark, "utf8")
        .then(() => true)
        .catch(() => false)
      expect(called).toBe(false)
    } finally {
      if (pure === undefined) {
        delete process.env.OPENCODE_PURE
      } else {
        process.env.OPENCODE_PURE = pure
      }
    }
  })
})
