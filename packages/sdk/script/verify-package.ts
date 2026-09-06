#!/usr/bin/env bun

import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const names = [
  "schema",
  "codemode",
  "ai",
  "util",
  "protocol",
  "client",
  "plugin",
  "core",
  "simulation",
  "server",
  "sdk",
]
const temporary = await mkdtemp(join(tmpdir(), "opencode-sdk-package-"))
const archives = new Map<string, string>()

try {
  for (const name of names) {
    const directory = join(root, "packages", name)
    await $`bun run build`.cwd(directory)
    const original = await Bun.file(join(directory, "package.json")).text()
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package manifests are validated by their package builds.
    const pkg = JSON.parse(original) as {
      name: string
      dependencies?: Record<string, string>
      exports?: Record<string, string | { import: string; types: string }>
      imports?: Record<string, Record<string, string>>
    }
    const archive = join(temporary, `${name}.tgz`)

    if (pkg.dependencies) {
      const unpacked = Object.entries(pkg.dependencies)
        .filter(([dependency, version]) => version.startsWith("workspace:") && !archives.has(dependency))
        .map(([dependency]) => dependency)
      if (unpacked.length > 0)
        throw new Error(`${pkg.name} has unpacked workspace dependencies: ${unpacked.join(", ")}`)
      pkg.dependencies = Object.fromEntries(
        Object.entries(pkg.dependencies).map(([dependency, version]) => {
          const local = archives.get(dependency)
          return [dependency, local ? `file:${local}` : version]
        }),
      )
    }
    if (pkg.exports) {
      pkg.exports = Object.fromEntries(
        Object.entries(pkg.exports).map(([key, value]) => {
          if (typeof value !== "string") return [key, value]
          return [key, { import: output(name, value), types: output(name, value, true) }]
        }),
      )
    }
    if (pkg.imports) {
      pkg.imports = Object.fromEntries(
        Object.entries(pkg.imports).map(([key, conditions]) => [
          key,
          Object.fromEntries(
            Object.entries(conditions).map(([condition, value]) => [
              condition,
              output(name, value, condition === "types"),
            ]),
          ),
        ]),
      )
    }

    await Bun.write(join(directory, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
    try {
      await $`bun pm pack --filename ${archive} --ignore-scripts --quiet`.cwd(directory)
    } finally {
      await Bun.write(join(directory, "package.json"), original)
    }
    archives.set(pkg.name, archive)
  }

  const consumer = join(temporary, "consumer")
  await Bun.write(
    join(consumer, "package.json"),
    JSON.stringify({ name: "opencode-sdk-consumer", private: true, type: "module" }),
  )
  await Promise.all([
    Bun.write(
      join(consumer, "wrangler.jsonc"),
      JSON.stringify({
        name: "opencode-sdk-packed-consumer",
        main: "worker.js",
        compatibility_date: "2026-07-15",
        compatibility_flags: ["nodejs_compat"],
        durable_objects: { bindings: [{ name: "OPENCODE", class_name: "OpenCodeDO" }] },
        migrations: [{ tag: "v1", new_sqlite_classes: ["OpenCodeDO"] }],
      }),
    ),
    Bun.write(
      join(consumer, "worker.js"),
      `import { bodyDigest } from "@opencode-ai/core/models-dev"
import { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"

export class OpenCodeDO {
  constructor(state) {
    this.configurations = 0
    this.opencode = state.blockConcurrencyWhile(() => OpenCodeWorkerd.create({
      storage: state.storage,
      app: { version: "packed-workerd" },
      models: { fetch: false },
      instances: {
        key: session => String(session.metadata.thread),
        configure: key => {
          this.configurations++
          return {
            plugins: [{
              id: "packed-instance",
              async setup(ctx) {
                if (ctx.app.version !== "packed-workerd" || ctx.location.directory !== "/workspace") {
                  throw new Error("Selected instance did not inherit the host configuration")
                }
                await ctx.session.hook("prompt", event => {
                  event.prompt.text += ":" + key
                })
              },
            }],
          }
        },
      },
    }))
  }

  async fetch() {
    if (bodyDigest("packed-workerd") !== "5fc174bf63e8dd108ebb6c53d85e7bbc4525b2f4c1c43280364cdbfd9b37aaf5") {
      throw new Error("Packed workerd SHA-256 mismatch")
    }
    const opencode = await this.opencode
    const sessions = await Promise.all([1, 2].map(() => opencode.sessions.create({
      location: { directory: "/workspace" },
      metadata: { thread: "packed-thread" },
    })))
    const admitted = await Promise.all(sessions.map(session => opencode.sessions.prompt({
      sessionID: session.id,
      text: "Packed prompt",
      resume: false,
    })))
    if (this.configurations !== 1 || admitted.some(item => item.payload.text !== "Packed prompt:packed-thread")) {
      throw new Error("Packed instance configuration did not share or prepare prompts correctly")
    }
    return Response.json(await opencode.health.get())
  }
}

export default {
  fetch(request, env) {
    return env.OPENCODE.get(env.OPENCODE.idFromName("packed-consumer")).fetch(request)
  },
}
`,
    ),
    Bun.write(
      join(consumer, "boot.mjs"),
      `import { Miniflare } from "miniflare"

const miniflare = new Miniflare({
  compatibilityDate: "2026-07-15",
  compatibilityFlags: ["nodejs_compat"],
  modules: true,
  scriptPath: new URL("./dist/worker.js", import.meta.url).pathname,
  durableObjects: { OPENCODE: { className: "OpenCodeDO", useSQLite: true } },
})

try {
  const response = await miniflare.dispatchFetch("http://opencode.local/health")
  if (response.status !== 200) throw new Error(
    "Packed workerd health returned " + response.status + ": " + await response.text(),
  )
  const body = await response.json()
  if (body.healthy !== true || body.version !== "packed-workerd") {
    throw new Error("Unexpected packed workerd health: " + JSON.stringify(body))
  }
} finally {
  await miniflare.dispose()
}
`,
    ),
    Bun.write(
      join(consumer, "imports.mjs"),
      `const modules = await Promise.all([
  import("@opencode-ai/sdk"),
  import("@opencode-ai/sdk/effect"),
  import("@opencode-ai/sdk/workerd"),
  import("@opencode-ai/sdk/workerd/effect"),
])

for (const module of modules) {
  const api = module.OpenCode ?? module.OpenCodeWorkerd
  if (typeof api?.create !== "function") throw new Error("Packed SDK entrypoint is missing create()")
}
`,
    ),
  ])

  const sdk = archives.get("@opencode-ai/sdk")
  if (!sdk) throw new Error("Packed SDK archive was not created")
  await $`npm install --ignore-scripts --no-audit --no-fund --package-lock=false ${sdk} wrangler@4.110.0`.cwd(consumer)
  const runtimes = (await $`npm ls effect --all --parseable`.cwd(consumer).text()).trim().split("\n")
  if (runtimes.length !== 1) {
    throw new Error(`Packed SDK consumer resolved multiple Effect runtimes:\n${runtimes.join("\n")}`)
  }
  await $`bun imports.mjs`.cwd(consumer)
  await $`bun --conditions=workerd imports.mjs`.cwd(consumer)
  await $`node_modules/.bin/wrangler deploy --dry-run --config wrangler.jsonc --outdir dist`.cwd(consumer)

  const transpiler = new Bun.Transpiler({ loader: "js" })
  const bundled = await Bun.file(join(consumer, "dist/worker.js")).text()
  const bunGlobals = Array.from(new Set(bundled.match(/\bBun\.[A-Za-z_$][\w$]*/g) ?? []))
  if (bunGlobals.length > 0) throw new Error(`Packed workerd bundle references Bun globals: ${bunGlobals.join(", ")}`)
  const leaked = [
    ...transpiler
      .scanImports(bundled)
      .filter((imported) => imported.kind !== "dynamic-import")
      .map((imported) => imported.path),
    ...Array.from(bundled.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g), (match) => match[1]),
  ].filter((specifier) => specifier === "bun" || specifier.startsWith("bun:"))
  if (leaked.length > 0) throw new Error(`Packed workerd bundle statically imports Bun builtins: ${leaked.join(", ")}`)

  // Boot in workerd to catch eager Node initializers; lazy createRequire calls
  // in native-only code are valid and must not fail a bundle-wide text check.
  await $`node boot.mjs`.cwd(consumer)
  console.log("packed SDK consumer OK")
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function output(name: string, value: string, types = false) {
  const root = name === "core" && types ? "./dist/types/" : "./dist/"
  return value.replace("./src/", root).replace(/\.ts$/, types ? ".d.ts" : ".js")
}
