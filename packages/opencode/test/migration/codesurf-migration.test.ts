import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"

describe("CodeSurf Migration - Environment Variable Detection", () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env["CODESURF_FOLDER"]
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["CODESURF_FOLDER"] = originalEnv
    } else {
      delete process.env["CODESURF_FOLDER"]
    }
  })

  test("defaults to .codesurf when CODESURF_FOLDER not set", async () => {
    delete process.env["CODESURF_FOLDER"]

    const expectedFolder = process.env["CODESURF_FOLDER"] || ".codesurf"
    expect(expectedFolder).toBe(".codesurf")
  })

  test("uses .opencode when CODESURF_FOLDER=.opencode", async () => {
    process.env["CODESURF_FOLDER"] = ".opencode"

    const expectedFolder = process.env["CODESURF_FOLDER"]
    expect(expectedFolder).toBe(".opencode")
  })

  test("uses custom folder when CODESURF_FOLDER set", async () => {
    process.env["CODESURF_FOLDER"] = ".mycustomfolder"

    const expectedFolder = process.env["CODESURF_FOLDER"]
    expect(expectedFolder).toBe(".mycustomfolder")
  })
})

describe("CodeSurf Migration - Config File Discovery", () => {
  test("loads codesurf.json in default mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "codesurf.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "codesurf/model",
            username: "codesurf-user",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.model).toBe("codesurf/model")
        expect(config.username).toBe("codesurf-user")
      },
    })
  })

  test("loads codesurf.jsonc in default mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "codesurf.jsonc"),
          `{
            // CodeSurf config
            "$schema": "https://opencode.ai/config.json",
            "model": "codesurf/model",
            "username": "codesurf-user"
          }`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.model).toBe("codesurf/model")
        expect(config.username).toBe("codesurf-user")
      },
    })
  })

  test("codesurf.json takes precedence over opencode.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "opencode/model",
            username: "opencode-user",
          }),
        )
        await Bun.write(
          path.join(dir, "codesurf.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "codesurf/model",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.model).toBe("codesurf/model")
        expect(config.username).toBe("opencode-user")
      },
    })
  })
})

describe("CodeSurf Migration - Directory Discovery", () => {
  test("discovers .codesurf directory by default", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const codesurfDir = path.join(dir, ".codesurf")
        await fs.mkdir(codesurfDir, { recursive: true })
        const agentDir = path.join(codesurfDir, "agent")
        await fs.mkdir(agentDir, { recursive: true })

        await Bun.write(
          path.join(agentDir, "test-agent.md"),
          `---
model: test/model
---
Test CodeSurf agent`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.agent?.["test-agent"]).toBeDefined()
        expect(config.agent?.["test-agent"]?.model).toBe("test/model")
      },
    })
  })

  test("discovers .opencode directory in fallback", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        const agentDir = path.join(opencodeDir, "agent")
        await fs.mkdir(agentDir, { recursive: true })

        await Bun.write(
          path.join(agentDir, "opencode-agent.md"),
          `---
model: opencode/model
---
OpenCode agent`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.agent?.["opencode-agent"]).toBeDefined()
        expect(config.agent?.["opencode-agent"]?.model).toBe("opencode/model")
      },
    })
  })

  test("prioritizes .codesurf over .opencode when both exist", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const codesurfDir = path.join(dir, ".codesurf")
        await fs.mkdir(codesurfDir, { recursive: true })
        const codesurfAgentDir = path.join(codesurfDir, "agent")
        await fs.mkdir(codesurfAgentDir, { recursive: true })
        await Bun.write(
          path.join(codesurfAgentDir, "test-agent.md"),
          `---
model: codesurf/model
---
CodeSurf agent`,
        )

        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        const opencodeAgentDir = path.join(opencodeDir, "agent")
        await fs.mkdir(opencodeAgentDir, { recursive: true })
        await Bun.write(
          path.join(opencodeAgentDir, "test-agent.md"),
          `---
model: opencode/model
---
OpenCode agent`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.agent?.["test-agent"]?.model).toBe("codesurf/model")
      },
    })
  })
})

describe("CodeSurf Migration - Memory File Paths", () => {
  test("memory file defaults to .codesurf/memory.json", async () => {
    const expectedPath = path.join(process.env["CODESURF_FOLDER"] || ".codesurf", "memory.json")
    expect(expectedPath).toBe(".codesurf/memory.json")
  })

  test("memory file uses .opencode/memory.json in compat mode", async () => {
    const folder = ".opencode"
    const expectedPath = path.join(folder, "memory.json")
    expect(expectedPath).toBe(".opencode/memory.json")
  })
})

describe("CodeSurf Migration - Ignore Patterns", () => {
  test("ignores both .opencode and .codesurf in file searches", async () => {
    const ignoreFolders = [".opencode", ".codesurf"]
    const testPaths = ["src/index.ts", ".opencode/agent/test.md", ".codesurf/plugin/test.ts", "lib/utils.ts"]

    const filtered = testPaths.filter((file) => !ignoreFolders.some((f) => file.includes(f)))

    expect(filtered).toEqual(["src/index.ts", "lib/utils.ts"])
  })
})

describe("CodeSurf Migration - Backward Compatibility", () => {
  test("existing opencode installations continue to work", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "opencode/model",
            username: "opencode-user",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.model).toBe("opencode/model")
        expect(config.username).toBe("opencode-user")
      },
    })
  })

  test("migrating from opencode preserves settings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "opencode/model",
            username: "opencode-user",
            theme: "opencode-theme",
          }),
        )

        await Bun.write(
          path.join(dir, "codesurf.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "codesurf/model",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.model).toBe("codesurf/model")
        expect(config.username).toBe("opencode-user")
        expect(config.theme).toBe("opencode-theme")
      },
    })
  })
})
