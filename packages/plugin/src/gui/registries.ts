import type { JSX } from "solid-js"
import type { IconName } from "./icon-name.js"
import { Registry } from "./core.js"
import type { SessionRef, MountedSession, SessionScreen } from "./host-apis.js"

/** The name of a shared icon; derived from the dependency-free UI artwork catalog, not a component's props. */
export type { IconName }

/**
 * A command in the palette, with an optional keybind and slash command. The host publishes it as
 * `${plugin}.${id}`. Read the title from a getter so it follows the locale.
 */
export interface Command {
  /** Local id. The host publishes `${plugin}.${id}`, e.g. terminal + toggle = terminal.toggle. */
  readonly id: string
  /** The palette label. */
  readonly title: string
  /** The palette's second line. */
  readonly description?: string
  /** Extra words the palette matches, separated by spaces, e.g. "dev bar" for the debug bar. */
  readonly keywords?: string
  /** The palette category the command is listed under; translated text. */
  readonly group?: string
  /**
   * Section of Settings > Shortcuts that lists the command. Defaults to `general`.
   * - `general`: app-wide commands.
   * - `session`: commands on the current session.
   * - `navigation`: moving between views and tabs.
   * - `model`: model and agent choice.
   * - `terminal`: the terminal.
   * - `prompt`: the composer.
   */
  readonly section?: "general" | "session" | "navigation" | "model" | "terminal" | "prompt"
  /** The default keybind, e.g. `mod+shift+t`. The user can change it in Settings > Shortcuts. */
  readonly bind?: string
  /** Also offers the command as a composer slash command. */
  readonly slash?: {
    /** The name after the slash, e.g. `open` for `/open`. */
    readonly name: string
    /** The text after the name is passed to `run`. */
    readonly arguments?: true
    /** Lists this entry right after the slash entry with this name, e.g. "open", when one is present. */
    readonly after?: string
  }
  /** Keep out of the command palette; the keybind still works. */
  readonly hidden?: true
  /** Also listed under the palette's Suggested category while it is enabled. */
  readonly suggested?: boolean
  /** Listed when the command palette opens without a query. */
  readonly featured?: true
  /** False takes the command out of the palette and turns its keybind off. Defaults to true. Reactive. */
  readonly enabled?: boolean
  /** CSS selector the keyboard focus must be inside for the binding to apply. Host tab shortcuts yield inside it. */
  readonly scope?: string
  /**
   * The binding also fires while a text field has focus. Without it, a binding with no Ctrl, Cmd or Alt key yields to
   * the text field.
   */
  readonly editable?: true
  /**
   * Runs the command from the palette, the keybind or the slash command. From the keybind, return `false`
   * synchronously to decline the key: the event goes on to its target, as if the command had no keybind, e.g. Enter
   * reaches the prompt. `false` from the palette or a slash command does nothing more.
   *
   * @param input - The slash command's arguments, when `slash.arguments` is set.
   * @returns `false` to decline the key; anything else handles it.
   *
   * @example
   * ```ts
   * run: () => (ctx.screen.current()?.composer.focused() ? keepGoing() : false)
   * ```
   */
  run(input?: string): void | false | Promise<void>
}

/** The fields every `MenuItem` has, whichever menu it is in. */
interface MenuItemBase {
  /** The item's id, unique within the plugin. */
  readonly id: string
  /** The item's label. */
  readonly title: string
  /** Items list in ascending order. Defaults to 0. */
  readonly order?: number
}

/** An item of the + menu before the side panel tabs. */
export interface SessionPanelMenuItem extends MenuItemBase {
  /** The host menu: `session.panel`. */
  readonly menu: "session.panel"
  /** The item's icon. */
  readonly icon?: IconName
  /** Published command id whose shortcut the item shows. */
  readonly keybind?: string
  /** A short muted detail after the title where the item lists as a launcher row, e.g. a count. Omit it for none. */
  readonly description?: string
  /**
   * The tab the item opens is already open. Launcher lists such as the new tab page leave the item out; the + menu
   * still lists it. Omit it while the tab is closed, or for an item that always opens a new tab.
   */
  readonly opened?: boolean
  /**
   * Makes + run this item directly instead of showing the host's launcher choices. The first primary item in `order`
   * wins. Opening the side region with no tabs still shows the host's New tab view, which lists non-primary items
   * that are not already open. Omit it for an ordinary launcher item.
   */
  readonly primary?: true
  /** Runs the item. */
  run(): void
}

/** An item of the Add server menu. */
export interface ServerAddMenuItem extends MenuItemBase {
  /** The host menu: `server.add`. */
  readonly menu: "server.add"
  /** Runs the item. */
  run(): void
}

/** An item of the menu of each server row in Settings. */
export interface ServerRowMenuItem extends MenuItemBase {
  /** The host menu: `server.row`. */
  readonly menu: "server.row"
  /**
   * Lists the item only for rows where it returns true. Omit it to list the item on every row.
   *
   * @param server - The row's server key.
   */
  readonly when?: (server: string) => boolean
  /**
   * Shows the item disabled while it returns false. Omit it to keep the item enabled.
   *
   * @param server - The row's server key.
   */
  readonly enabled?: (server: string) => boolean
  /**
   * Runs the item.
   *
   * @param server - The row's server key.
   */
  run(server: string): void
}

/**
 * An item of a host menu, by `menu`. Each menu takes only its own fields, so a field the menu ignores fails to compile.
 * - `session.panel`: the + menu before the side panel tabs; shows `icon`, `keybind` and `description`, `primary`
 *   makes the item the new tab action, and launcher lists skip `opened` items. `Layout.side.menu` lists the items for a launcher of your own.
 * - `server.add`: the Add server menu.
 * - `server.row`: the menu of each server row in Settings; `when` and `enabled` filter it per row, and `run` receives
 *   the row's server key.
 */
export type MenuItem = SessionPanelMenuItem | ServerAddMenuItem | ServerRowMenuItem

/**
 * A tab a side `Panel` lists in the session's strip. Return the same object while it is unchanged, also across a
 * session switch where the tab stays: a new object renders its `label` again.
 */
export interface PanelTab {
  /** Host key is `${plugin}:${id}`. */
  readonly id: string
  /** Accessible name. Also the trigger content when `label` is absent. */
  readonly title: string
  /**
   * Renders the trigger content once per label function; `state` is reactive. `active`: the tab is selected;
   * `preview`: it is the host's replaceable preview tab (double-click keeps it); `session`: the routed session.
   */
  readonly label?: (state: {
    /** The tab is selected. */
    readonly active: boolean
    /** The tab is the preview tab. */
    readonly preview: boolean
    /** The routed session the strip shows; a new object when another session is routed. */
    readonly session: MountedSession
  }) => JSX.Element
  /** Listed without being opened, before every other tab, never closed or dragged. */
  readonly pinned?: boolean
  /** The user can drag the tab to reorder it. Defaults to true. */
  readonly draggable?: boolean
  /**
   * The close button; only how it looks. Defaults to a plain one.
   * - `compact`: a compact close button.
   * - `hover`: shows on hover or while selected.
   * - `false`: none.
   */
  readonly closable?: "compact" | "hover" | false
  /**
   * A launcher, a tab that opens others (e.g. "Open file"): the next preview replaces it, and narrow screens neither
   * store nor select it. Independent of `closable`. Unlike `Panel.transient`, the tab is restored.
   */
  readonly transient?: boolean
  /** Opts into fallback selection: the first eligible regular tab, then a pinned tab. Defaults to false. */
  readonly fallback?: boolean
  /** Tabs in one group share one render that stays mounted while any member is listed. */
  readonly group?: string
  /** Struck through, e.g. a file that no longer exists. */
  readonly missing?: boolean
  /**
   * Listed and selectable, but not drawn in the strip; for a restored tab whose content is not known yet. Selection,
   * `focus`, and closing the selected tab still apply to it.
   */
  readonly hidden?: boolean
  /**
   * The workspace path of the file the tab shows. The host lists these as the session's open files: recent
   * files, the line selection `context.addSelection` adds, and reloads when the file changes on disk.
   */
  readonly file?: string
  /** The tab panel itself joins the tab order, for content without focusable elements. */
  readonly tabbable?: boolean
}

/** A panel's narrow-screen view. */
export interface MobileView {
  /** The view's label in the switcher or the overflow menu. */
  readonly title: string
  /** Views list in ascending order. */
  readonly order: number
  /**
   * Where the view is offered.
   * - `tab`: a tab of the view switcher; it replaces the conversation.
   * - `menu`: an entry of the switcher's More drawer; it replaces the conversation.
   * - `drawer`: an entry of the switcher's More drawer; it opens in that drawer over the conversation (`useDrawer`).
   */
  readonly kind: "tab" | "menu" | "drawer"
  /** The view's icon in the More drawer. */
  readonly icon?: IconName
  /**
   * Once shown, the view stays mounted while another view is shown, e.g. a terminal that keeps its shell's screen.
   * Defaults to false: the view mounts each time it is shown.
   */
  readonly cached?: boolean
}

/**
 * What `Panel.render` receives. `tab` and `session` are reactive getters; `screen` is the constant owning screen.
 * Read the getters where you use them and do not destructure. On a session switch the render stays mounted and
 * receives the next session. In `focus` and `close`, `tab` is the event's tab, not the render's changing selection.
 */
export interface PanelProps {
  /** The tab, as `list` currently returns it. */
  readonly tab: PanelTab
  /** The routed session. */
  readonly session: MountedSession
  /** The session screen that owns this panel's files, comments and composer; always present. */
  readonly screen: SessionScreen
}

/** How a closed side tab lists under "Recently closed", from `Panel.closed`. */
export type ClosedPanelTab = {
  /** The row's title; the tab's title by default. */
  readonly title?: string
  /** The row's icon; the panel's mobile icon by default. A tab with a `file` shows its file icon. */
  readonly icon?: IconName
  /** A muted detail after the title, e.g. a page's host. A tab with a `file` shows its folder. */
  readonly detail?: string
  /** What `restore` needs to bring the tab back, e.g. a URL. */
  readonly data?: string
}

/** A panel: the tabs a plugin shows in a session's side region. */
export interface Panel {
  /** The panel's id, unique within the plugin. Its mobile view's key is `${plugin}:${id}`. */
  readonly id: string
  /**
   * Where the panel renders.
   * - `side`: tabs in the side region's strip.
   */
  readonly region: "side"
  /** Asks for the wider session minimum while the side region is open. Reactive. */
  readonly wide?: boolean
  /** Tabs are not restored: stored keys this panel stops listing leave the strip. See also `PanelTab.transient`. */
  readonly transient?: boolean
  /**
   * The canonical form of one of this panel's stored tab ids, when one tab can be stored more than one way (e.g.
   * the same file as an absolute and a relative path). The host rewrites stored ids and drops duplicates. Reactive.
   *
   * @param input - The stored id, session getter and constant owning screen. Do not destructure the session.
   */
  normalize?(input: {
    /** A stored tab id. */
    readonly id: string
    /** The routed session. */
    readonly session: MountedSession
    /** The session screen; always present. */
    readonly screen: SessionScreen
  }): string
  /**
   * A narrow-screen view of this panel. The render sees `usePanel().placement() === "mobile"` and receives a tab with
   * the panel's `id` and the view's `title`.
   */
  readonly mobile?: MobileView
  /**
   * Reactive, and runs again when another session is routed. `open` holds this plugin's tab ids stored in the
   * strip. List those that still apply, plus any `pinned` tab. The host renders triggers, restore, and selection from
   * this data. Cache tab objects by something that outlives one session object (the tab id, `session.key`, or the
   * screen passed as `input.screen`), so a session switch does not render their labels again. Read the getters;
   * do not destructure.
   *
   * @param input - A session getter, the constant owning screen and this call's stored tab ids.
   */
  list(input: {
    /** The routed session. */
    readonly session: MountedSession
    /** The session screen; always present. */
    readonly screen: SessionScreen
    /** This plugin's stored tab ids, in strip order. */
    readonly open: readonly string[]
  }): readonly PanelTab[]
  /**
   * Renders a tab's content once; its own reactivity updates it, also when another session is routed. A render that
   * throws renders nothing and records the error.
   *
   * @param props - The tab and session as reactive getters, and the constant owning screen.
   */
  render(props: PanelProps): JSX.Element
  /**
   * Runs after the host removes the tab from the strip.
   *
   * @param input - The removed tab, routed session and owning screen. Read the getters; do not destructure.
   */
  close?(input: PanelProps): void
  /**
   * Read as the user closes a tab, so it can come back: ⌘⇧T in the side region reopens the newest closed tab, and the
   * new tab view's "Recently closed" list shows closed tabs with a `file`. Return how the entry reads and the data
   * `restore` needs, or `false` when the tab cannot come back. Without it, a tab that is not `transient` comes back
   * under the same key. The host stores the entry, so keep `data` small.
   *
   * @param input - The closing tab, routed session and owning screen. Capture what reopening needs now.
   */
  closed?(input: PanelProps): ClosedPanelTab | false | undefined
  /**
   * Brings back a tab `closed` listed. Without it, the host opens the same key again.
   *
   * @param input - The routed session, owning screen, the closed tab's id and the `data` `closed` returned.
   */
  restore?(input: {
    /** The routed session the tab closed in. */
    readonly session: MountedSession
    /** The session screen that owns the panel. */
    readonly screen: SessionScreen
    /** The closed tab's id. */
    readonly id: string
    /** What `closed` returned as `data`. */
    readonly data?: string
  }): void
  /**
   * Runs when the tab becomes selected. `restored` is true for the selection the side region mounts with, e.g. the
   * tab selected before a reload, and false for every later selection change.
   *
   * @param input - The selected tab, routed session, owning screen and selection origin. Do not destructure.
   */
  focus?(
    input: PanelProps & {
      /** The selection the side region mounted with, not a user's choice. */
      readonly restored: boolean
    },
  ): void
  /**
   * Runs when the user opens the side region on this tab with its toggle, once the tab is on screen. Move keyboard
   * focus to the tab's own target, such as a text field. When focus is still outside the region afterwards, the host
   * focuses the region itself.
   *
   * @param input - The selected tab, routed session and owning screen. Do not destructure.
   */
  enter?(input: PanelProps): void
}

/** A search entry of a `SettingsPage`, indexed without mounting the page. */
export interface SettingEntry {
  /** The `data-action` of the row search reveals. An entry with the SettingsPage's own id describes the page itself. */
  readonly id: string
  /** The entry's title in search results. */
  readonly title: string
  /** The entry's second line. */
  readonly description?: string
  /** Extra words search matches, separated by spaces. */
  readonly keywords?: string
}

/** A settings page, a section on a host page, or rows in a host section. */
export interface SettingsPage {
  /** A page's settings tab value (`/settings?tab=<id>`), and `Layout.settings`'s argument. */
  readonly id: string
  /**
   * Adds a section to a host page. Omit it to add a page.
   * - `general`: the General page.
   * - `servers`: the Servers page.
   */
  readonly page?: "general" | "servers"
  /**
   * `general`: with `page: "general"`, adds rows to that page's General section instead of a section of its own:
   * `render` returns settings rows, which the host places in its list. Search lists the entries under the host
   * section.
   */
  readonly section?: "general"
  /**
   * The nav group of a page. Omit it to list the page after the app's own pages, such as Shortcuts.
   * - `about`: below About, in its group, for pages about the app itself such as release notes.
   */
  readonly group?: "about"
  /** Nav label of a page; search shows it as the section of every entry, except rows placed in a host `section`. */
  readonly title: string
  /** The page's nav icon. */
  readonly icon?: IconName
  /** Search metadata, indexed without mounting the page. */
  readonly entries?: readonly SettingEntry[]
  /**
   * Renders the page, section or rows.
   *
   * @param input - `target` is the entry search is revealing.
   */
  render(input: {
    /** The `SettingEntry.id` search is revealing, if any. */
    readonly target?: string
  }): JSX.Element
}

/**
 * Where a contributed server stands.
 * - `stopped`: not running.
 * - `starting`: starting up.
 * - `auth`: waiting for the user to sign in.
 * - `ready`: reachable; `http` holds its endpoint.
 * - `failed`: could not start.
 * - `incompatible`: running a version this app does not support.
 */
export type ServerState = "stopped" | "starting" | "auth" | "ready" | "failed" | "incompatible"

/** A server's latest health check. */
export interface ServerHealth {
  /** The server answered. */
  readonly healthy: boolean
  /** The version it reported. */
  readonly version?: string
  /** The version is not supported by this app. */
  readonly incompatible?: boolean
  /** A check is in flight. */
  readonly checking?: boolean
}

/** What the host passes to an entry's settings row. */
export interface ServerRow {
  /** `${plugin}:${id}`. */
  readonly key: string
  /** The latest health check; undefined until one finishes. */
  health(): ServerHealth | undefined
  /** The host status mark: a dot, a spinner, a lock, or a warning. */
  readonly Indicator: (props: {
    /** The health to show. */
    readonly health?: ServerHealth
    /** Shows the spinner. */
    readonly connecting?: boolean
    /** Shows the lock. */
    readonly auth?: boolean
  }) => JSX.Element
  /** Runs the entry's `remove`, then closes the server's tabs. */
  remove(): Promise<void>
  /** MenuItem "server.row" items for this server, rendered as items of the row's own menu. */
  readonly Items: () => JSX.Element
}

/** A server a plugin contributes through a `Server` source. */
export interface ServerEntry {
  /** The entry's id; its key is `${plugin}:${id}`. */
  readonly id: string
  /** The display name. */
  readonly name: string
  /** Short badge after the name, e.g. "SSH". */
  readonly label?: string
  /** Where the server stands. */
  readonly state: ServerState
  /** False keeps the entry out of the app's server list (home, routes); settings still shows it and its tabs stay. */
  readonly listed?: boolean
  /** The endpoint, once the server is `ready`. */
  readonly http?: {
    /** The base URL. */
    readonly url: string
    /** The HTTP basic password; the user name is always `opencode`. */
    readonly password?: string
  }
  /**
   * Resolves the endpoint again after the connection drops, e.g. a tunnel. Such a server is managed:
   * the host probes every new endpoint and holds prompts until the event connection is up.
   *
   * @param signal - Aborts when the host stops waiting.
   */
  reconnect?(signal: AbortSignal): Promise<{
    /** The new base URL. */
    readonly url: string
    /** The new HTTP basic password. */
    readonly password?: string
  }>
  /** Called before opening a server that is not ready. Resolves true once it is. */
  connect?(): Promise<boolean>
  /** Runs before the host forgets the server. */
  remove?(): Promise<void>
  /**
   * The connection row in the server's settings.
   *
   * @param row - Host parts for the row.
   */
  row?(row: ServerRow): JSX.Element
  /**
   * Covers the routed session or draft while the entry is not ready; the route stays mounted underneath.
   * `tab` identifies the routed tab and changes when another one is routed.
   *
   * @param input - The routed tab.
   */
  cover?(input: {
    /** The routed tab's key. */
    readonly tab: string
  }): JSX.Element
}

/** A source of servers, e.g. SSH hosts or WSL distributions. */
export interface Server {
  /**
   * Startup waits until every source is ready. A ready source's entries are its complete inventory: the host
   * forgets a server, and closes its tabs, only when a ready source stops listing it.
   */
  readonly ready: boolean
  /** Sources list in ascending order. Defaults to 0. */
  readonly order?: number
  /** Keys are `${plugin}:${id}`. */
  readonly entries: readonly ServerEntry[]
}

/** A local link the app routes to a `LinkHandler`, e.g. a file path in a message. */
export interface Link {
  /** The link target: a path, URL or `file://` link. */
  readonly href: string
  /** The plugin that produced the linked item, e.g. the origin of a composer comment. */
  readonly origin?: string
  /** The path is a known workspace file (e.g. a palette result), not a guess from text. */
  readonly exact?: boolean
  /**
   * Must not switch the narrow-screen view: the agent opened it (e.g. a browser preview), or the user opened it from
   * where they stay (e.g. a palette pick or a composer chip). Handlers pass it to `Layout.open`.
   */
  readonly background?: boolean
  /** Workspace-relative directory the link was written in. */
  readonly base?: string
  /** The session the link belongs to. */
  readonly session?: SessionRef
}

/** Opens local links that `match` accepts. `Links.open` picks the matching handler with the highest priority. */
export interface LinkHandler {
  /** Handlers with higher values win; on a tie, the first contributed. Defaults to 0. */
  readonly priority?: number
  /**
   * Whether this handler opens the link.
   *
   * @param link - The link to route.
   */
  match(link: Link): boolean
  /**
   * Opens the link.
   *
   * @param link - A link `match` accepted.
   */
  open(link: Link): void
  /**
   * Whether the link's target exists. Omit it and `Links.exists` answers false, so text never looks like a link this
   * handler opens. Must never read file contents or show an error: it runs for every candidate path a message renders.
   * Resolve false on failure.
   *
   * @param link - A link `match` accepted.
   * @returns Whether the target exists, now or once checked.
   */
  exists?(link: Link): boolean | Promise<boolean>
}

/** A pill in the titlebar or the tabs footer; the label shows on hover. */
export interface TitlebarItem {
  /** The item's id; the host keeps the pill's element while the id stays. */
  readonly id: string
  /** The visible label. */
  readonly label: string
  /** Accessible name when it differs from the visible label. */
  readonly title?: string
  /** The pill's icon. Defaults to a download arrow. */
  readonly icon?: IconName
  /** Shows a spinner and disables the pill. */
  readonly busy?: boolean
  /** Shows the pill pressed (`aria-pressed`). */
  readonly pressed?: boolean
  /** Runs when the user clicks the pill. Omit it for an item that only shows. */
  run?(): void
}

/**
 * The status a composer pill or one of its rows shows, by coloring its icon.
 * - `success`: done or passing.
 * - `warning`: needs attention, such as checks still running or a review requested.
 * - `danger`: failed or blocked.
 */
export type ComposerPillTone = "success" | "warning" | "danger"

/** What a composer pill receives: the session whose composer it sits above. Do not destructure. */
export interface ComposerPillProps {
  /** The routed session; a new object when another session is routed. Its fields are getters. */
  readonly session: MountedSession
  /** The session screen that owns the composer. */
  readonly screen: SessionScreen
}

/** One row of the menu a composer pill opens. */
export interface ComposerPillRow {
  /** The row's id, unique within the pill. */
  readonly id: string
  /** The row's text. */
  readonly label: string
  /** The row's icon. Omit it for none. */
  readonly icon?: IconName
  /** Colors the row's icon. */
  readonly tone?: ComposerPillTone
  /** Muted text at the row's end, such as a branch or a count. */
  readonly detail?: string
  /** Runs when the user picks the row. Omit it for a row that only shows. */
  run?(): void
}

/** What a composer pill's `menu` receives: the pill's session and a way to close the popover. Do not destructure. */
export interface ComposerPillMenuProps extends ComposerPillProps {
  /** Closes the popover, for example after the user picks an action in it. Does nothing once it is closed. */
  close(): void
}

/** What a composer pill shows above one session's composer. */
export interface ComposerPillView {
  /** The capsule's text; long text truncates. */
  readonly label: string
  /** The capsule's icon. Omit it for none. */
  readonly icon?: IconName
  /** Colors the capsule's icon. */
  readonly tone?: ComposerPillTone
  /**
   * Accessible name, and the heading of the menu or popover the pill opens, when it differs from `label`. The heading
   * wraps to at most three lines, then truncates.
   */
  readonly title?: string
  /** The menu the pill opens. Omit it for a pill that runs `run` instead. Unused when the pill has a `menu`. */
  readonly rows?: readonly ComposerPillRow[]
  /** Runs when the user clicks a pill without `rows` or a `menu`. */
  run?(): void
}

/**
 * A pill in the row above a session's composer, beside the app's background work and todo pills. Pills float over the
 * timeline, so showing or hiding one never resizes the composer, and the row follows the user's background activity
 * alignment. The host does not show pills in a subagent's session.
 */
export interface ComposerPill {
  /** The pill's id, unique within the plugin. */
  readonly id: string
  /** Sorts plugin pills, lowest first; ties keep contribution order. Defaults to 0. */
  readonly order?: number
  /**
   * The pill above one session's composer, or undefined to show none there. Reactive: the host runs it for each
   * mounted composer and again when what it reads changes, so read the session's state and your own here.
   *
   * @param input - The session and its screen. Do not destructure.
   */
  show(input: ComposerPillProps): ComposerPillView | undefined
  /**
   * Your content for the popover the pill opens, for a pill that needs more than `rows`, such as status text and
   * buttons. The host owns the capsule and the popover around this content: its placement, focus, dismissal, and the
   * heading (`title`, else `label`). When set, clicking the pill opens the popover, and the view's `rows` and `run` are
   * unused. Renders each time the popover opens; its own reactivity updates it while open, also when another session is
   * routed. A render that throws renders nothing and records the error.
   *
   * @param input - The session, its screen, and `close`. Do not destructure.
   */
  menu?(input: ComposerPillMenuProps): JSX.Element
}

/** The places a `Slot` renders, with the input each passes to `render`. */
export interface SlotMap {
  /** Full-width strip under the window content, above toasts. */
  readonly "window.bottom": Record<string, never>
  /** The timeline title row. Cached timelines stay mounted while hidden; `active` is false then. */
  readonly "session.header": {
    /** The timeline's owning session screen; always present, also while the timeline is cached. */
    readonly screen: SessionScreen
    /** The timeline's session: its latest object, kept while the timeline is hidden. */
    readonly session: MountedSession
    /** The timeline is the one on screen. */
    readonly active: boolean
    /**
     * The title does not fit beside the actions, even with the location collapsed. Show the compact form of what you
     * render, without its details (for example an icon that opens them in a menu), so the title keeps the room. The
     * header returns to false once the title fits beside your expanded content again.
     */
    readonly compact: boolean
  }
  /** Items in the project/location menu, after its location details. Omitted on loading headers without a screen. */
  readonly "session.location.menu": {
    /** The menu's owning session screen; always present. */
    readonly screen: SessionScreen
    /** The session whose location is shown; reads follow moves without remounting. */
    readonly session: MountedSession
    /** Whether the project menu is open. Subscribe to location data only while true. */
    readonly shown: boolean
  }
  /** The actions at the end of the side region's tab strip. */
  readonly "session.panel.end": {
    /** The owning session screen; always present. */
    readonly screen: SessionScreen
    /** The routed session; a new object when another session is routed. */
    readonly session: MountedSession
  }
}

/** Content for one of the host's slots, typed by `at`. */
export type Slot = {
  [At in keyof SlotMap]: {
    /** The slot; see `SlotMap`. */
    readonly at: At
    /** Slot contents render in ascending order. Defaults to 0. */
    readonly order?: number
    /**
     * Renders the content once; its own reactivity updates it. Session and active fields are reactive getters, so read
     * `input.session` where you use it: another routed session arrives through it without a remount. `screen` on a
     * session slot is its constant owning screen, available during the first render. A render that
     * throws renders nothing and records the error.
     *
     * @param input - The slot's input.
     */
    render(input: SlotMap[At]): JSX.Element
  }
}[keyof SlotMap]

/**
 * The registry of palette commands, each with an optional keybind and slash command.
 *
 * @example
 * ```ts
 * ctx.add(Command, {
 *   id: "toggle",
 *   bind: "mod+shift+e",
 *   get title() {
 *     return ctx.t("command.toggle")
 *   },
 *   run: () => toggle(),
 * })
 * ```
 */
export const Command = Registry.define<Command>("command")

/**
 * The registry of host menu items.
 *
 * @example
 * ```ts
 * ctx.add(MenuItem, { menu: "session.panel", id: "open", title: ctx.t("open"), icon: "folder", run: () => open() })
 * ```
 */
export const MenuItem = Registry.define<MenuItem>("menu-item")

/**
 * The registry of panels: tabs in the session's side region.
 *
 * @example
 * ```ts
 * ctx.add(Panel, {
 *   id: "main",
 *   region: "side",
 *   list: (input) => (input.open.includes("main") ? [tab] : []),
 *   render: (props) => <View session={props.session} />,
 * })
 * ```
 */
export const Panel = Registry.define<Panel>("panel")

/**
 * The registry of settings pages, sections on host pages, and rows in host sections.
 *
 * @example
 * ```ts
 * ctx.add(SettingsPage, { id: "updates", page: "general", title: ctx.t("title"), render: () => <Section /> })
 * ```
 */
export const SettingsPage = Registry.define<SettingsPage>("settings-page")

/**
 * The registry of server sources the app lists.
 *
 * @example
 * ```ts
 * ctx.add(Server, () => ({ ready: loaded(), entries: hosts().map(toEntry) }))
 * ```
 */
export const Server = Registry.define<Server>("server")

/**
 * The registry of handlers that open local links, such as file paths in messages.
 *
 * @example
 * ```ts
 * ctx.add(LinkHandler, { match: (link) => link.href.endsWith(".md"), open: (link) => preview(link) })
 * ```
 */
export const LinkHandler = Registry.define<LinkHandler>("link-handler")

/**
 * The registry of titlebar pills.
 *
 * @example
 * ```ts
 * ctx.add(TitlebarItem, () => (ready() ? { id: "update", label: ctx.t("restart"), run: install } : undefined))
 * ```
 */
export const TitlebarItem = Registry.define<TitlebarItem>("titlebar-item")

/**
 * The registry of pills above the session composer.
 *
 * @example
 * ```ts
 * ctx.add(ComposerPill, {
 *   id: "pulls",
 *   show: (input) => {
 *     const pulls = openPulls(input.session.directory)
 *     return pulls.length > 0 ? { icon: "github", label: ctx.plural("pulls", pulls.length) } : undefined
 *   },
 * })
 * ```
 */
export const ComposerPill = Registry.define<ComposerPill>("composer-pill")

/**
 * The registry of content for the host's slots (`SlotMap`).
 *
 * @example
 * ```ts
 * ctx.add(Slot, { at: "session.header", render: (input) => <Usage session={input.session} /> })
 * ```
 */
export const Slot = Registry.define<Slot>("slot")

/**
 * The registry of CSS the host adds to the document while each item is contributed. Import the file with `?inline`.
 *
 * @example
 * ```ts
 * import css from "./dialog.css?inline"
 * ctx.add(Style, css)
 * ```
 */
export const Style = Registry.define<string>("style")
