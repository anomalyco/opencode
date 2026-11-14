import { Schema } from "effect"
import electron, { type BrowserWindow, type Extension } from "electron"
import { closestIcon, extensionPage, readIcon } from "../extensions"
import { method, none, optional, type ApiModule, type ApiNamespace, type Emit, type ExtensionContext } from "./api"
import type { Manifests } from "./manifest"
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

/** Where each byte of a BGRA pixel reads from in RGBA: red and blue trade places. */
const SWAP = [2, 0, -2, 0] as const

/** A toolbar icon's bitmap; Chrome draws them at most 38px, so 128 is generous. */
const Side = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }))

const Pixels = Schema.Struct({ width: Side, height: Side, data: Schema.Uint8Array })

const Sizes = <S extends Schema.Top>(schema: S) => Schema.Union([schema, Schema.Record(Schema.String, schema)])

const Icon = Schema.Struct({
  tabId: optional(Schema.Number),
  path: optional(Sizes(Schema.String)),
  imageData: optional(Sizes(Pixels)),
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

/**
 * `chrome.action`, and `browserAction` and `pageAction` for Manifest V2: the button each extension has in the pane's
 * extensions menu, with its title, icon and badge, and the popup it opens. A click opens the popup, or tells the
 * extension through `onClicked` when it has none.
 */
export function createActions(input: {
  tabs: ExtensionTabs
  emit: Emit
  changed: () => void
  open: (window: BrowserWindow, extension: string, url: string) => void
  manifest: Manifests
}) {
  const states = new Map<string, ActionState>()

  const defaults = (extension: Extension) => input.manifest(extension).action

  const stateOf = (extension: Extension) => {
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

  const icon = async (context: ExtensionContext, value: typeof Icon.Type) => {
    if (value.imageData) {
      const pixels = Schema.is(Pixels)(value.imageData) ? value.imageData : closestIcon(value.imageData)

      // A bitmap is exactly its width times its height in 4-byte pixels; anything else is refused.
      if (!pixels || pixels.data.byteLength !== pixels.width * pixels.height * 4) return undefined
      // Chromium's bitmaps are BGRA; ImageData is RGBA.
      const source = pixels.data

      const data = Buffer.from(
        source.map((byte, index) =>
          source[index + (SWAP[index % 4] ?? 0)] ?? byte,
        ),
      )

      return electron.nativeImage.createFromBitmap(data, { width: pixels.width, height: pixels.height }).toDataURL()
    }

    const file = value.path == null || Schema.is(Schema.String)(value.path) ? value.path : closestIcon(value.path)
    const bytes = file ? await readIcon(context.extension.path, file) : undefined

    return bytes ? electron.nativeImage.createFromBuffer(bytes).toDataURL() : undefined
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
      (context, [details]) => {
        if (details.popup && !extensionPage(context.extension.id, details.popup))
          throw new Error("The popup must be a page of this extension.")
        update(context, { popup: details.popup }, details.tabId)
      },
    ),
    [`${namespace}.getPopup`]: method(Schema.Tuple([optional(Tab)]), (context, [details]) =>
      extensionPage(context.extension.id, read(context, details?.tabId).popup) ?? "",
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
    // A popup opens only from the user's click, so an extension cannot put a page over the app on its own.
    [`${namespace}.openPopup`]: method(none, () => {
      throw new Error("A popup opens only when the user clicks the extension.")
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
    view(extension: Extension) {
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
      const url = extensionPage(extension.id, values.popup)

      if (url) {
        input.open(window, extension.id, url)

        return true
      }

      const name = input.manifest(extension).version === 2 ? "browserAction" : "action"
      input.emit(`${name}.onClicked`, [tab ? tabInfo(tab, true) : undefined], extension.id)

      return true
    },
    forget(extension: string) {
      states.delete(extension)
    },
  }
}
