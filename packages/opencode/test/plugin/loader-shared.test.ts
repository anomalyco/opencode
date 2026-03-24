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

  test("resolves npm plugin specs with explicit and default versions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        await Bun.write(file, ["export default async () => {", "  return {}", "}", ""].join("\n"))

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ plugin: ["acme-plugin", "scope-plugin@2.3.4"] }, null, 2),
        )

        return { file }
      },
    })

    const install = spyOn(BunProc, "install").mockImplementation(async () => pathToFileURL(tmp.extra.file).href)

    try {
      await load(tmp.path)

      expect(install.mock.calls).toContainEqual(["acme-plugin", "latest"])
      expect(install.mock.calls).toContainEqual(["scope-plugin", "2.3.4"])
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
          ["export default async () => {", '  throw new Error("explode")', "}", ""].join("\n"),
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
          ["export default async () => {", "  return {}", "}", 'export const meta = { name: "invalid" }', ""].join(
            "\n",
          ),
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

  test("skips external plugins in pure mode", async () => {
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
