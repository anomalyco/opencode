import { mkdir } from "node:fs/promises"
import type { BrowserWindow, Rectangle, Session } from "electron"
import type { Log, Storage } from "@opencode/plugin/gui/main"
import { createActions } from "./action"
import type { Emit } from "./api"
import { createContextMenus } from "./context-menus"
import { createCookies } from "./cookies"
import { createExtensionHost } from "./host"
import { createManifests } from "./manifest"
import { createNotifications } from "./notifications"
import { createPermissions } from "./permissions"
import { createPopups } from "./popup"
import { createStorageSync } from "./storage-sync"
import { createStubs } from "./stubs"
import { createExtensionTabs } from "./tabs"
import { createWebNavigation } from "./web-navigation"

export type ExtensionApis = Awaited<ReturnType<typeof createExtensionApis>>

/** Where modules send events: the host, once it runs. Modules exist before it, since it serves them. */
type Bus = { emit?: Emit }

/**
 * The `chrome.*` APIs the profile adds where Electron has none, for the pages and service workers of installed
 * extensions only. Call it before any extension loads, so their workers start with the APIs in place.
 */
export async function createExtensionApis(input: {
  session: Session
  partition: string
  directory: string
  storage: Storage
  log: Log
  changed: () => void
}) {
  const bus: Bus = {}
  const emit: Emit = (name, args, extension) => bus.emit?.(name, args, extension)
  const extensions = () => input.session.extensions.getAllExtensions()
  const manifest = createManifests()
  const tabs = createExtensionTabs({ emit, extensions, manifest })
  const popups = createPopups({ partition: input.partition, tabs })

  const actions = createActions({
    tabs,
    emit,
    changed: input.changed,
    open: (window, extension, url) => popups.open(window, extension, url),
    manifest,
  })

  const storageSync = createStorageSync({ storage: input.storage, emit })
  await mkdir(input.directory, { recursive: true })

  const host = await createExtensionHost({
    session: input.session,
    directory: input.directory,
    log: input.log,
    manifest,
    modules: [
      tabs.module,
      actions.module,
      createWebNavigation({ tabs, emit }),
      createContextMenus({ tabs, emit, extensions, manifest }),
      createCookies({ session: input.session, tabs, emit, extensions, manifest }),
      createPermissions({ manifest }),
      createNotifications({ emit, manifest }),
      storageSync.module,
      createStubs({ manifest }),
    ],
  })

  bus.emit = host.emit

  return {
    tabs,
    /** The toolbar button state the extensions menu shows, for extensions that have a button. */
    action: actions.view,
    /**
     * The user chose an extension in `window`'s extensions menu, whose button is at `anchor`: its popup opens there,
     * or the extension hears the click. Returns false when it has no button.
     */
    click(window: BrowserWindow, id: string, anchor: Rectangle) {
      const extension = input.session.extensions.getExtension(id)

      if (!extension) return false
      popups.anchor(window, anchor)

      return actions.click(window, extension)
    },
    forget(id: string) {
      host.forget(id)
      actions.forget(id)
    },
    /** Deletes what an extension kept in this app, as when the user removes it. */
    uninstall(id: string) {
      storageSync.remove(id)
    },
    dispose() {
      popups.close()
      host.dispose()
      tabs.dispose()
    },
  }
}
