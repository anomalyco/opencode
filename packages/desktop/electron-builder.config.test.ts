import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Configuration } from "electron-builder"

// Use electron-builder's matcher so the tests also cover its glob and directory traversal semantics.
const { FileMatcher } = createRequire(import.meta.resolve("electron-builder"))("app-builder-lib/out/fileMatcher")

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
] as const

async function load(channel: string) {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = channel

  try {
    return (await import(`./electron-builder.config.ts?${channel}`)).default as Configuration
  } finally {
    delete process.env.OPENCODE_CHANNEL

    if (previous !== undefined) process.env.OPENCODE_CHANNEL = previous
  }
}

function trimFilter(dir: string, config: Configuration) {
  return new FileMatcher(dir, "", (value: string) => value, [
    "**/*",
    ...(Array.isArray(config.files) ? config.files : []).filter(
      (value): value is string => typeof value === "string" && value.startsWith("!"),
    ),
  ]).createFilter()
}

test.each(channels)("channel identity for $channel", async ({ channel, appId }) => {
  const config = await load(channel)
  expect(config.appId).toBe(appId)
  expect(config.extraMetadata?.desktopName).toBe(`${appId}.desktop`)
  expect(config.linux?.executableName).toBe(appId)
  expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(appId)

  for (const fpm of [config.deb?.fpm, config.rpm?.fpm]) {
    expect(fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${appId}.metainfo.xml`))
    expect(
      fpm?.some((entry) => entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop")),
    ).toBe(channel === "prod")
  }
})

test("legacy Linux launcher stays hidden", async () => {
  const desktop = await Bun.file(path.join(import.meta.dirname, "resources/linux/opencode-desktop.desktop")).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

test("shared packaging defaults", async () => {
  const config = await load("dev")
  expect(config.mac?.sign).toBeFunction()
  expect(config.dmg?.sign).not.toBe(true)
  expect(config.mac?.extendInfo?.NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac).toBe(true)
  const include = path.join(import.meta.dirname, "resources/windows/installer.nsh")
  expect(config.nsis?.include).toBe(include)
  expect(await Bun.file(include).exists()).toBe(true)
  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).toEqual([
    { from: "resources/", to: "", filter: ["opencode-cli", "opencode-cli.exe", "opencode-cli.version"] },
  ])
})

test("trims external dependencies without excluding runtime files", async () => {
  const filter = trimFilter(import.meta.dirname, await load("dev"))

  for (const prefix of ["node_modules/", "node_modules/parent/node_modules/"]) {
    const included = (file: string, stats = statSync(import.meta.filename)) =>
      filter(path.join(import.meta.dirname, prefix, file), stats)

    // One file for each excluded pattern, including each brace alternative.
    for (const file of [
      "@zip.js/zip.js/dist/zip.js",
      ...["index.cjs", "index.min.js", "index-fflate.js", "deno.json", "eslint.config.mjs"].map(
        (name) => `@zip.js/zip.js/${name}`,
      ),
      ...["d.ts", "d.cts", "d.mts", "d.ts.map", "d.cts.map", "d.mts.map", "js.map", "cjs.map", "mjs.map"].map(
        (extension) => `unrelated/dist/index.${extension}`,
      ),
      "ajv/lib/core.ts",
      "ajv-formats/src/formats.ts",
      "js-yaml/dist/js-yaml.js",
      "js-yaml/dist/js-yaml.min.js",
      "js-yaml/dist/js-yaml.mjs.map",
      "js-yaml/bin/js-yaml.js",
    ]) {
      expect(included(file)).toBe(false)
    }

    for (const file of [
      "@zip.js/zip.js/index.js",
      "@zip.js/zip.js/lib/z-worker-inline.js",
      "electron-updater/out/main.js",
      "electron-updater/out/MacUpdater.js",
      "electron-updater/out/NsisUpdater.js",
      "electron-updater/out/providers/GitHubProvider.js",
      "builder-util-runtime/out/httpExecutor.js",
      "ajv/dist/ajv.js",
      "ajv/dist/refs/json-schema-draft-07.json",
      "ajv-formats/dist/formats.js",
      "js-yaml/index.js",
      "js-yaml/dist/js-yaml.mjs",
      "unrelated/dist/index.js",
      "unrelated/dist/index.cjs",
      "unrelated/dist/data.json",
      "unrelated/src/index.ts",
      ...["@zip.js/zip.js", "electron-updater", "builder-util-runtime", "ajv", "ajv-formats", "js-yaml"].flatMap(
        (name) => [`${name}/package.json`, `${name}/LICENSE`],
      ),
    ]) {
      expect(included(file)).toBe(true)
    }

    expect(included("@zip.js/zip.js/dist", statSync(import.meta.dirname))).toBe(false)
    expect(included("@zip.js/zip.js/lib", statSync(import.meta.dirname))).toBe(true)
  }
})

test("the trimmed Zip.js package can still export compressed logs", async () => {
  const config = (await import("./electron-builder.config.ts")).default
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-zip-package-"))
  const source = path.dirname(fileURLToPath(import.meta.resolve("@zip.js/zip.js/package.json")))
  const filter = trimFilter(dir, config)

  try {
    await cp(source, dir, {
      recursive: true,
      filter: (file) =>
        filter(path.join(dir, "node_modules/@zip.js/zip.js", path.relative(source, file)), statSync(file)),
    })
    const zip = await import(pathToFileURL(path.join(dir, "index.js")).href)
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
    await writer.add("desktop.log", new zip.BlobReader(new Blob(["diagnostic log\n".repeat(100)])))
    const reader = new zip.ZipReader(new zip.BlobReader(await writer.close()))
    const entries = await reader.getEntries()
    expect(entries.map((entry: { filename: string }) => entry.filename)).toEqual(["desktop.log"])
    expect(entries[0].compressionMethod).toBe(8)
    expect(await entries[0].getData(new zip.TextWriter())).toBe("diagnostic log\n".repeat(100))
    await reader.close()
    await zip.terminateWorkers()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
