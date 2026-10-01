import type { IconProps } from "@opencode/ui/icon"
import type { Accessor, JSX } from "solid-js"
import { Point } from "./core"
import type { SessionRef, SessionView } from "./services"

export type IconName = IconProps["name"]

export interface Command {
  /** Local id. The host publishes `${extension}.${id}`, e.g. terminal + toggle = terminal.toggle. */
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly group?: string
  /** Section of Settings > Shortcuts that lists the command. Defaults to general. */
  readonly section?: "general" | "session" | "navigation" | "model" | "terminal" | "prompt"
  readonly bind?: string
  readonly slash?: { readonly name: string; readonly arguments?: true }
  /** Keep out of the command palette. */
  readonly hidden?: true
  readonly suggested?: boolean
  /** Listed when the command palette opens without a query. */
  readonly featured?: true
  readonly enabled?: boolean
  /** CSS selector the keyboard focus must be inside for the binding to apply. Host tab shortcuts yield inside it. */
  readonly scope?: string
  /** The binding also fires while a text field has focus. */
  readonly editable?: true
  run(input?: string): void | Promise<void>
}

export interface Menu {
  /** Host menu: "session.panel" (the + before side panel tabs), "server.add", "server.row". */
  readonly menu: "session.panel" | "server.add" | "server.row"
  readonly id: string
  readonly title: string
  readonly icon?: IconName
  /** Published command id whose shortcut the item shows. */
  readonly keybind?: string
  readonly order?: number
  /** Receives the row input, e.g. a server key for "server.row". */
  readonly when?: (input: string) => boolean
  /** Shown but disabled while false. Receives the same input as `when`. */
  readonly enabled?: (input: string) => boolean
  run(input: string): void
}

export interface PanelTab {
  /** Host key is `${extension}:${id}`. */
  readonly id: string
  /** Accessible name. Also the trigger content when `label` is absent. */
  readonly title: string
  /** preview is the host's replaceable preview tab (double-click keeps it). */
  readonly label?: (state: { readonly active: boolean; readonly preview: boolean }) => JSX.Element
  /**
   * - `pinned`: listed without being opened, before every other tab, never closed or dragged.
   * - `fixed`: not draggable; compact close button.
   * - `launcher`: not draggable; the close button shows on hover or while selected.
   */
  readonly kind?: "pinned" | "fixed" | "launcher"
  /**
   * Renders before the tabs in stored order. Opening it also stores it first and leaves the preview tab open, so
   * closing it selects the first remaining tab.
   */
  readonly first?: boolean
  /** Selected when the stored selection is gone. The highest value wins, then strip order. */
  readonly fallback?: number
  /** Tabs in one group share one render that stays mounted while any member is listed. */
  readonly group?: string
  /** Struck through, e.g. a file that no longer exists. */
  readonly missing?: boolean
  /**
   * The workspace path of the file the tab shows. The host lists these as the session's open files: recent
   * files, the line selection `context.addSelection` adds, and reloads when the file changes on disk.
   */
  readonly file?: string
  /** The tab panel itself joins the tab order, for content without focusable elements. */
  readonly tabbable?: boolean
  /** Forces the panel's inner sidebar open and disables its toggle. */
  readonly sidebar?: "locked"
  /** Stable DOM ids for the trigger and the tab panel. */
  readonly dom?: { readonly tab?: string; readonly panel?: string }
}

export interface MobileView {
  readonly title: string
  readonly order: number
  /** `view` replaces the conversation; `menu` and `drawer` live behind the overflow menu. */
  readonly kind: "tab" | "menu" | "drawer"
}

export interface Panel {
  readonly id: string
  readonly region: "side" | "dock"
  /** Asks for the wider session minimum while the side region is open. Reactive. */
  readonly wide?: boolean
  /** Tabs are not restored: stored keys this panel stops listing leave the strip. */
  readonly transient?: boolean
  /** Stored tab keys from before extensions, mapped to this panel's tab ids. The host rewrites them once. */
  readonly legacy?: Readonly<Record<string, string>>
  /**
   * The canonical form of one of this panel's stored tab ids, when one tab can be stored more than one way (e.g.
   * the same file as an absolute and a relative path). The host rewrites stored ids and drops duplicates. Reactive.
   */
  normalize?(id: string, session: SessionView): string
  /** A narrow-screen view of this panel. The render sees `usePanel().placement() === "mobile"`. */
  readonly mobile?: MobileView
  /**
   * Reactive. `open` holds this extension's tab ids stored in the strip. List those that still apply,
   * plus any `pinned` tab. The host renders triggers, restore, and selection from this data.
   */
  list(session: SessionView, open: readonly string[]): readonly PanelTab[]
  render(tab: Accessor<PanelTab>, session: SessionView): JSX.Element
  /** Runs after the host removes the tab from the strip. */
  close?(tab: PanelTab, session: SessionView): void
  /**
   * Runs when the tab becomes selected. `restored` is true for the selection the side region mounts with, e.g. the
   * tab selected before a reload, and false for every later selection change.
   */
  focus?(tab: PanelTab, session: SessionView, change: { readonly restored: boolean }): void
}

export interface SettingEntry {
  /** The `data-action` of the row search reveals. An entry with the Setting's own id describes the page itself. */
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly keywords?: string
}

export interface Setting {
  /** A page's settings tab value (`/settings?tab=<id>`). */
  readonly id: string
  /** Adds a section to a host page. Omit to add a page. */
  readonly page?: "general" | "servers"
  /** Nav label of a page; search shows it as the section of every entry. */
  readonly title: string
  readonly icon?: IconName
  readonly available?: "desktop" | "mobile"
  /** Search metadata, indexed without mounting the page. */
  readonly entries?: readonly SettingEntry[]
  /** `target` is the entry search is revealing. */
  render(input: { readonly target?: string }): JSX.Element
}

export type ServerState = "stopped" | "starting" | "auth" | "ready" | "failed" | "incompatible"

export interface ServerHealth {
  readonly healthy: boolean
  readonly version?: string
  readonly incompatible?: boolean
  readonly checking?: boolean
}

/** What the host passes to an entry's settings row. */
export interface ServerRow {
  /** `${extension}:${id}`. */
  readonly key: string
  /** The latest health check; undefined until one finishes. */
  health(): ServerHealth | undefined
  /** The host status mark: a dot, a spinner, a lock, or a warning. */
  readonly Indicator: (props: {
    readonly health?: ServerHealth
    readonly connecting?: boolean
    readonly auth?: boolean
  }) => JSX.Element
  /** The default server. `available` is false where the platform keeps no default. */
  readonly default: { available(): boolean; current(): boolean; set(value: boolean): void }
  /** Runs the entry's `remove`, then closes the server's tabs and clears it as the default. */
  remove(): Promise<void>
  /** Menu "server.row" items for this server, rendered as items of the row's own menu. */
  readonly Items: () => JSX.Element
}

export interface ServerEntry {
  readonly id: string
  readonly name: string
  /** Short badge after the name, e.g. "SSH". */
  readonly label?: string
  readonly state: ServerState
  /** False keeps the entry out of the app's server list (home, routes); settings still shows it and its tabs stay. */
  readonly listed?: boolean
  readonly http?: { readonly url: string; readonly username?: string; readonly password?: string }
  /**
   * Resolves the endpoint again after the connection drops, e.g. a tunnel. Such a server is managed:
   * the host probes every new endpoint and holds prompts until the event connection is up.
   */
  reconnect?(signal: AbortSignal): Promise<{ readonly url: string; readonly password?: string }>
  /** Called before opening a server that is not ready. Resolves true once it is. */
  connect?(): Promise<boolean>
  /** Runs before the host forgets the server. */
  remove?(): Promise<void>
  /** The connection row in the server's settings. */
  row?(row: ServerRow): JSX.Element
  /**
   * Covers the routed session or draft while the entry is not ready; the route stays mounted underneath.
   * `tab` identifies the routed tab and changes when another one is routed.
   */
  cover?(input: { readonly tab: string }): JSX.Element
}

export interface Server {
  /**
   * Startup waits until every source is ready. A ready source's entries are its complete inventory: the host
   * forgets a server, and closes its tabs, only when a ready source stops listing it.
   */
  readonly ready: boolean
  /** Sources list in ascending order. */
  readonly order?: number
  /** Keys are `${extension}:${id}`. */
  readonly entries: readonly ServerEntry[]
}

export interface Link {
  readonly href: string
  /** The extension that produced the linked item, e.g. the origin of a composer comment. */
  readonly origin?: string
  /** The path is a known workspace file (e.g. a palette result), not a guess from text. */
  readonly exact?: boolean
  /** Opened by the agent rather than the user (e.g. a browser preview); must not switch the narrow-screen view. */
  readonly background?: boolean
  /** Workspace-relative directory the link was written in. */
  readonly base?: string
  readonly session?: SessionRef
}

export interface LinkHandler {
  readonly priority?: number
  match(link: Link): boolean
  open(link: Link): void
}

export interface Status {
  readonly id: string
  /** titlebar (default) places a pill in the titlebar or tabs footer; channel makes the dev channel badge a toggle. */
  readonly placement?: "titlebar" | "channel"
  readonly label: string
  /** Accessible name when it differs from the visible label. */
  readonly title?: string
  readonly icon?: IconName
  readonly busy?: boolean
  readonly pressed?: boolean
  run(): void
}

export interface SlotMap {
  readonly app: Record<string, never>
  /** Full-width strip under the shell content, above toasts. */
  readonly "shell.bottom": Record<string, never>
  /** The timeline title row. Cached timelines stay mounted while hidden; `active` is false then. */
  readonly "session.header": { readonly session: SessionView; readonly active: boolean }
  readonly "session.panel.end": { readonly session: SessionView }
  readonly "session.panel.sidebar": { readonly session: SessionView }
}

export type Slot = {
  [At in keyof SlotMap]: { readonly at: At; readonly order?: number; render(input: SlotMap[At]): JSX.Element }
}[keyof SlotMap]

export const Command = Point.define<Command>("command")
export const Menu = Point.define<Menu>("menu")
export const Panel = Point.define<Panel>("panel")
export const Setting = Point.define<Setting>("setting")
export const Server = Point.define<Server>("server")
export const Link = Point.define<LinkHandler>("link")
export const Status = Point.define<Status>("status")
export const Slot = Point.define<Slot>("slot")
export const Style = Point.define<string>("style")
