import { ensurePluginRuntime } from "@opencode/plugin/runtime"
import assert from "node:assert/strict"
import { Host } from "@opencode/plugin/host"
import { TextRenderable } from "@opentui/core"
import { createElement } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createAppFixture } from "./app"

// A server/SDK consumer may initialize first. TUI modules must extend the same
// canonical runtime, not depend on being the first initializer.
ensurePluginRuntime()
await import("../../src/plugin/runtime-plugin-support.bun")
const owned = ensurePluginRuntime()
assert.equal(ensurePluginRuntime({ "solid-js": { createSignal: () => undefined } }), owned)

const directory = process.argv[2]
assert.ok(directory, "physical NPM package directory is required")
const wrapper = process.argv[3]
const entry = Host.resolve({ directory, name: "compiled-runtime-peer" }).tui
assert.ok(entry, "missing peer entrypoint")
await using setup = await createAppFixture({
  config: { animations: false, tabs: { mode: "off" }, plugins: [wrapper ?? "compiled-runtime-peer"] },
  packages: { prepare: async () => ({ directory, name: "compiled-runtime-peer" }) },
  log: (...entry) => {
    if (entry[0] === "warn" || entry[0] === "error") console.error(JSON.stringify(entry))
  },
})
await setup.ready
async function frame(text: string) {
  const deadline = Date.now() + 10_000
  while (!setup.captureCharFrame().includes(text)) {
    assert.ok(Date.now() < deadline, `missing ${text}:\n${setup.captureCharFrame()}`)
    await setup.renderOnce()
    await Bun.sleep(10)
  }
}
await frame("Shared runtime 0")
await frame("ctrl+p commands")
const peer = (await Host.load(entry)) as { probe(input: object): Record<string, boolean> }
assert.deepEqual(peer.probe({ TextRenderable, createElement, createSignal, createStore }), {
  core: true,
  solid: true,
  signals: true,
  stores: true,
})
setup.mockInput.pressKey("s", { ctrl: true })
await frame("Shared runtime 1")
console.log("COMPILED_RUNTIME_SHARED_OK")
