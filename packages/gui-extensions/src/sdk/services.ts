import type { SessionID } from "@opencode/schema/session-id"
import type { Data } from "@opencode/client/solid"
import type { LocationRef, OpenCodeClient, ProjectListOutput, WorktreeDirectory } from "@opencode/client/promise"
import type { Schema } from "effect"
import type { Accessor, JSX } from "solid-js"
import type { Store } from "solid-js/store"
import { Host, type Cleanup, type OS } from "./core"
import type { IconName, Link } from "./points"

export interface ServerRef {
  /** Host key: "sidecar", an http URL, or `${extension}:${id}` for servers an extension contributes. */
  readonly id: string
  /** Display name. */
  readonly name: string
  readonly url: string
  readonly password?: string
  readonly client: OpenCodeClient
  readonly data: Data
  /** The built-in local server or a loopback http server. */
  readonly local: boolean
  readonly builtin: boolean
  readonly compatible: boolean
  /** The event connection to this server is up. */
  readonly connected: boolean
}

/** A session owned by an open shell tab, mounted or not. */
export interface SessionRef {
  readonly key: string
  readonly id: SessionID
  readonly tab: string
  readonly server: ServerRef
  readonly pending: boolean
  readonly location: LocationRef | undefined
}

export type Project = Omit<ProjectListOutput[number], "canonical"> & {
  worktree: string
  worktrees: WorktreeDirectory[]
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
  /** On-disk size when the bytes themselves are not retained. */
  size?: number
}

export interface LineRange {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}

export interface FileState {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  notFound?: boolean
  error?: string
  content?: FileContent
}

export interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface Files {
  readonly root: string
  ready(): boolean
  resolve(path: string): string
  absolute(path: string): boolean
  get(path: string): FileState | undefined
  /** Last load found no such file. Unlike `get`, it does not touch the content cache. */
  missing(path: string): boolean
  sync(path: string, options?: { readonly force?: boolean }): Promise<void>
  search(
    query: string,
    options?: { readonly kind?: "file" | "any"; readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<string[]>
  readonly selection: {
    get(path: string): LineRange | null | undefined
    set(path: string, range: LineRange | null): void
  }
  readonly scroll: {
    get(path: string): { readonly top?: number; readonly left?: number }
    set(path: string, value: { readonly top?: number; readonly left?: number }): void
  }
  readonly tree: {
    list(path: string): readonly FileNode[]
    state(path: string): { expanded: boolean; loaded?: boolean; loading?: boolean; error?: string } | undefined
    sync(path: string, options?: { readonly force?: boolean }): Promise<void>
    expand(path: string, options?: { readonly list?: boolean }): void
    collapse(path: string): void
  }
}

export interface Comment {
  id: string
  time: number
  file: string
  selection: LineRange
  comment: string
}

export interface Comments {
  list(file?: string): readonly Comment[]
  add(input: Omit<Comment, "id" | "time">): Comment
  update(id: string, comment: string): void
  remove(id: string): void
  readonly focus: {
    current(): { readonly file: string; readonly id: string } | null
    set(value: { readonly file: string; readonly id: string } | null): void
  }
  readonly active: {
    current(): { readonly file: string; readonly id: string } | null
    set(value: { readonly file: string; readonly id: string } | null): void
  }
}

export interface ComposerFile {
  type: "file"
  path: string
  selection?: { startLine: number; endLine: number; startChar: number; endChar: number }
  preview?: string
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
}

/**
 * A comment on something other than workspace lines, such as an element picked in a page. The model reads
 * "The user made the following comment regarding <subject>: <comment>".
 */
export interface ComposerNote {
  type: "note"
  /** The extension that attached it. Opening the chip routes `Links.open({ href, origin })` to its Link handler. */
  origin: string
  commentID: string
  /** Chip text naming the subject, e.g. `button#save`. */
  label: string
  /** Chip icon. */
  icon: IconName
  /** What the comment is about, for the model. Quote untrusted text such as page content. */
  subject: string
  comment: string
  href?: string
  /**
   * Replaces `subject` and `href` while the note stays in this app process, for references only this process
   * can resolve (e.g. a page element ref). A stored draft and a sent message restored by revert or fork drop it.
   */
  live?: { readonly subject: string; readonly href?: string }
}

export interface Composer {
  attach(part: ComposerFile | ComposerNote): void
  /** id is the part's commentID; update and detach reach files and notes alike. Notes take only comment. */
  update(id: string, patch: { readonly comment?: string; readonly preview?: string }): void
  detach(id: string): void
}

export type BackgroundTask =
  | { id: SessionID; type: "subagent"; label: string; agent?: string }
  | { id: string; type: "shell"; label: string }

/** A mounted session route. Slot inputs and panel renders receive this. */
export interface SessionView extends SessionRef {
  /** `sandboxes` includes worktrees found on disk; `name` and `icon` carry the user's local overrides. */
  readonly project: Project | undefined
  /**
   * The sidebar project whose worktree or a sandbox is this session's directory, with the user's local name and
   * icon. Undefined when no listed project is opened there, e.g. for a session in a project subfolder.
   */
  readonly listedProject:
    | { readonly worktree: string; readonly name?: string; readonly icon?: Project["icon"] }
    | undefined
  readonly directory: string
  /** The session runs in the project root rather than a worktree. */
  readonly local: boolean
  /** Shell commands and subagents the session moved to the background. */
  readonly background: readonly BackgroundTask[]
  readonly file: Files
  readonly comment: Comments
  readonly composer: Composer
}

export interface Sessions {
  /** Sessions owned by open shell tabs. Reactive. */
  list(): readonly SessionRef[]
  /** The routed, mounted session. Reactive. */
  current(): SessionView | undefined
}

export type PanelState = "closed" | "open" | "active" | "visible"

export interface Layout {
  /** Viewport under 768px. */
  narrow(): boolean
  /** Stored layout (tabs, scroll) has loaded. */
  ready(): boolean
  /**
   * Panel keys are `${extension}:${tab id}`. Works for sessions that are not mounted. On narrow screens, a plain or
   * `preview` open selects the panel's mobile view and closes the dock; opening a tab its panel does not list, or a
   * launcher, stores nothing. A launcher is never selected on narrow screens, but a stored one stays the preview slot.
   */
  open(
    key: string,
    session: SessionRef,
    /**
     * `select`: append at the end if missing and select it, leaving the preview tab alone. Like `background`, it keeps
     * the narrow-screen view and the dock and opens the side region.
     * `background`: on narrow screens, keep the current view and the dock, and open the side region so the tab
     * shows when the window is wide.
     */
    options?: {
      readonly preview?: boolean
      readonly focus?: boolean
      readonly select?: boolean
      readonly background?: boolean
    },
  ): void
  close(key: string, session: SessionRef): void
  /** Closing the last panel the side region was opened for also closes the region. */
  toggle(key: string, session: SessionRef): void
  state(key: string, session: SessionRef): PanelState
  /**
   * This extension's tab ids stored in the session's side strip, mounted or not. Empty while the session's location
   * is unknown, as `state` is then "closed". Reactive.
   */
  stored(session: SessionRef): readonly string[]
  readonly side: { opened(session: SessionRef): boolean; toggle(session: SessionRef): void }
  readonly dock: { opened(session: SessionRef): boolean; placement(): "side" | "bottom" }
  readonly scroll: {
    get(session: SessionRef, key: string): { readonly x: number; readonly y: number } | undefined
    set(session: SessionRef, key: string, value: { readonly x: number; readonly y: number }): void
  }
  settings(page?: string): void
  /** Opens a project on a server: a directory picker titled `title`, then a new draft. Waits until the server is listed. */
  project(server: string, title: string): void
}

export type StorageScope =
  | "app"
  | { readonly server: string; readonly directory?: string }
  | { readonly session: SessionRef }

export interface Storage {
  /** Durable, schema-decoded, synced across windows. */
  store<S extends Schema.ConstraintCodec<object, unknown>>(
    key: string,
    options: {
      readonly schema: S
      readonly initial: S["Type"]
      readonly scope?: StorageScope
      /**
       * Imports an older host key of the same storage once (the raw stored key, e.g. "workspace:terminal").
       * With pick, only the picked part of the old JSON is copied and the old key stays for its other owners.
       */
      readonly from?:
        | string
        | {
            readonly key: string
            /**
             * For session scope: `key` is an app key (e.g. "layout") whose field `sessions` holds every session's
             * state by the host's session key. pick receives only this session's entry, or undefined.
             */
            readonly sessions?: string
            pick(value: unknown): unknown
          }
    },
  ): readonly [Store<S["Type"]>, (mutation: (draft: S["Type"]) => void) => void, Accessor<boolean>]
  /** Window-local and kept across extension reloads. */
  memory<T extends object>(
    key: string,
    options: { readonly initial: T },
  ): readonly [Store<T>, (mutation: (draft: T) => void) => void]
  remove(key: string, options?: { readonly scope?: StorageScope }): void
}

export interface System {
  copy(text: string): Promise<void>
  save(file: { readonly name: string; readonly content: string }): Promise<boolean>
  /** Opens a URL in the system browser; desktop opens file:// URLs with the default app. */
  open(url: string): void
}

export interface Native {
  readonly os: OS
  readonly window: string
  zoom(): number
  launch(path: string, app?: string): Promise<void>
  /** Keeps the window focused for automation and debugging. */
  forceFocus(enabled: boolean): Promise<void>
  reveal(path: string): Promise<boolean>
  installed(app: string): Promise<boolean>
}

export interface App {
  readonly version?: string
  readonly channel: "local" | "dev" | "beta" | "prod"
  readonly platform: "web" | "desktop"
  font(kind: "mono"): string
  /** BCP 47 locale of the interface language, for Intl formatting. */
  locale(): string
  direction(): "ltr" | "rtl"
  setDirection(direction: "ltr" | "rtl"): void
  /** A route transition is in progress. */
  routing(): boolean
  /** The current route path with its query string. */
  path(): string
  /** Display parts of a published command's effective keybind, e.g. ["Ctrl", "`\"]. Empty when unbound. */
  keybind(command: string): readonly string[]
  /** Display parts of a chord the app does not own, e.g. "mod+shift+c" that a page handles itself. */
  keys(bind: string): readonly string[]
  /** The event matches a published command's effective keybind. */
  matches(command: string, event: KeyboardEvent): boolean
  /** Ids of the servers the app lists (`ServerRef.id`). Reactive. */
  servers(): readonly string[]
  on(
    event: "workspace.remove",
    handler: (value: { readonly server: string; readonly directory: string }) => void,
  ): Cleanup
}

export interface Links {
  /** Routes a local link to the best Link handler. Returns false when none matches. */
  open(link: Link): boolean
}

/** Host preferences an extension's settings may show and change. */
export interface Preferences {
  /** Show What's New after an update. */
  releaseNotes(): boolean
  setReleaseNotes(value: boolean): void
  /** Wrap long diff lines on narrow screens. */
  mobileDiffWrap(): boolean
}

/** The render runs with this extension's context; the dialog closes when the extension goes away. */
export interface Dialogs {
  /** Replaces the open dialogs. */
  show(render: () => JSX.Element): void
  /** Opens above the open dialog. */
  push(render: () => JSX.Element): void
  close(): void
  /** Some dialog is open. Reactive. */
  active(): boolean
}

export interface SurfaceProps {
  /** A surface the extension's main entry created with `Surfaces.create`. Undefined renders the box alone. */
  readonly id: string | undefined
  /** The surface should be on screen. The host also hides it while the window is hidden or a dialog is open. */
  readonly visible: boolean
  /** Paints a still of the surface in place of the live view, so DOM content can float above it. */
  readonly frozen?: boolean
  /** Radius of the bottom corners in CSS pixels. */
  readonly radius?: number
  /** CSS color the rounded corners show; defaults to the app backdrop behind the panel. */
  readonly background?: string
  readonly class?: string
  readonly children?: JSX.Element
}

export interface Surfaces {
  /**
   * The box a native main-process surface fills. The host measures it (webview zoom included), pushes
   * coalesced layouts, masks the rounded corners, hides the surface while it is invisible or unmounted,
   * and paints a still of it while floating content covers it. Children render inside the box.
   */
  View(props: SurfaceProps): JSX.Element
  /** A JPEG still of a shown surface; undefined while it is hidden, and always on the web. */
  capture(id: string): Promise<Uint8Array | undefined>
}

export const Sessions = Host.define<Sessions>("session")
export const Layout = Host.define<Layout>("layout")
export const Storage = Host.define<Storage>("storage")
export const System = Host.define<System>("system")
export const Native = Host.define<Native | undefined>("native")
export const App = Host.define<App>("app")
export const Dialogs = Host.define<Dialogs>("dialog")
export const Links = Host.define<Links>("link")
export const Preferences = Host.define<Preferences>("preferences")
export const Surfaces = Host.define<Surfaces>("surface")
