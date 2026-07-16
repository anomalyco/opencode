import path from "node:path"
import { readFile } from "node:fs/promises"
import { defineConfig, type Plugin, type UserConfig } from "vite"
import solid from "vite-plugin-solid"
import { nodeExecArgv, nodeTarget, type NodeTarget, photonWasmAsset } from "./src/node/target"

const dir = import.meta.dirname

function rawTextPlugin(): Plugin {
  return {
    name: "opencode:raw-text",
    async load(id) {
      if (!id.endsWith(".md")) return
      return `export default ${JSON.stringify(await readFile(id, "utf8"))}`
    },
  }
}

function runtimeRequirePlugin(): Plugin {
  return {
    name: "opencode:runtime-require",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("turndown/lib/turndown.es.js")) return
      const transformed = code.replace("    var domino = require('@mixmark-io/domino');", "")
      if (transformed === code) this.error("Failed to rewrite Turndown's Domino require")
      return `import domino from "@mixmark-io/domino"\n${transformed}`
    },
  }
}

const resolve = {
  alias: [
    { find: /^solid-js\/store$/, replacement: "solid-js/store/dist/store.js" },
    { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
    { find: /^ws$/, replacement: path.resolve(dir, "node_modules/ws/wrapper.mjs") },
  ],
  conditions: ["node"],
}

const output = (entryFileNames: string, banner?: string) => ({
  format: "esm" as const,
  entryFileNames,
  inlineDynamicImports: true,
  banner,
})

function nodePrelude(input: NodeBuildInput) {
  const nodePtySpawnHelper =
    input.target.platform === "darwin"
      ? `${input.target.nodePtyPackage}/prebuilds/darwin-${input.target.arch}/spawn-helper`
      : undefined
  const promiseModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const Agent = sdk.Agent
export const Command = sdk.Command
export const Connection = sdk.Connection
export const Credential = sdk.Credential
export const Integration = sdk.Integration
export const Model = sdk.Model
export const Plugin = sdk.Plugin
export const Provider = sdk.Provider
export const Reference = sdk.Reference
export const Skill = sdk.Skill`
  const effectModule = promiseModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const promisePluginModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const define = sdk.Plugin.define`
  const effectPluginModule = promisePluginModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const effectToolModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.effect")]
if (!sdk) throw new Error("OpenCode Effect plugin SDK is unavailable")
export const Tool = sdk.Tool
export const Failure = sdk.Tool.Failure
export const RegistrationError = sdk.Tool.RegistrationError
export const make = sdk.Tool.make
export const validateName = sdk.Tool.validateName
export const registrationEntries = sdk.Tool.registrationEntries
export const withPermission = sdk.Tool.withPermission
export const permission = sdk.Tool.permission
export const definition = sdk.Tool.definition
export const settle = sdk.Tool.settle`
  return `#!/usr/bin/env -S node ${nodeExecArgv.join(" ")}
import __cjs_mod__ from "node:module"
import { chmodSync as __ocChmod, existsSync as __ocExists, lstatSync as __ocLstat, mkdirSync as __ocMkdir, renameSync as __ocRename, rmSync as __ocRm, writeFileSync as __ocWrite } from "node:fs"
import { tmpdir as __ocTmpdir } from "node:os"
import __ocPath from "node:path"
import { getAssetKeys as __ocAssetKeys, getRawAsset as __ocRawAsset, isSea as __ocIsSea } from "node:sea"
import { fileURLToPath as __ocFileURLToPath } from "node:url"
const __filename = import.meta.filename
const __dirname = import.meta.dirname
const require = __cjs_mod__.createRequire(import.meta.url)
const __ocPluginModules = ${JSON.stringify({
    "@opencode-ai/plugin/v2": "opencode:plugin-v2",
    "@opencode-ai/plugin/v2/plugin": "opencode:plugin-v2-plugin",
    "@opencode-ai/plugin/v2/effect": "opencode:plugin-v2-effect",
    "@opencode-ai/plugin/v2/effect/plugin": "opencode:plugin-v2-effect-plugin",
    "@opencode-ai/plugin/v2/effect/tool": "opencode:plugin-v2-effect-tool",
  })}
const __ocPluginSources = ${JSON.stringify({
    "opencode:plugin-v2": promiseModule,
    "opencode:plugin-v2-plugin": promisePluginModule,
    "opencode:plugin-v2-effect": effectModule,
    "opencode:plugin-v2-effect-plugin": effectPluginModule,
    "opencode:plugin-v2-effect-tool": effectToolModule,
  })}
__cjs_mod__.registerHooks({
  resolve(__ocSpecifier, __ocContext, __ocNextResolve) {
    const __ocUrl = __ocPluginModules[__ocSpecifier]
    return __ocUrl ? { url: __ocUrl, shortCircuit: true } : __ocNextResolve(__ocSpecifier, __ocContext)
  },
  load(__ocUrl, __ocContext, __ocNextLoad) {
    const __ocSource = __ocPluginSources[__ocUrl]
    return __ocSource
      ? { format: "module", source: __ocSource, shortCircuit: true }
      : __ocNextLoad(__ocUrl, __ocContext)
  },
})
const __ocUid = typeof process.getuid === "function" ? process.getuid() : undefined
const __ocCacheRoot = __ocPath.join(__ocTmpdir(), \`opencode-node-\${__ocUid ?? "user"}\`)
if (__ocIsSea()) {
  try {
    __ocMkdir(__ocCacheRoot, { mode: 0o700 })
  } catch (__ocError) {
    if (!__ocExists(__ocCacheRoot)) throw __ocError
  }
  const __ocCacheInfo = __ocLstat(__ocCacheRoot)
  if (!__ocCacheInfo.isDirectory() || __ocCacheInfo.isSymbolicLink()) throw new Error("Unsafe Node asset cache path")
  if (__ocUid !== undefined && __ocCacheInfo.uid !== __ocUid) throw new Error("Node asset cache is owned by another user")
  if (__ocUid !== undefined) __ocChmod(__ocCacheRoot, 0o700)
}
const __ocAssetRoot = __ocIsSea()
  ? __ocPath.join(__ocCacheRoot, ${JSON.stringify(`${input.assetHash}-${input.target.platform}-${input.target.arch}`)})
  : __ocFileURLToPath(new URL("./assets/", import.meta.url))
if (__ocIsSea()) {
  for (const __ocKey of __ocAssetKeys()) {
    const __ocTarget = __ocPath.join(__ocAssetRoot, __ocKey)
    if (__ocExists(__ocTarget)) continue
    __ocMkdir(__ocPath.dirname(__ocTarget), { recursive: true })
    const __ocTemporary = \`${"${__ocTarget}"}.${"${process.pid}"}.${"${crypto.randomUUID()}"}.tmp\`
    __ocWrite(__ocTemporary, new Uint8Array(__ocRawAsset(__ocKey)))
    try {
      __ocRename(__ocTemporary, __ocTarget)
    } catch (__ocError) {
      __ocRm(__ocTemporary, { force: true })
      if (!__ocExists(__ocTarget)) throw __ocError
    }
  }
  const __ocPtySpawnHelper = ${JSON.stringify(nodePtySpawnHelper)}
  if (__ocPtySpawnHelper) __ocChmod(__ocPath.join(__ocAssetRoot, __ocPtySpawnHelper), 0o755)
}
process.env.OPENCODE_NODE_ASSETS_DIR = __ocAssetRoot
process.env.OTUI_ASSET_ROOT = __ocAssetRoot
process.env.OPENCODE_NODE_PTY_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.nodePtyEntryAsset)})
process.env.OPENCODE_PARCEL_WATCHER_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.parcelWatcherAsset)})
process.env.OPENCODE_PHOTON_WASM_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(photonWasmAsset)})
globalThis.__OPENCODE_PHOTON_WASM_PATH = process.env.OPENCODE_PHOTON_WASM_PATH
if (process.platform === "linux") process.env.OPENTUI_LIBC = "glibc"`
}

export type NodeBuildInput = {
  readonly version: string
  readonly channel: string
  readonly models: string
  readonly assetHash: string
  readonly target: NodeTarget
}

export function mainConfig(input: NodeBuildInput): UserConfig {
  return defineConfig({
    root: dir,
    plugins: [
      rawTextPlugin(),
      runtimeRequirePlugin(),
      solid({
        solid: {
          generate: "universal",
          moduleName: "@opentui/solid",
        },
      }),
    ],
    resolve,
    esbuild: { jsx: "automatic" },
    define: {
      OPENCODE_VERSION: JSON.stringify(input.version),
      OPENCODE_CLI_NAME: JSON.stringify("opencode2-node"),
      OPENCODE_MODELS_DEV: input.models,
      OPENCODE_CHANNEL: JSON.stringify(input.channel),
      OPENCODE_LIBC: input.target.platform === "linux" ? JSON.stringify("glibc") : "undefined",
      FFF_LIBC: input.target.platform === "linux" ? JSON.stringify("gnu") : "undefined",
    },
    ssr: { noExternal: true },
    build: {
      ssr: "src/node/index.ts",
      target: "node26",
      outDir: "dist-node",
      emptyOutDir: false,
      minify: true,
      rollupOptions: {
        external: [/^@opencode-ai\/simulation(?:\/|$)/],
        output: output("opencode.mjs", nodePrelude(input)),
      },
    },
  })
}

export default mainConfig({
  version: process.env.OPENCODE_VERSION ?? "local",
  channel: process.env.OPENCODE_CHANNEL ?? "local",
  models: "undefined",
  assetHash: "local",
  target: nodeTarget(process.platform, process.arch),
})
