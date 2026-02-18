import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { LSPServer } from "../../src/lsp/server"
import { LSPClient } from "../../src/lsp/client"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

function spawnFakeServer(): LSPServer.Handle {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("JDTLS root resolution", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("resolves to workspace root when settings.gradle exists", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "settings.gradle"), "")
        await fs.mkdir(path.join(dir, "app/src"), { recursive: true })
        await Bun.write(path.join(dir, "app/build.gradle"), "")
        await Bun.write(path.join(dir, "app/src/Main.java"), "")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await LSPServer.JDTLS.root(path.join(tmp.path, "app/src/Main.java"))
        expect(root).toBe(tmp.path)
      },
    })
  })

  test("resolves to subproject root when no settings.gradle exists", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "app/src"), { recursive: true })
        await Bun.write(path.join(dir, "app/pom.xml"), "")
        await Bun.write(path.join(dir, "app/src/Main.java"), "")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await LSPServer.JDTLS.root(path.join(tmp.path, "app/src/Main.java"))
        expect(root).toBe(path.join(tmp.path, "app"))
      },
    })
  })

  test("resolves to workspace root across multiple subprojects", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "settings.gradle.kts"), "")
        await fs.mkdir(path.join(dir, "modules/api/src"), { recursive: true })
        await fs.mkdir(path.join(dir, "modules/core/src"), { recursive: true })
        await Bun.write(path.join(dir, "modules/api/build.gradle.kts"), "")
        await Bun.write(path.join(dir, "modules/core/build.gradle.kts"), "")
        await Bun.write(path.join(dir, "modules/api/src/Api.java"), "")
        await Bun.write(path.join(dir, "modules/core/src/Core.java"), "")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const api = await LSPServer.JDTLS.root(path.join(tmp.path, "modules/api/src/Api.java"))
        const core = await LSPServer.JDTLS.root(path.join(tmp.path, "modules/core/src/Core.java"))
        expect(api).toBe(tmp.path)
        expect(core).toBe(tmp.path)
      },
    })
  })
})

describe("Handle cleanup", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("shutdown calls handle cleanup", async () => {
    let cleaned = false
    const handle = spawnFakeServer()
    handle.cleanup = async () => {
      cleaned = true
    }

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle,
          root: process.cwd(),
        }),
    })

    await client.shutdown()
    expect(cleaned).toBe(true)
  })
})
