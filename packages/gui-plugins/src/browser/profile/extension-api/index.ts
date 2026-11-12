import { mkdir } from "node:fs/promises"
import type { Session } from "electron"
import type { Log, Storage } from "@opencode/plugin/gui/main"
import type { Emit } from "./api"
import { createContextMenus } from "./context-menus"
import { createExtensionHost } from "./host"
import { createNotifications } from "./notifications"
import { createPermissions } from "./permissions"
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
  directory: string
  storage: Storage
  log: Log
}) {
  const bus: Bus = {}
  const emit: Emit = (name, args, extension) => bus.emit?.(name, args, extension)
  const extensions = () => input.session.extensions.getAllExtensions()
  const tabs = createExtensionTabs({ emit, extensions })

  await mkdir(input.directory, { recursive: true })

  const host = await createExtensionHost({
    session: input.session,
    directory: input.directory,
    log: input.log,
    modules: [
      tabs.module,
      createWebNavigation({ tabs, emit }),
      createContextMenus({ tabs, emit, extensions }),
      createPermissions(),
      createNotifications({ emit }),
      createStorageSync({ storage: input.storage, emit }),
      createStubs(),
    ],
  })

  bus.emit = host.emit

  return {
    tabs,
    forget(id: string) {
      host.forget(id)
    },
    dispose() {
      host.dispose()
    },
  }
}
