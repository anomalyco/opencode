import { expect } from "bun:test"
import { lstat, mkdir } from "node:fs/promises"
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
  const pack = Bun.spawn([process.execPath, "pm", "pack", "--destination", root], {
    cwd: source,
    stdout: "pipe",
    stderr: "pipe",
  })
  const packed = await Promise.all([pack.exited, new Response(pack.stdout).text(), new Response(pack.stderr).text()])
  expect({ code: packed[0], output: packed[0] ? packed.slice(1) : [] }).toEqual({ code: 0, output: [] })
  await Bun.write(
    path.join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "compiled-runtime-peer": `file:${path.join(root, "compiled-runtime-peer-1.0.0.tgz")}`,
        "@opentui/core": "0.6.6",
        "@opentui/solid": "0.6.6",
        "solid-js": "1.9.15",
      },
    }),
  )
  const child = Bun.spawn([process.execPath, "install", "--ignore-scripts", "--linker", "hoisted"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ code: result[0], output: result[0] ? result.slice(1) : [] }).toEqual({ code: 0, output: [] })
  expect(await Bun.file(path.join(consumer, "node_modules/@opentui/core/package.json")).json()).toMatchObject({
    version: "0.6.6",
  })
  for (const name of ["@opentui/core", "@opentui/solid", "solid-js"]) {
    expect((await lstat(path.join(consumer, "node_modules", name))).isSymbolicLink()).toBe(false)
  }
  const wrapper = path.join(consumer, "ports/peer")
  await mkdir(wrapper, { recursive: true })
  const directory = path.join(consumer, "node_modules/compiled-runtime-peer")
  const metadata = path.join(directory, "package.json")
  const manifest = await Bun.file(metadata).json()
  return {
    consumer,
    directory,
    wrapper,
    async entry(native: boolean) {
      await Bun.write(
        metadata,
        JSON.stringify({ ...manifest, exports: { ...manifest.exports, "./tui": native ? "./v2.js" : "./index.tsx" } }),
      )
      await Bun.write(
        path.join(wrapper, "tui.js"),
        `// Local package discovery bridge.\nexport { default } from "compiled-runtime-peer/${native ? "v2" : "tui"}"\n`,
      )
    },
  }
}
