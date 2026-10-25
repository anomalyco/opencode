import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Configuration } from "electron-builder"
import { getConfig } from "./electron-builder.config"
import { CLI_BINARIES, nodePtyPackage } from "./scripts/utils"

const legacyDesktopEntry = "resources/linux/bolt-desktop.desktop"

const channels = [
  { channel: "dev", appId: "com.boltbuilder.bolt.dev" },
  { channel: "beta", appId: "com.boltbuilder.bolt.beta" },
  { channel: "prod", appId: "com.boltbuilder.bolt" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.BOLT_CHANNEL
    process.env.BOLT_CHANNEL = channel.channel

  if (target !== undefined) process.env.OPENCODE_CLI_TARGET = target
  else delete process.env.OPENCODE_CLI_TARGET

    if (previous === undefined) delete process.env.BOLT_CHANNEL
    else process.env.BOLT_CHANNEL = previous

    if (previous !== undefined) process.env.OPENCODE_CHANNEL = previous

    if (previousTarget !== undefined) process.env.OPENCODE_CLI_TARGET = previousTarget
  }
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.BOLT_CHANNEL
  process.env.BOLT_CHANNEL = "prod"

  return new FileMatcher(dir, "", (value: string) => value, [
    "**/*",
    ...patterns.filter((value) => value.startsWith("!")),
  ]).createFilter()
}

  if (previous === undefined) delete process.env.BOLT_CHANNEL
  else process.env.BOLT_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("bolt-desktop.desktop=/usr/share/applications/bolt-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("bolt-desktop.desktop=/usr/share/applications/bolt-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/Bolt/com.boltbuilder.bolt %U")
  expect(desktop).toContain("Icon=com.boltbuilder.bolt")
  expect(desktop).toContain("StartupWMClass=com.boltbuilder.bolt")
  expect(desktop).toContain("NoDisplay=true")
})

test("bundles the CLI outside the dev app archive", async () => {
  const previous = process.env.BOLT_CHANNEL
  process.env.BOLT_CHANNEL = "dev"
  const module = await import("./electron-builder.config.ts?cli-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.BOLT_CHANNEL
  else process.env.BOLT_CHANNEL = previous

  expect(config.files).toContain("!resources/bolt-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["bolt-cli*"],
  })
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const previous = process.env.BOLT_CHANNEL
    process.env.BOLT_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?no-cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.BOLT_CHANNEL
    else process.env.BOLT_CHANNEL = previous

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["bolt-cli*"],
    })
  })
}

test("skips notarization for ad-hoc signed builds", async () => {
  const link = process.env.CSC_LINK
  const discovery = process.env.CSC_IDENTITY_AUTO_DISCOVERY
  delete process.env.CSC_LINK
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"

  const module = await import("./electron-builder.config.ts?notarize=adhoc")
  const config = module.default as Configuration

  if (link === undefined) delete process.env.CSC_LINK
  else process.env.CSC_LINK = link
  if (discovery === undefined) delete process.env.CSC_IDENTITY_AUTO_DISCOVERY
  else process.env.CSC_IDENTITY_AUTO_DISCOVERY = discovery

  expect(config.mac?.identity).toBe("-")
  expect(config.mac?.notarize).toBe(false)
})

test("notarizes when a signing certificate is available", async () => {
  const link = process.env.CSC_LINK
  const discovery = process.env.CSC_IDENTITY_AUTO_DISCOVERY
  process.env.CSC_LINK = "base64-cert"
  delete process.env.CSC_IDENTITY_AUTO_DISCOVERY

  const module = await import("./electron-builder.config.ts?notarize=cert")
  const config = module.default as Configuration

  if (link === undefined) delete process.env.CSC_LINK
  else process.env.CSC_LINK = link
  if (discovery === undefined) delete process.env.CSC_IDENTITY_AUTO_DISCOVERY
  else process.env.CSC_IDENTITY_AUTO_DISCOVERY = discovery

  expect(config.mac?.identity).toBeUndefined()
  expect(config.mac?.notarize).toBe(true)
})
