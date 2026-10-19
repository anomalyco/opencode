import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { cp, lstat, mkdir, symlink } from "node:fs/promises"
import path from "node:path"

export async function installRuntimePeer(root: string) {
  const source = path.join(root, "peer")
  const consumer = path.join(root, "consumer")
  await mkdir(source)
  await mkdir(consumer)
  await Bun.write(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "compiled-runtime-peer",
      version: "1.0.0",
      type: "module",
      exports: { "./tui": "./index.tsx", "./v2": "./v2.js" },
      peerDependencies: { "@opentui/core": ">=0.5.17", "@opentui/solid": ">=0.5.17", "solid-js": ">=1.9.12" },
    }),
  )
  await Bun.write(
    path.join(source, "nested.js"),
    `import { TextRenderable } from "@opentui/core"
import { createElement } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
export const probe = (host) => ({ core: host.TextRenderable === TextRenderable, solid: host.createElement === createElement, signals: host.createSignal === createSignal, stores: host.createStore === createStore })
`,
  )
  await Bun.write(
    path.join(source, "index.tsx"),
    `/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { audio } from "./player"
export { probe } from "./nested.js"
if (!audio) throw new Error("Host audio namespace missing")
const tui = (context) => {
  const [count, setCount] = createSignal(0)
  context.keymap.layer(() => ({ mode: "global", commands: [{ id: "peer.increment", bind: "ctrl+s", run() { setCount(value => value + 1); context.ui.toast.show({ message: "Shared action " + count() }) } }] }))
  context.ui.slot({ append: "prompt.footer", render() {
    if (usePlugin() !== context) throw new Error("Plugin context identity differs")
    return <text>Shared runtime {count()}</text>
  } })
}
export default { id: "compiled-runtime-peer", tui, async setup(context) { const { adapt } = await import("./compat.js"); return tui(adapt(context)) } }
`,
  )
  await Bun.write(path.join(source, "compat.js"), "export const adapt = context => context\n")
  await Bun.write(path.join(source, "player.ts"), 'import { Audio } from "@opentui/core"\nexport const audio = Audio\n')
  await Bun.write(
    path.join(source, "v2.js"),
    'import speech from "./index.tsx"\nimport { adapt } from "./compat.js"\nexport { probe } from "./nested.js"\nexport default { id: "compiled-runtime-peer", setup: context => speech.tui(adapt(context)) }\n',
  )
  await Bun.write(path.join(consumer, "package.json"), '{"private":true,"type":"module"}')
  const directory = path.join(consumer, "node_modules/compiled-runtime-peer")
  await cp(source, directory, { recursive: true })
  // Real, physically distinct runtime peers, without a registry install. Only
  // unrelated dependencies point back to the repository's existing packages.
  const peers = ["@opentui/core", "@opentui/solid", "solid-js"]
  for (const name of peers) {
    const from =
      name === "solid-js"
        ? packageRoot(name, import.meta.dir)
        : path.dirname(
            Bun.resolveSync(name === "@opentui/core" ? "opentui-core-test" : "opentui-solid-test", import.meta.dir),
          )
    const target = path.join(consumer, "node_modules", name)
    await cp(from, target, { recursive: true })
    assert.equal((await lstat(target)).isSymbolicLink(), false)
    const manifest: {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    } = await Bun.file(path.join(from, "package.json")).json()
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    })) {
      const dest = path.join(consumer, "node_modules", dependency)
      if (peers.includes(dependency) || existsSync(dest)) continue
      const resolved = (() => {
        try {
          return packageRoot(dependency, from)
        } catch (error) {
          // Optional packages for other platforms are not installed.
          if (Object.hasOwn(manifest.optionalDependencies ?? {}, dependency)) return undefined
          throw error
        }
      })()
      if (!resolved) continue
      await mkdir(path.dirname(dest), { recursive: true })
      await symlink(resolved, dest, process.platform === "win32" ? "junction" : "dir")
    }
  }
  const wrapper = path.join(consumer, "ports/peer")
  await mkdir(wrapper, { recursive: true })
  const metadata = path.join(directory, "package.json")
  const manifest = await Bun.file(metadata).json()
  return {
    consumer,
    directory,
    wrapper,
    async entry(native: boolean, form: "default" | "barrel" | "binding" | "alias" = "default") {
      await Bun.write(
        metadata,
        JSON.stringify({ ...manifest, exports: { ...manifest.exports, "./tui": native ? "./v2.js" : "./index.tsx" } }),
      )
      await Bun.write(
        path.join(wrapper, "tui.js"),
        {
          default: `export { default } from "compiled-runtime-peer/${native ? "v2" : "tui"}"`,
          barrel: `export { default } from "compiled-runtime-peer/${native ? "v2" : "tui"}"; export * from "compiled-runtime-peer/${native ? "v2" : "tui"}"`,
          binding: `import plugin from "compiled-runtime-peer/${native ? "v2" : "tui"}"; export default plugin`,
          alias: `export { default as default } from "compiled-runtime-peer/${native ? "v2" : "tui"}"`,
        }[form],
      )
    },
  }
}

function packageRoot(name: string, from: string) {
  const entry = (() => {
    try {
      return Bun.resolveSync(`${name}/package.json`, from)
    } catch {
      return Bun.resolveSync(name, from)
    }
  })()
  let directory = path.dirname(entry)
  while (true) {
    const file = path.join(directory, "package.json")
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) return directory
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`Missing package root for ${name}`)
    directory = parent
  }
}
