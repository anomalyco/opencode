import { readFile } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"
import electron, { type BrowserWindow, type Extension } from "electron"
import { method, none, optional, type ApiModule, type ApiNamespace, type Emit, type ExtensionContext } from "./api"
import { tabInfo, type ExtensionTabs } from "./tabs"

/** What an extension set on its toolbar button: for every tab, or for one tab over that. */
export type ActionValues = {
  readonly title?: string
  readonly popup?: string
  readonly badgeText?: string
  readonly badgeColor?: string
  readonly badgeTextColor?: string
  readonly icon?: string
  readonly enabled?: boolean
}

export type ActionState = { readonly all: ActionValues; readonly tabs: ReadonlyMap<number, ActionValues> }

export const initialAction: ActionState = { all: {}, tabs: new Map() }

/** Sets values for every tab, or for `tab` alone. */
export function setAction(state: ActionState, values: ActionValues, tab?: number | null): ActionState {
  if (tab == null) return { ...state, all: { ...state.all, ...values } }

  return { ...state, tabs: new Map(state.tabs).set(tab, { ...state.tabs.get(tab), ...values }) }
}

/** The values a tab shows: its own over those for every tab. */
export function actionFor(state: ActionState, tab?: number | null): ActionValues {
  return { ...state.all, ...(tab == null ? undefined : state.tabs.get(tab)) }
}

/** A badge color as CSS, from a CSS color string or an RGBA array of 0-255. */
export function badgeColor(color: string | readonly number[]) {
  if (Schema.is(Schema.String)(color)) return color
  const [red = 0, green = 0, blue = 0, alpha = 255] = color

  return `rgba(${red}, ${green}, ${blue}, ${Math.round((alpha / 255) * 100) / 100})`
}

const Tab = Schema.Struct({ tabId: optional(Schema.Number) })

const Color = Schema.Union([Schema.String, Schema.Array(Schema.Number)])

const Pixels = Schema.Struct({ width: Schema.Number, height: Schema.Number, data: Schema.Uint8Array })

const Sizes = <S extends Schema.Top>(schema: S) => Schema.Union([schema, Schema.Record(Schema.String, schema)])

const Icon = Schema.Struct({
  tabId: optional(Schema.Number),
  path: optional(Sizes(Schema.String)),
  imageData: optional(Sizes(Pixels)),
})

const ManifestAction = Schema.Struct({
  default_title: Schema.optional(Schema.String),
  default_popup: Schema.optional(Schema.String),
})

const ActionManifest = Schema.Struct({
  action: Schema.optional(ManifestAction),
  browser_action: Schema.optional(ManifestAction),
  page_action: Schema.optional(ManifestAction),
})

const MEMBERS = [
  "setTitle",
  "getTitle",
  "setIcon",
  "setPopup",
  "getPopup",
  "setBadgeText",
  "getBadgeText",
  "setBadgeBackgroundColor",
  "getBadgeBackgroundColor",
  "setBadgeTextColor",
  "getBadgeTextColor",
  "enable",
  "disable",
  "isEnabled",
  "getUserSettings",
  "openPopup",
]

/** The size closest to 32px of an icon given in several, by size. */
function closest<T>(sizes: Readonly<Record<string, T>>) {
  return Object.entries(sizes).toSorted((a, b) => Math.abs(Number(a[0]) - 32) - Math.abs(Number(b[0]) - 32))[0]?.[1]
}

export type ExtensionActions = ReturnType<typeof createActions>

/**
 * `chrome.action`, and `browserAction` and `pageAction` for Manifest V2: the button each extension has in the pane's
 * extensions menu, with its title, icon and badge, and the popup it opens. A click opens the popup, or tells the
 * extension through `onClicked` when it has none.
 */
export function createActions(input: {
  tabs: ExtensionTabs
  emit: Emit
  changed: () => void
  open: (window: BrowserWindow, url: string) => void
}) {
  const states = new Map<string, ActionState>()

  const defaults = (extension: Pick<Extension, "manifest">) => {
    const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(ActionManifest)(extension.manifest))

    return manifest?.action ?? manifest?.browser_action ?? manifest?.page_action
  }

  const stateOf = (extension: Pick<Extension, "id" | "manifest">) => {
    const known = states.get(extension.id)

    if (known) return known
    const manifest = defaults(extension)

    return setAction(initialAction, {
      title: manifest?.default_title,
      popup: manifest?.default_popup,
      enabled: true,
    })
  }

  const update = (context: ExtensionContext, values: ActionValues, tab?: number | null) => {
    states.set(context.extension.id, setAction(stateOf(context.extension), values, tab))
    input.changed()
  }

  const read = (context: ExtensionContext, tab?: number | null) => actionFor(stateOf(context.extension), tab)

  const popupURL = (extension: string, popup: string | undefined) =>
    popup ? new URL(popup.replace(/^\//, ""), `chrome-extension://${extension}/`).href : undefined

  const icon = async (context: ExtensionContext, value: typeof Icon.Type) => {
    if (value.imageData) {
      const pixels = Schema.is(Pixels)(value.imageData) ? value.imageData : closest(value.imageData)

      if (!pixels) return undefined
      // Chromium's bitmaps are BGRA; ImageData is RGBA.
      const data = Buffer.from(pixels.data)

      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 0
        data[index] = data[index + 2] ?? 0
        data[index + 2] = red
      }

      return electron.nativeImage.createFromBitmap(data, { width: pixels.width, height: pixels.height }).toDataURL()
    }

    const file = value.path == null || Schema.is(Schema.String)(value.path) ? value.path : closest(value.path)

    if (!file) return undefined
    const root = path.resolve(context.extension.path)
    const target = path.resolve(root, file.replace(/^\//, ""))

    if (!target.startsWith(root + path.sep)) return undefined
    const bytes = await readFile(target).catch(() => undefined)

    return bytes && bytes.byteLength <= 65_536 ? electron.nativeImage.createFromBuffer(bytes).toDataURL() : undefined
  }

  const methods = (namespace: string) => ({
    [`${namespace}.setTitle`]: method(
      Schema.Tuple([Schema.Struct({ title: Schema.String, tabId: optional(Schema.Number) })]),
      (context, [details]) => update(context, { title: details.title }, details.tabId),
    ),
    [`${namespace}.getTitle`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      read(context, details?.tabId).title ?? context.extension.name,
    ),
    [`${namespace}.setIcon`]: method(Schema.Tuple([Icon]), async (context, [details]) => {
      const value = await icon(context, details)

      if (value) update(context, { icon: value }, details.tabId)
    }),
    [`${namespace}.setPopup`]: method(
      Schema.Tuple([Schema.Struct({ popup: Schema.String, tabId: optional(Schema.Number) })]),
      (context, [details]) => update(context, { popup: details.popup }, details.tabId),
    ),
    [`${namespace}.getPopup`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      popupURL(context.extension.id, read(context, details?.tabId).popup) ?? "",
    ),
    [`${namespace}.setBadgeText`]: method(
      Schema.Tuple([Schema.Struct({ text: optional(Schema.String), tabId: optional(Schema.Number) })]),
      (context, [details]) => update(context, { badgeText: details.text ?? "" }, details.tabId),
    ),
    [`${namespace}.getBadgeText`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      read(context, details?.tabId).badgeText ?? "",
    ),
    [`${namespace}.setBadgeBackgroundColor`]: method(
      Schema.Tuple([Schema.Struct({ color: Color, tabId: optional(Schema.Number) })]),
      (context, [details]) => update(context, { badgeColor: badgeColor(details.color) }, details.tabId),
    ),
    [`${namespace}.getBadgeBackgroundColor`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      read(context, details?.tabId).badgeColor ?? "rgba(0, 0, 0, 0)",
    ),
    [`${namespace}.setBadgeTextColor`]: method(
      Schema.Tuple([Schema.Struct({ color: Color, tabId: optional(Schema.Number) })]),
      (context, [details]) => update(context, { badgeTextColor: badgeColor(details.color) }, details.tabId),
    ),
    [`${namespace}.getBadgeTextColor`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      read(context, details?.tabId).badgeTextColor ?? "#ffffff",
    ),
    [`${namespace}.enable`]: method(Schema.Tuple([optional(Schema.Number)]), (context, [tab]) =>
      update(context, { enabled: true }, tab),
    ),
    [`${namespace}.disable`]: method(Schema.Tuple([optional(Schema.Number)]), (context, [tab]) =>
      update(context, { enabled: false }, tab),
    ),
    [`${namespace}.show`]: method(Schema.Tuple([optional(Schema.Number)]), (context, [tab]) =>
      update(context, { enabled: true }, tab),
    ),
    [`${namespace}.hide`]: method(Schema.Tuple([optional(Schema.Number)]), (context, [tab]) =>
      update(context, { enabled: false }, tab),
    ),
    [`${namespace}.isEnabled`]: method(Schema.Tuple([optional(Schema.Number)]), (context, [tab]) =>
      read(context, tab).enabled !== false,
    ),
    [`${namespace}.getUserSettings`]: method(none, () => ({ isOnToolbar: true })),
    [`${namespace}.openPopup`]: method(none, (context) => {
      const window = input.tabs.lastWindow()
      const url = popupURL(context.extension.id, read(context, window ? input.tabs.activeTab(window)?.id : undefined).popup)

      if (!window || !url) throw new Error("This extension has no popup to open.")
      input.open(window, url)
    }),
  })

  const namespace = (path: string, manifest: 2 | 3, members: readonly string[]): ApiNamespace => ({
    path,
    manifest,
    methods: members,
    events: ["onClicked", "onUserSettingsChanged"],
  })

  const module: ApiModule = {
    namespaces: [
      namespace("action", 3, MEMBERS),
      namespace("browserAction", 2, MEMBERS),
      namespace("pageAction", 2, ["setTitle", "getTitle", "setIcon", "setPopup", "getPopup", "show", "hide"]),
    ],
    methods: { ...methods("action"), ...methods("browserAction"), ...methods("pageAction") },
  }

  return {
    module,
    /** What the extensions menu shows for an extension: its values for the active tab of the last window. */
    view(extension: Pick<Extension, "id" | "manifest">) {
      if (!defaults(extension)) return undefined
      const window = input.tabs.lastWindow()
      const values = actionFor(stateOf(extension), window ? input.tabs.activeTab(window)?.id : undefined)

      return {
        title: values.title,
        icon: values.icon,
        badge: values.badgeText || undefined,
        badgeColor: values.badgeColor,
        badgeTextColor: values.badgeTextColor,
        enabled: values.enabled !== false,
      }
    },
    /**
     * The user chose the extension in `window`'s menu: its popup opens over the window, or the extension hears the
     * click. Returns whether it had a button to click.
     */
    click(window: BrowserWindow, extension: Extension) {
      if (!defaults(extension)) return false
      const tab = input.tabs.activeTab(window)
      const values = actionFor(stateOf(extension), tab?.id)

      if (values.enabled === false) return true
      const url = popupURL(extension.id, values.popup)

      if (url) {
        input.open(window, url)

        return true
      }

      const manifest = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ manifest_version: Schema.Number }))(extension.manifest),
      )

      const name = manifest?.manifest_version === 2 ? "browserAction" : "action"
      input.emit(`${name}.onClicked`, [tab ? tabInfo(tab, true) : undefined], extension.id)

      return true
    },
    forget(extension: string) {
      states.delete(extension)
    },
  }
}
