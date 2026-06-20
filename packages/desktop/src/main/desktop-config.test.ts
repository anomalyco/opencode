import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { readDesktopConfig } from "./desktop-config"

const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

afterEach(() => {
  process.env.XDG_CONFIG_HOME = previousXdgConfigHome
})

test("reads supported desktop config values", async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "opencode-desktop-config-"))
  await mkdir(join(process.env.XDG_CONFIG_HOME, "opencode"))
  await writeFile(
    join(process.env.XDG_CONFIG_HOME, "opencode", "desktop.json"),
    JSON.stringify({
      permissions: {
        autoApprove: true,
        unsupported: true,
      },
      sounds: {
        agentEnabled: false,
        agent: "glass",
        permissionsEnabled: true,
        permissions: "ping",
        errorsEnabled: false,
        errors: "alert",
      },
    }),
  )

  expect(await readDesktopConfig()).toEqual({
    permissions: {
      autoApprove: true,
    },
    sounds: {
      agentEnabled: false,
      agent: "glass",
      permissionsEnabled: true,
      permissions: "ping",
      errorsEnabled: false,
      errors: "alert",
    },
  })

  await rm(process.env.XDG_CONFIG_HOME, { recursive: true, force: true })
})

test("ignores missing or malformed desktop config", async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "opencode-desktop-config-"))
  expect(await readDesktopConfig()).toBeUndefined()

  await mkdir(join(process.env.XDG_CONFIG_HOME, "opencode"))
  await writeFile(join(process.env.XDG_CONFIG_HOME, "opencode", "desktop.json"), "{")
  expect(await readDesktopConfig()).toBeUndefined()

  await rm(process.env.XDG_CONFIG_HOME, { recursive: true, force: true })
})
