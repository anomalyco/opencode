import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"
// Use electron-builder's matcher so the tests also cover its glob and directory traversal semantics.
const { FileMatcher } = createRequire(import.meta.resolve("electron-builder"))("app-builder-lib/out/fileMatcher")

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
] as const

for (const channel of channels) {
  test(`includes the Windows sandbox permission hook for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel
    try {
      const config = (await import(`./electron-builder.config.ts?channel=${channel.channel}`)).default as Configuration
      const include = path.join(import.meta.dirname, "resources/windows/installer.nsh")
      expect(config.nsis?.include).toBe(include)
      expect(await Bun.file(include).exists()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = previous
    }
  })

  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })

  test(`trims external dependencies without excluding runtime files for ${channel.channel}`, async () => {
    const config = (await import(`./electron-builder.config.ts?channel=${channel.channel}`)).default as Configuration
    const filter = new FileMatcher(import.meta.dirname, "", (value: string) => value, [
      "**/*",
      ...(Array.isArray(config.files) ? config.files : []).filter(
        (value): value is string => typeof value === "string" && value.startsWith("!"),
      ),
    ]).createFilter()
    for (const prefix of ["node_modules/", "node_modules/parent/node_modules/"]) {
      for (const file of [
        "@zip.js/zip.js/dist/zip.js",
        "@zip.js/zip.js/dist/z-worker.js",
        "@zip.js/zip.js/index.cjs",
        "@zip.js/zip.js/index.min.js",
        "@zip.js/zip.js/index-fflate.js",
        "@zip.js/zip.js/deno.json",
        "@zip.js/zip.js/eslint.config.mjs",
        "electron-updater/out/main.js.map",
        "electron-updater/out/providers/GitHubProvider.js.map",
        "builder-util-runtime/out/httpExecutor.js.map",
        "lazy-val/out/main.js.map",
        "ajv/lib/core.ts",
        "ajv/dist/compile/index.js.map",
        "ajv-formats/src/formats.ts",
        "ajv-formats/dist/formats.js.map",
        "js-yaml/dist/js-yaml.js",
        "js-yaml/dist/js-yaml.min.js",
        "js-yaml/dist/js-yaml.mjs.map",
        "js-yaml/bin/js-yaml.js",
      ]) {
        expect(filter(path.join(import.meta.dirname, prefix, file), statSync(import.meta.filename))).toBe(false)
      }
      for (const file of [
        "@zip.js/zip.js/index.js",
        "@zip.js/zip.js/lib/zip-fs.js",
        "@zip.js/zip.js/lib/z-worker-inline.js",
        "@zip.js/zip.js/lib/core/streams/codecs/deflate.js",
        "electron-updater/out/main.js",
        "electron-updater/out/MacUpdater.js",
        "electron-updater/out/NsisUpdater.js",
        "electron-updater/out/providers/GitHubProvider.js",
        "builder-util-runtime/out/httpExecutor.js",
        "lazy-val/out/main.js",
        "ajv/dist/ajv.js",
        "ajv/dist/refs/json-schema-draft-07.json",
        "ajv-formats/dist/formats.js",
        "js-yaml/index.js",
        "js-yaml/lib/loader.js",
        "js-yaml/dist/js-yaml.mjs",
        "debug/src/index.js",
        "unrelated/dist/index.js.map",
        ...["@zip.js/zip.js", "electron-updater", "builder-util-runtime", "ajv", "ajv-formats", "js-yaml"].flatMap(
          (name) => [`${name}/package.json`, `${name}/LICENSE`],
        ),
      ]) {
        expect(filter(path.join(import.meta.dirname, prefix, file), statSync(import.meta.filename))).toBe(true)
      }
      expect(filter(path.join(import.meta.dirname, prefix, "@zip.js/zip.js/dist"), statSync(import.meta.dirname))).toBe(
        false,
      )
      expect(filter(path.join(import.meta.dirname, prefix, "@zip.js/zip.js/lib"), statSync(import.meta.dirname))).toBe(
        true,
      )
    }
  })
}

test("the trimmed Zip.js package can still export compressed logs", async () => {
  const config = (await import("./electron-builder.config.ts")).default
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-zip-package-"))
  const source = path.dirname(fileURLToPath(import.meta.resolve("@zip.js/zip.js/package.json")))
  const filter = new FileMatcher(dir, "", (value: string) => value, [
    "**/*",
    ...(Array.isArray(config.files) ? config.files : []).filter(
      (value): value is string => typeof value === "string" && value.startsWith("!"),
    ),
  ]).createFilter()
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

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

for (const channel of ["dev", "beta"] as const) {
  test(`bundles the CLI outside the ${channel} app archive`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.files).toContain("!resources/opencode-cli*")
    expect(config.extraResources).toEqual([
      {
        from: "resources/",
        to: "",
        filter: ["opencode-cli", "opencode-cli.exe"],
      },
    ])
  })
}
