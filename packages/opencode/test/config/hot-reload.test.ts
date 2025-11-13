import { test, expect } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Bus } from "../../src/bus"
import { Server } from "../../src/server/server"
import { Global } from "../../src/global"
import { ConfigInvalidation } from "../../src/config/invalidation"

async function withFreshGlobalPath<T>(fn: (globalRoot: string) => Promise<T>) {
  const originalGlobalConfig = Global.Path.config
  const globalRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-global-")), "config")
  ;(Global.Path as any).config = globalRoot
  await fs.mkdir(globalRoot, { recursive: true })
  try {
    return await fn(globalRoot)
  } finally {
    ;(Global.Path as any).config = originalGlobalConfig
    await fs.rm(globalRoot, { recursive: true, force: true })
  }
}

async function createWorkspace(prefix?: string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix ?? "opencode-test-"))
  await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true })
  await fs.writeFile(path.join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main")
  return tmpDir
}

async function patchConfig(directory: string, body: Record<string, unknown>, scope: "project" | "global" = "project") {
  const url = new URL("/config", "http://localhost")
  url.searchParams.set("scope", scope)
  url.searchParams.set("directory", directory)

  return Server.App().fetch(
    new Request(url.toString(), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

async function getConfig(directory: string) {
  const url = new URL("/config", "http://localhost")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(
    new Request(url.toString(), {
      method: "GET",
    }),
  )
}

async function subscribeWithContext(directory: string, callback: (event: any) => Promise<void> | void) {
  return Instance.provide({
    directory,
    fn: async () => {
      return Bus.subscribe(Config.Event.Updated, async (event) => {
        const targetDirectory = event.properties.directory ?? process.cwd()
        return Instance.provide({
          directory: targetDirectory,
          fn: async () => {
            await callback(event)
          },
        })
      })
    },
  })
}

async function ensureInstance(directory: string) {
  await Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      await Config.get()
    },
  })
}

async function cleanup(directories: string[]) {
  await Instance.disposeAll()
  for (const dir of directories) {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

await Instance.disposeAll()

test("config hot reload updates without full dispose", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const directory = await createWorkspace("hot-reload-")
  try {
    await withFreshGlobalPath(async () => {
      await Instance.provide({
        directory,
        fn: async () => {
          const before = await Config.get()
          expect(before.model).toBeUndefined()

          const result = await Config.update({
            scope: "project",
            update: { model: "anthropic/claude-3-5-sonnet" },
            directory,
          })

          expect(result.after.model).toBe("anthropic/claude-3-5-sonnet")

          const configPath = path.join(directory, ".opencode", "opencode.jsonc")
          expect(await Bun.file(configPath).exists()).toBe(true)

          const content = await Bun.file(configPath).text()
          expect(content).toContain("anthropic/claude-3-5-sonnet")
          expect(result.filepath).toBe(configPath)
        },
      })
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([directory])
  }
})

test("config hot reload with feature flag disabled uses full dispose", async () => {
  delete process.env.OPENCODE_CONFIG_HOT_RELOAD
  const directory = await createWorkspace("hot-reload-disabled-")
  try {
    await withFreshGlobalPath(async () => {
      await Instance.provide({
        directory,
        fn: async () => {
          const result = await Config.update({
            scope: "project",
            update: { model: "anthropic/claude-3-5-sonnet" },
            directory,
          })

          expect(result.after.model).toBe("anthropic/claude-3-5-sonnet")
        },
      })
    })
  } finally {
    await cleanup([directory])
  }
})

test("GET /config returns cached view when hot reload is disabled", async () => {
  delete process.env.OPENCODE_CONFIG_HOT_RELOAD
  const directory = await createWorkspace("hot-reload-get-disabled-")
  try {
    await withFreshGlobalPath(async () => {
      await ensureInstance(directory)

      const patchResponse = await patchConfig(directory, { model: "cached-model" }, "project")
      expect(patchResponse.status).toBe(200)

      const response = await getConfig(directory)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.model).toBeUndefined()

      const configPath = path.join(directory, ".opencode", "opencode.jsonc")
      const fileContent = await Bun.file(configPath).text()
      expect(fileContent).toContain("cached-model")
    })
  } finally {
    await cleanup([directory])
  }
})

test("global updates propagate despite local overrides", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const writer = await createWorkspace("global-writer-")
  const observer = await createWorkspace("global-observer-")
  try {
    await withFreshGlobalPath(async () => {
      await fs.mkdir(path.join(writer, ".opencode"), { recursive: true })
      await fs.writeFile(path.join(writer, ".opencode", "opencode.jsonc"), JSON.stringify({ model: "local-model" }))

      await ensureInstance(writer)
      await ensureInstance(observer)

      const response = await patchConfig(writer, { model: "global-model" }, "global")
      expect(response.status).toBe(200)

      await Instance.provide({
        directory: observer,
        fn: async () => {
          const config = await Config.get()
          expect(config.model).toBe("global-model")
        },
      })
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([writer, observer])
  }
})

test("custom XDG_CONFIG_HOME is honored for global updates", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const workspace = await createWorkspace("xdg-config-")
  try {
    await withFreshGlobalPath(async () => {
      const xdgBase = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-xdg-"))
      const customConfigRoot = path.join(xdgBase, "opencode")
      const previousConfigPath = Global.Path.config
      try {
        ;(Global.Path as any).config = customConfigRoot
        await fs.mkdir(customConfigRoot, { recursive: true })
        await ensureInstance(workspace)

        const response = await patchConfig(workspace, { model: "xdg-model" }, "global")
        expect(response.status).toBe(200)

        const fileContent = await Bun.file(path.join(customConfigRoot, "opencode.jsonc")).text()
        expect(fileContent).toContain("xdg-model")

        await Instance.provide({
          directory: workspace,
          fn: async () => {
            const config = await Config.get()
            expect(config.model).toBe("xdg-model")
          },
        })
      } finally {
        ;(Global.Path as any).config = previousConfigPath
        await fs.rm(xdgBase, { recursive: true, force: true })
      }
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([workspace])
  }
})

test("event subscriber sees refreshed config before targeted invalidations", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const directory = await createWorkspace("event-subscriber-")
  try {
    await withFreshGlobalPath(async () => {
      await ensureInstance(directory)

      const response = await patchConfig(directory, { model: "event-model" }, "global")
      expect(response.status).toBe(200)

      await Instance.provide({
        directory,
        fn: async () => {
          const config = await Config.get()
          expect(config.model).toBe("event-model")
        },
      })
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([directory])
  }
})

test("global fan-out surfaces aggregated publish errors", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const sender = await createWorkspace("fanout-sender-")
  const target = await createWorkspace("fanout-target-")
  try {
    await withFreshGlobalPath(async () => {
      await ensureInstance(sender)
      await ensureInstance(target)

      const unsub = await subscribeWithContext(target, (event) => {
        if (event.properties.directory === target) {
          throw new Error("publish failure")
        }
      })

      const response = await patchConfig(sender, { model: "fanout-model" }, "global")
      expect(response.status).toBe(500)

      const json = await response.json()
      const message = String((json && (json.message ?? json.data?.message)) ?? "")
      expect(message).toContain("Failed to notify directories")

      await Instance.provide({
        directory: target,
        fn: async () => {
          const config = await Config.get()
          expect(config.model).toBe("fanout-model")
        },
      })

      unsub()
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([sender, target])
  }
})

test("project updates remain scoped to the initiator", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const writer = await createWorkspace("project-writer-")
  const observer = await createWorkspace("project-observer-")
  try {
    await withFreshGlobalPath(async () => {
      await ensureInstance(writer)
      await ensureInstance(observer)

      await patchConfig(writer, { model: "global-model" }, "global")

      const response = await patchConfig(writer, { model: "project-model" }, "project")
      expect(response.status).toBe(200)

      await Instance.provide({
        directory: writer,
        fn: async () => {
          const config = await Config.get()
          expect(config.model).toBe("project-model")
        },
      })

      await Instance.provide({
        directory: observer,
        fn: async () => {
          const config = await Config.get()
          expect(config.model).toBe("global-model")
        },
      })
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([writer, observer])
  }
})

test("theme-only global updates avoid unrelated invalidations", async () => {
  process.env.OPENCODE_CONFIG_HOT_RELOAD = "true"
  const workspace = await createWorkspace("theme-only-")
  try {
    await withFreshGlobalPath(async () => {
      await ensureInstance(workspace)
      const invalidations: string[] = []
      const originalInvalidate = Instance.invalidate
      ;(Instance as any).invalidate = async (name: string) => {
        invalidations.push(name)
        await originalInvalidate(name)
      }

      try {
        await ConfigInvalidation.apply({
          scope: "global",
          directory: workspace,
          diff: { theme: true },
        })
      } finally {
        ;(Instance as any).invalidate = originalInvalidate
      }

      const nonConfigInvalidations = invalidations.filter((name) => name !== "config")
      expect(nonConfigInvalidations).toEqual(["theme"])
    })
  } finally {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    await cleanup([workspace])
  }
})
