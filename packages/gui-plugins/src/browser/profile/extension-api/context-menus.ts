import { Schema } from "effect"
import electron, { type ContextMenuParams, type Extension, type MenuItemConstructorOptions } from "electron"
import { method, none, optional, type ApiModule, type Emit } from "./api"
import { matchesHost } from "./match-pattern"
import { tabInfo, type ExtensionTabs, type PaneTab } from "./tabs"

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
export type MenuItem = {
  readonly id: string | number
  readonly title: string
  readonly type: "normal" | "checkbox" | "radio" | "separator"
  readonly contexts: readonly string[]
  readonly parentId: string | number | undefined
  readonly checked: boolean
  readonly enabled: boolean
  readonly visible: boolean
  readonly documentUrlPatterns: readonly string[] | undefined
  readonly targetUrlPatterns: readonly string[] | undefined
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

/** Changes the properties given of one item; those left out stay. */
export function updateItem(items: readonly MenuItem[], id: string | number, properties: Properties) {
  if (!items.some((item) => item.id === id)) throw new Error(`Cannot find menu item with id ${id}.`)

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
 * `chrome.contextMenus`. Items live in main and show in a tab's right-click menu, which the pane has none of
 * otherwise; each extension's items sit under its name when it has more than one.
 */
export function createContextMenus(input: {
  tabs: ExtensionTabs
  emit: Emit
  extensions: () => readonly Extension[]
}): ApiModule {
  const menus = new Map<string, readonly MenuItem[]>()

  const change = (extension: string, next: (items: readonly MenuItem[]) => readonly MenuItem[]) => {
    menus.set(extension, next(menus.get(extension) ?? []))
  }

  const clicked = (extension: Extension, tab: PaneTab, item: MenuItem, params: ContextMenuParams) => {
    const target = menuTarget(params)
    const choice = item.type === "checkbox" || item.type === "radio"
    const active = input.tabs.activeTab(tab.window)

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

    input.emit("contextMenus.onClicked", [info, active ? tabInfo(active, true) : undefined], extension.id)
  }

  const release = input.tabs.watch((tab) => {
    const shown = (_event: Electron.Event, params: ContextMenuParams) => {
      const target = menuTarget(params)

      const template = input.extensions().flatMap((extension): MenuItemConstructorOptions[] => {
        const items = menus.get(extension.id) ?? []

        const build = (item: MenuItem): MenuItemConstructorOptions => {
          const children = shownItems(items, target, item.id)

          if (item.type === "separator") return { type: "separator" }

          if (children.length > 0)
            return { label: item.title.replaceAll("%s", target.selectionText ?? ""), submenu: children.map(build) }

          return {
            label: item.title.replaceAll("%s", target.selectionText ?? ""),
            type: item.type,
            checked: item.checked,
            enabled: item.enabled,
            click: () => clicked(extension, tab, item, params),
          }
        }

        const top = shownItems(items, target).map(build)

        return top.length <= 1 ? top : [{ label: extension.name, submenu: top }]
      })

      if (template.length > 0) electron.Menu.buildFromTemplate(template).popup({ window: tab.window })
    }

    tab.contents.on("context-menu", shown)

    return () => {
      if (!tab.contents.isDestroyed()) tab.contents.off("context-menu", shown)
    }
  })

  return {
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
        change(context.extension.id, (items) => addItem(items, properties)),
      ),
      "contextMenus.update": method(Schema.Tuple([Id, Properties]), (context, [id, properties]) =>
        change(context.extension.id, (items) => updateItem(items, id, properties)),
      ),
      "contextMenus.remove": method(Schema.Tuple([Id]), (context, [id]) =>
        change(context.extension.id, (items) => removeItem(items, id)),
      ),
      "contextMenus.removeAll": method(none, (context) => void menus.delete(context.extension.id)),
    },
    dispose: release,
  }
}
