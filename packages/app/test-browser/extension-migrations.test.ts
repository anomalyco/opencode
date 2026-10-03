import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { Panel, type StoreDeclaration } from "@opencode/gui-extensions/sdk"
import type { Platform } from "@/runtime/platform/platform"
import { persisted, removePersisted } from "@/runtime/persistence/storage"
import { legacyKeys } from "@/runtime/extension/panel-keys"
import { globalStoreTarget } from "@/runtime/extension/stores"
import { migrateKeybinds } from "@/settings/keybinds/migration"
import context from "../../gui-extensions/src/context/index"
import contextSetup from "../../gui-extensions/src/context/renderer"
import details from "../../gui-extensions/src/details/index"
import review from "../../gui-extensions/src/review/index"
import updater from "../../gui-extensions/src/updater/index"

/** A web window: storage is the page's localStorage. */
const web: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  openDirectoryPickerDialog: async () => null,
}

// Every key and id a built-in stored under an older name, and the home it reaches. Each row fails without its mapping.
test.each([
  {
    name: "namespace extension.summary.* → extension.details.*",
    home: () =>
      imported("details", "prefs", details.stores.prefs, "opencode.global.dat:extension.details.prefs", [
        ["opencode.global.dat:extension.summary.prefs", { projectExpanded: false, serverExpanded: false }],
      ]),
    expected: { projectExpanded: false, serverExpanded: false },
  },
  {
    name: "settings sessionSummary, from before extensions → extension.details.prefs",
    home: () =>
      imported("details", "prefs", details.stores.prefs, "opencode.global.dat:extension.details.prefs", [
        ["settings.v3", { sessionSummary: { projectExpanded: false, serverExpanded: true } }],
      ]),
    expected: { projectExpanded: false, serverExpanded: true },
  },
  {
    name: "Preferences releaseNotes → extension.updater.releaseNotes",
    home: () =>
      imported(
        "updater",
        "releaseNotes",
        updater.stores.releaseNotes,
        "opencode.global.dat:extension.updater.releaseNotes",
        [["settings.v3", { general: { releaseNotes: false } }]],
      ),
    expected: { enabled: false },
  },
  {
    name: "Preferences mobileDiffWrap → extension.review.mobileDiff",
    home: () =>
      imported("review", "mobileDiff", review.stores.mobileDiff, "opencode.global.dat:extension.review.mobileDiff", [
        ["settings.v3", { general: { mobileDiffWrap: false } }],
      ]),
    expected: { wrap: false },
  },
  {
    name: "What's New highlights.v1 → extension.updater.seen",
    home: () =>
      imported("updater", "seen", updater.stores.seen, "opencode.global.dat:extension.updater.seen", [
        ["highlights.v1", { version: "2.0.20" }],
      ]),
    expected: { version: "2.0.20" },
  },
  {
    name: "keybind summary.toggle → details.toggle",
    home: () => renamed([["summary.toggle", "f9"]]),
    expected: { "details.toggle": "f9" },
  },
  {
    name: "keybind session.summary.toggle, from before extensions → details.toggle",
    home: () => renamed([["session.summary.toggle", "f8"]]),
    expected: { "details.toggle": "f8" },
  },
  {
    name: "panel key usage:context → context:main",
    home: () => legacyKeys(contextPanels()).get("usage:context"),
    expected: "context:main",
  },
  {
    name: "panel key context, from before extensions → context:main",
    home: () => legacyKeys(contextPanels()).get("context"),
    expected: "context:main",
  },
])("$name", (row) => {
  expect(row.home()).toEqual(row.expected)
})

/** Opens a declared global store over storage holding only `seed`, and reads the key it now lives under. */
function imported(
  extension: string,
  name: string,
  declaration: StoreDeclaration,
  home: string,
  seed: readonly (readonly [string, object])[],
) {
  localStorage.clear()
  // Also forgets the persistence layer's cached copy of the new key from an earlier row.
  removePersisted(globalStoreTarget(extension, name, undefined), web)
  seed.forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)))
  createRoot((dispose) => {
    persisted(globalStoreTarget(extension, name, declaration.from), declaration.schema, declaration.initial, web)
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

/** The panels the context extension's setup contributes, as the host lists them. */
function contextPanels() {
  const panels: { extension: string; value: Panel }[] = []

  const fake = {
    t: (key: string) => key,
    add: (point: { readonly id: string }, item: () => Panel) => {
      if (point.id === Panel.id) panels.push({ extension: context.id, value: item() })

      return () => undefined
    },
  }

  createRoot((dispose) => {
    // SAFETY: this setup reads only `t` and `add`, and contributes its Panel in the reactive form, a function returning
    // it, which `add` calls for the Panel point only.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    contextSetup(fake as unknown as Parameters<typeof contextSetup>[0])
    dispose()
  })

  return panels
}
