import { Schema } from "effect"
import { extensionLabel } from "./label"
import type { ContextMenuParams, Extension, MenuItemConstructorOptions } from "electron"
import type { Storage } from "@opencode/plugin/gui/main"
import { method, none, optional, type ApiModule, type Emit } from "./api"
import { matchesHost } from "./match-pattern"
import type { Manifests } from "./manifest"
import { privateFile, reveals, tabInfo, type ExtensionTabs, type PaneTab } from "./tabs"

const Id = Schema.Union([Schema.String, Schema.Number])

const Properties = Schema.Struct({
  id: optional(Id),
  title: optional(Schema.String),
  type: optional(Schema.Literals(["normal", "checkbox", "radio", "separator"])),
  contexts: optional(Schema.Array(Schema.String)),
  parentId: optional(Id),
  checked: optional(Schema.Boolean),
  enabled: optional(Schema.Boolean),
  visible: optional(Schema.Boolean),
  documentUrlPatterns: optional(Schema.Array(Schema.String)),
  targetUrlPatterns: optional(Schema.Array(Schema.String)),
})

type Properties = typeof Properties.Type

/** One item an extension added, by its id. Patterns limit it to pages and links that match them. */
const MenuItem = Schema.Struct({
  id: Id, title: Schema.String, type: Schema.Literals(["normal", "checkbox", "radio", "separator"]),
  contexts: Schema.Array(Schema.String), parentId: Schema.optional(Id), checked: Schema.Boolean,
  enabled: Schema.Boolean, visible: Schema.Boolean, documentUrlPatterns: Schema.optional(Schema.Array(Schema.String)),
  targetUrlPatterns: Schema.optional(Schema.Array(Schema.String)),
})

export type MenuItem = typeof MenuItem.Type

export const MenuArchive = Schema.Struct({ version: Schema.String, items: Schema.Array(MenuItem).check(Schema.isMaxLength(256)) })

/** A worker may stop between any two events. Its definitions belong to the installed version, not the worker. */
export function restoredMenus(archive: typeof MenuArchive.Type, version: string) {
  return archive.version === version ? archive.items : []
}

/** What was right-clicked, as the context names `contextMenus` items match. */
export type MenuTarget = {
  readonly contexts: readonly string[]
  readonly pageUrl: string
  readonly linkUrl: string | undefined
  readonly srcUrl: string | undefined
  readonly selectionText: string | undefined
}

/** Adds an item, or reports why it cannot: an id in use or a parent that does not exist. */
export function addItem(items: readonly MenuItem[], properties: Properties): readonly MenuItem[] {
  const id = properties.id ?? ""

  if (items.some((item) => item.id === id)) throw new Error(`Cannot create item with duplicate id ${id}.`)

  if (properties.parentId != null && !items.some((item) => item.id === properties.parentId))
    throw new Error(`Cannot find menu item with id ${properties.parentId}.`)

  return [
    ...items,
    {
      id,
      title: properties.title ?? "",
      type: properties.type ?? "normal",
      contexts: properties.contexts ?? ["page"],
      parentId: properties.parentId ?? undefined,
      checked: properties.checked ?? false,
      enabled: properties.enabled ?? true,
      visible: properties.visible ?? true,
      documentUrlPatterns: properties.documentUrlPatterns ?? undefined,
      targetUrlPatterns: properties.targetUrlPatterns ?? undefined,
    },
  ]
}

/** Changes the properties given of one item; those left out stay. A new parent must exist and not sit under it. */
export function updateItem(items: readonly MenuItem[], id: string | number, properties: Properties) {
  if (!items.some((item) => item.id === id)) throw new Error(`Cannot find menu item with id ${id}.`)
  const parent = properties.parentId

  if (parent != null && !items.some((item) => item.id === parent))
    throw new Error(`Cannot find menu item with id ${parent}.`)

  if (parent != null && ancestors(items, parent).includes(id))
    throw new Error(`Cannot make menu item ${id} a descendant of itself.`)

  return items.map(
    (item): MenuItem =>
      item.id !== id
        ? item
        : {
            id: item.id,
            title: properties.title ?? item.title,
            type: properties.type ?? item.type,
            contexts: properties.contexts ?? item.contexts,
            parentId: properties.parentId ?? item.parentId,
            checked: properties.checked ?? item.checked,
            enabled: properties.enabled ?? item.enabled,
            visible: properties.visible ?? item.visible,
            documentUrlPatterns: properties.documentUrlPatterns ?? item.documentUrlPatterns,
            targetUrlPatterns: properties.targetUrlPatterns ?? item.targetUrlPatterns,
          },
  )
}

/** An item and every item above it, nearest first; items only ever form a tree, so the walk ends. */
function ancestors(items: readonly MenuItem[], id: string | number): readonly (string | number)[] {
  const parent = items.find((item) => item.id === id)?.parentId

  return parent === undefined ? [id] : [id, ...ancestors(items, parent)]
}

/**
 * The items after the user chose `chosen`: a checkbox flips, and a radio item turns on while the other radio items
 * beside it turn off, as Chrome keeps them.
 */
export function chooseItem(items: readonly MenuItem[], chosen: MenuItem): readonly MenuItem[] {
  if (chosen.type === "checkbox")
    return items.map((item) => (item.id === chosen.id ? { ...item, checked: !item.checked } : item))

  if (chosen.type !== "radio") return items

  return items.map((item) =>
    item.type === "radio" && item.parentId === chosen.parentId ? { ...item, checked: item.id === chosen.id } : item,
  )
}

/** Removes an item and the items under it. */
export function removeItem(items: readonly MenuItem[], id: string | number): readonly MenuItem[] {
  const children = items.filter((item) => item.parentId === id)

  return children.reduce<readonly MenuItem[]>(
    (rest, child) => removeItem(rest, child.id),
    items.filter((item) => item.id !== id),
  )
}

/** The items to show for a target under `parentId`, in the order the extension created them. */
export function shownItems(items: readonly MenuItem[], target: MenuTarget, parentId?: string | number) {
  return items.filter(
    (item) =>
      item.parentId === parentId &&
      item.visible &&
      (parentId !== undefined ||
        item.contexts.some((context) => context === "all" || target.contexts.includes(context))) &&
      (!item.documentUrlPatterns || matchesHost(item.documentUrlPatterns, target.pageUrl)) &&
      (!item.targetUrlPatterns ||
        [target.linkUrl, target.srcUrl].some((url) => !!url && matchesHost(item.targetUrlPatterns ?? [], url))),
  )
}

/** The contexts of a right-click, from Electron's parameters. */
export function menuTarget(
  params: Pick<
    ContextMenuParams,
    "linkURL" | "srcURL" | "mediaType" | "isEditable" | "selectionText" | "pageURL" | "frameURL"
  >,
): MenuTarget {
  const media = ["image", "video", "audio"].includes(params.mediaType) ? [params.mediaType] : []

  const contexts = [
    ...(params.linkURL ? ["link"] : []),
    ...(params.selectionText ? ["selection"] : []),
    ...(params.isEditable ? ["editable"] : []),
    ...media,
    ...(params.frameURL ? ["frame"] : []),
  ]

  return {
    contexts: contexts.length > 0 ? contexts : ["page"],
    pageUrl: params.pageURL,
    linkUrl: params.linkURL || undefined,
    srcUrl: params.srcURL || undefined,
    selectionText: params.selectionText || undefined,
  }
}

/**
 * `chrome.contextMenus` contributes to the pane's native menu. Each extension's items sit under its name when
 * it has more than one; the extension API never sees built-in items or a local preview's context.
 */
export function createContextMenus(input: {
  tabs: ExtensionTabs
  emit: Emit
  extensions: () => readonly Extension[]
  manifest: Manifests
  storage: Storage
}) {
  const store = (id: string) => input.storage.store(`extension-menus.${id}`, { schema: MenuArchive, initial: { version: "", items: [] } })

  const change = (extension: Extension, next: (items: readonly MenuItem[]) => readonly MenuItem[]) => {
    const saved = store(extension.id)
    const current = restoredMenus(saved.value, extension.version)
    const items = next(current)

    if (current === items) return

    if (items.length > 256 || Buffer.byteLength(JSON.stringify(items)) > 256 * 1024) throw new Error("Context menu storage limit exceeded.")
    saved.set({ version: extension.version, items })
  }

  const clicked = (extension: Extension, tab: PaneTab, item: MenuItem, params: ContextMenuParams) => {
    const target = menuTarget(params)
    const choice = item.type === "checkbox" || item.type === "radio"
    // The tab that was right-clicked, with its address only for an extension that may read it.
    const snapshot = input.tabs.snapshot(tab.contents.id)
    change(extension, (items) => chooseItem(items, item))

    const info = {
      menuItemId: item.id,
      parentMenuItemId: item.parentId,
      pageUrl: target.pageUrl,
      frameId: 0,
      editable: params.isEditable,
      linkUrl: target.linkUrl,
      srcUrl: target.srcUrl,
      mediaType: target.srcUrl ? params.mediaType : undefined,
      selectionText: target.selectionText,
      wasChecked: choice ? item.checked : undefined,
      checked: choice ? item.type === "radio" || !item.checked : undefined,
    }

    input.emit(
      "contextMenus.onClicked",
      [info, snapshot ? tabInfo(snapshot, reveals(input.manifest(extension), snapshot.url)) : undefined],
      extension.id,
    )
  }

  const template = (id: number, params: ContextMenuParams) => {
      const tab = input.tabs.get(id)

      if (!tab || [params.pageURL, params.frameURL, params.linkURL, params.srcURL].some(privateFile)) return []
      const target = menuTarget(params)

      return input.extensions().flatMap((extension): MenuItemConstructorOptions[] => {
        if (!input.manifest(extension).permissions.includes("contextMenus")) return []
        const items = restoredMenus(store(extension.id).value, extension.version)

        const build = (item: MenuItem): MenuItemConstructorOptions => {
          const children = shownItems(items, target, item.id)

          if (item.type === "separator") return { type: "separator" }
          const label = extensionLabel(extensionLabel(item.title).replaceAll("%s", () => extensionLabel(target.selectionText ?? ""))).replaceAll("&", "&&")

          if (children.length > 0)
            return { label, submenu: children.map(build) }

          return {
            label,
            type: item.type,
            checked: item.checked,
            enabled: item.enabled,
            click: () => clicked(extension, tab, item, params),
          }
        }

        const top = shownItems(items, target).map(build)

        return top.length ? [{ label: extensionLabel(extension.name).replaceAll("&", "&&") || extension.id, submenu: top }] : []
      })

  }

  const module: ApiModule = {
    namespaces: [
      {
        path: "contextMenus",
        permissions: ["contextMenus"],
        methods: ["create", "update", "remove", "removeAll"],
        events: ["onClicked"],
        sync: ["create"],
        constants: {
          ACTION_MENU_TOP_LEVEL_LIMIT: 6,
          ContextType: {
            ALL: "all",
            PAGE: "page",
            FRAME: "frame",
            SELECTION: "selection",
            LINK: "link",
            EDITABLE: "editable",
            IMAGE: "image",
            VIDEO: "video",
            AUDIO: "audio",
            LAUNCHER: "launcher",
            BROWSER_ACTION: "browser_action",
            PAGE_ACTION: "page_action",
            ACTION: "action",
          },
          ItemType: { NORMAL: "normal", CHECKBOX: "checkbox", RADIO: "radio", SEPARATOR: "separator" },
        },
      },
    ],
    methods: {
      "contextMenus.create": method(Schema.Tuple([Properties]), (context, [properties]) =>
        change(context.extension, (items) => addItem(items, properties)),
      ),
      "contextMenus.update": method(Schema.Tuple([Id, Properties]), (context, [id, properties]) =>
        change(context.extension, (items) => updateItem(items, id, properties)),
      ),
      "contextMenus.remove": method(Schema.Tuple([Id]), (context, [id]) =>
        change(context.extension, (items) => removeItem(items, id)),
      ),
      "contextMenus.removeAll": method(none, (context) => change(context.extension, () => [])),
    },
  }

  return {
    module,
    template,
    remove: (id: string) => input.storage.remove(`extension-menus.${id}`),
    // Reinstalling even the same version runs onInstalled again. Let it register the same IDs; a failed swap
    // must return the previous extension's approved menu tree along with its files.
    reset(id: string) {
      const saved = store(id)
      const previous = saved.value
      saved.set({ version: "", items: [] })

      return () => saved.set(previous)
    },
  }
}
