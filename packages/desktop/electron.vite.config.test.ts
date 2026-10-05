import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { loadConfigFromFile, MainConfigFactory } from "electron-vite"
import { build } from "vite"
import pkg from "./package.json"

const load = (command: "build" | "serve") =>
  loadConfigFromFile(
    { command, mode: command === "build" ? "production" : "development" },
    `${import.meta.dirname}/electron.vite.config.ts`,
  )
// Bundled into the main process, so the manifest must not also ship them as external packages.
const bundled = ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"]

test("minifies only builds, previews onboarding only in development, and ships sourcemaps and public assets", async () => {
  const previous = process.env.OPENCODE_TEST_ONBOARDING
  try {
    process.env.OPENCODE_TEST_ONBOARDING = "1"
    for (const command of ["build", "serve"] as const) {
      const result = await load(command)
      for (const target of [result.config.main, result.config.preload, result.config.renderer])
        expect(target?.build?.minify).toBe(command === "build")
      expect(result.config.renderer?.define?.["import.meta.env.OPENCODE_TEST_ONBOARDING"]).toBe(
        JSON.stringify(command === "serve"),
      )
    }
    delete process.env.OPENCODE_TEST_ONBOARDING
    const serve = await load("serve")
    expect(serve.config.renderer?.define?.["import.meta.env.OPENCODE_TEST_ONBOARDING"]).toBe("false")
  } finally {
    delete process.env.OPENCODE_TEST_ONBOARDING
    if (previous !== undefined) process.env.OPENCODE_TEST_ONBOARDING = previous
  }
  const renderer = (await load("build")).config.renderer
  // Sentry uploads the renderer source maps, then deletes them.
  expect(renderer?.build?.sourcemap).toBe(true)
  // Vite resolves publicDir from the renderer root, not from the config file.
  if (!renderer?.root || typeof renderer.publicDir !== "string") throw new Error("Missing renderer root or publicDir")
  expect(existsSync(path.resolve(import.meta.dirname, renderer.root, renderer.publicDir, "oc-theme-preload.js"))).toBe(
    true,
  )
})

test("bundles one Effect runtime and Drizzle while keeping native dependencies external", async () => {
  for (const name of bundled) {
    expect(Object.keys(pkg.dependencies)).not.toContain(name)
    expect(Object.keys(pkg.optionalDependencies)).not.toContain(name)
  }
  expect(Object.keys(pkg.optionalDependencies).filter((name) => name.startsWith("@lydell/node-pty-"))).toEqual([
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
    "@lydell/node-pty-win32-arm64",
    "@lydell/node-pty-win32-x64",
  ])
  const result = await load("build")
  if (!result.config.main) throw new Error("Missing main-process build configuration")
  const config = await new MainConfigFactory(
    result.config.main,
    { configFile: false, mode: "production" },
    { root: import.meta.dirname },
  ).build()
  config.build = { ...config.build, write: false }
  config.logLevel = "silent"
  const output = await build(config)
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) =>
    "output" in result ? result.output.filter((item) => item.type === "chunk") : [],
  )
  expect(chunks.length).toBeGreaterThan(0)
  // Resource resolution must not depend on which lazy entry owns DesktopPaths.
  expect(chunks.every((chunk) => !chunk.fileName.includes("/"))).toBe(true)
  const imports = chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports])
  const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules))
  for (const name of bundled) {
    expect(imports.filter((id) => id === name || id.startsWith(`${name}/`))).toEqual([])
    expect(modules.some((id) => id.includes(`/node_modules/${name}/`))).toBe(true)
  }
  const effect = modules.filter((id) => id.includes("/node_modules/effect/"))
  expect(new Set(effect.map((id) => id.split("/node_modules/effect/")[0])).size).toBe(1)
  expect(new Set(effect).size).toBe(effect.length)
  expect(imports).toContain("electron")
  expect(imports).toContain("node:sqlite")
  expect(chunks.some((chunk) => chunk.dynamicImports.includes("@zip.js/zip.js"))).toBe(true)
  expect(imports).toContain(`@lydell/node-pty-${process.platform}-${process.arch}`)
  expect(modules.some((id) => id.includes("/node_modules/msgpackr"))).toBe(false)
  expect(chunks.some((chunk) => chunk.code.includes("msgpackr"))).toBe(false)
}, 30_000)
