import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { BuiltinPanel, type BuiltinStoreDeclaration } from "@opencode/plugin/gui/builtin"
import type { Platform } from "@/runtime/platform/platform"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { legacyKeys } from "@/runtime/plugin/panel-keys"
import { globalStoreTarget, renamedStoreName, storeName } from "@/runtime/plugin/stores"
import { migrateKeybinds } from "@/settings/keybinds/migration"
import contextSetup from "../../gui-plugins/src/context/renderer"
import review from "../../gui-plugins/src/review/index"
import updater from "../../gui-plugins/src/updater/index"

/** A web window: storage is the page's localStorage. */
const web: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  openDirectoryPickerDialog: async () => null,
}

const renamedDiff = { diffStyle: "unified" }

// Every key and id a built-in stored under an older name, and the home it reaches. Each row fails without its mapping.
test.each([
  {
    name: "extension.review.diff, from before the plugin rename, ahead of the store's own older homes",
    home: () =>
      imported("review", "diff", review.stores.diff, "opencode.global.dat:plugin.review.diff", [
        ["opencode.global.dat:extension.review.diff", renamedDiff],
        ["layout", { review: { diffStyle: "split" } }],
      ]),
    expected: renamedDiff,
  },
  {
    // An older home without the field holds no value, so the import reads on to the next one.
    name: "layout review.diffStyle, from the unprefixed layout when the newer one lacks it → plugin.review.diff",
    home: () =>
      imported("review", "diff", review.stores.diff, "opencode.global.dat:plugin.review.diff", [
        ["opencode.global.dat:layout", { fileTree: { opened: true } }],
        ["layout", { review: { diffStyle: "unified" } }],
      ]),
    expected: { diffStyle: "unified" },
  },
  {
    name: "Preferences releaseNotes → plugin.updater.releaseNotes",
    home: () =>
      imported(
        "updater",
        "releaseNotes",
        updater.stores.releaseNotes,
        "opencode.global.dat:plugin.updater.releaseNotes",
        [["settings.v3", { general: { releaseNotes: false } }]],
      ),
    expected: { enabled: false },
  },
  {
    name: "Preferences mobileDiffWrap → plugin.review.mobileDiff",
    home: () =>
      imported("review", "mobileDiff", review.stores.mobileDiff, "opencode.global.dat:plugin.review.mobileDiff", [
        ["settings.v3", { general: { mobileDiffWrap: false } }],
      ]),
    expected: { wrap: false },
  },
  {
    name: "What's New highlights.v1 → plugin.updater.seen",
    home: () =>
      imported("updater", "seen", updater.stores.seen, "opencode.global.dat:plugin.updater.seen", [
        ["highlights.v1", { version: "2.0.20" }],
      ]),
    expected: { version: "2.0.20" },
  },
  {
    name: "keybind summary.toggle, the details plugin's earlier id → details.toggle",
    home: () => renamed([["summary.toggle", "f7"]]),
    expected: { "details.toggle": "f7" },
  },
  {
    name: "keybind session.summary.toggle, from before plugins → details.toggle",
    home: () => renamed([["session.summary.toggle", "f8"]]),
    expected: { "details.toggle": "f8" },
  },
  {
    name: "panel key context, from before plugins → context:main",
    home: () => legacyKeys(contextPanels()).get("context"),
    expected: "context:main",
  },
])("$name", (row) => {
  expect(row.home()).toEqual(row.expected)
})

test("the import from before the plugin rename leaves the old key for builds that still read it", () => {
  imported("review", "diff", review.stores.diff, "opencode.global.dat:plugin.review.diff", [
    ["opencode.global.dat:extension.review.diff", renamedDiff],
  ])

  expect(JSON.parse(localStorage.getItem("opencode.global.dat:extension.review.diff") ?? "null")).toEqual(renamedDiff)
})

/** Opens a declared global store over storage holding only `seed`, and reads the key it now lives under. */
function imported(
  plugin: string,
  name: string,
  declaration: BuiltinStoreDeclaration,
  home: string,
  seed: readonly (readonly [string, object])[],
) {
  localStorage.clear()
  // Also forgets the persistence layer's cached copies of the new and the pre-rename key from an earlier row.
  removePersisted(Persist.global(storeName(plugin, name)), web)
  removePersisted(Persist.global(renamedStoreName(plugin, name)), web)
  seed.forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)))
  createRoot((dispose) => {
    persisted(
      globalStoreTarget(plugin, name, declaration.builtinFrom ?? declaration.from, true),
      declaration.schema,
      declaration.initial,
      web,
    )
    dispose()
  })

  return JSON.parse(localStorage.getItem(home) ?? "null")
}

/** Runs the keybind migration over these stored overrides and returns the overrides it leaves. */
function renamed(stored: readonly (readonly [string, string])[]) {
  const keybinds = new Map(stored)

  const dispose = createRoot((dispose) => {
    migrateKeybinds({
      ready: () => true,
      keybinds: {
        get: (id: string) => keybinds.get(id),
        set: (id: string, value: string) => keybinds.set(id, value),
        reset: (id: string) => keybinds.delete(id),
      },
    })

    return dispose
  })

  dispose()

  return Object.fromEntries(keybinds)
}

/** The panels the context plugin's setup contributes, as the host lists them. */
function contextPanels() {
  const panels: { plugin: string; value: BuiltinPanel }[] = []

  const fake = {
    t: (key: string) => key,
    add: (registry: { readonly id: string }, item: () => BuiltinPanel) => {
      if (registry.id === BuiltinPanel.id) panels.push({ plugin: "context", value: item() })

      return () => undefined
    },
  }

  createRoot((dispose) => {
    // SAFETY: this setup reads only `t` and `add`, and contributes its panel in the reactive form, a function returning
    // it, which `add` calls for the panel registry only.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    contextSetup(fake as unknown as Parameters<typeof contextSetup>[0])
    dispose()
  })

  return panels
}
