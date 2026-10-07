import type { Data } from "@opencode/client/solid"
import type { LocationRef, OpenCodeClient, ProjectListOutput, WorktreeDirectory } from "@opencode/client/promise"
import type { Schema } from "effect"
import type { JSX } from "solid-js"
import type { Store } from "solid-js/store"
import type { Cleanup, OS, Persisted, StoreFrom } from "./core"
import type { IconName, Link } from "./registries"

/**
 * A server the app lists. One ref per id that follows the live connection: read `client`, `data` and `url` from it
 * each time, as a restarted or re-authenticated server gets a new controller under the same id.
 */
export interface ServerRef {
  /** Host key: "sidecar", an http URL, or `${extension}:${id}` for servers an extension contributes. */
  readonly id: string
  /** Display name; the id when the server has none. */
  readonly name: string
  /** The server's base URL. */
  readonly url: string
  /** The HTTP basic password the user configured; undefined when there is none. */
  readonly password?: string
  /** The server's API client. */
  readonly client: OpenCodeClient
  /** The server's synced data (sessions, projects, …). Reactive. */
  readonly data: Data
  /** The built-in local server or a loopback http server. */
  readonly local: boolean
  /** The app's own server, the desktop sidecar. */
  readonly builtin: boolean
  /** The server's version works with this app; false after a health check found it incompatible. */
  readonly compatible: boolean
  /** The event connection to this server is up. */
  readonly connected: boolean
}

/** A session owned by an open shell tab, mounted or not. */
export interface SessionRef {
  /** `${server id}\n${session id}`: unique across servers. Key per-session state by it. */
  readonly key: string
  /** The session's id on its server. */
  readonly id: string
  /** The key of the shell tab that owns the session. */
  readonly tab: string
  /** The session's server. */
  readonly server: ServerRef
  /** The server is still creating the session. */
  readonly pending: boolean
  /**
   * Where the session runs. Undefined until the server reports it, and again while it is unknown, e.g. after the
   * server re-authenticates. Layout reads return nothing meanwhile; layout writes wait for it.
   */
  readonly location: LocationRef | undefined
}

/** A project as the sidebar lists it, with the worktrees found on disk and the user's local name and icon. */
export type Project = Omit<ProjectListOutput[number], "canonical"> & {
  /** The project's root directory. */
  worktree: string
  /** The project's worktrees. */
  worktrees: WorktreeDirectory[]
}

/** A file's content as the server read it. */
export type FileContent = {
  /**
   * How to read `content`.
   * - `text`: `content` is the text.
   * - `binary`: `content` is base64 when `encoding` says so, or empty when only `size` is known.
   */
  type: "text" | "binary"
  /** The text, or the base64 bytes of a binary file. */
  content: string
  /** A unified diff of the file's uncommitted change, when there is one. */
  diff?: string
  /** The same change, parsed. */
  patch?: {
    /** The file's name before the change. */
    oldFileName: string
    /** The file's name after the change. */
    newFileName: string
    /** The header of the old side. */
    oldHeader?: string
    /** The header of the new side. */
    newHeader?: string
    /** The changed regions. */
    hunks: Array<{
      /** First line of the hunk in the old file. */
      oldStart: number
      /** Lines of the hunk in the old file. */
      oldLines: number
      /** First line of the hunk in the new file. */
      newStart: number
      /** Lines of the hunk in the new file. */
      newLines: number
      /** The hunk's lines, each prefixed with " ", "+" or "-". */
      lines: string[]
    }>
    /** The diff's index line. */
    index?: string
  }
  /** `base64` when `content` holds encoded bytes. */
  encoding?: "base64"
  /** The file's MIME type, when the server knows it. */
  mimeType?: string
  /** On-disk size when the bytes themselves are not retained. */
  size?: number
}

/** A range of lines in a file, or in one side of its diff. */
export interface LineRange {
  /** The first line. */
  start: number
  /** The last line. */
  end: number
  /**
   * The diff side `start` is on. Omit it for the file itself.
   * - `additions`: the new side.
   * - `deletions`: the old side.
   */
  side?: "additions" | "deletions"
  /** The diff side `end` is on, when it differs from `side`. */
  endSide?: "additions" | "deletions"
}

/** One file of the session's workspace as the file model holds it. */
export interface FileState {
  /** The workspace-relative path. */
  path: string
  /** The file's name. */
  name: string
  /** The content has loaded at least once. */
  loaded?: boolean
  /** A load is in flight. */
  loading?: boolean
  /** The last load found no such file. */
  notFound?: boolean
  /** The last load's error message. */
  error?: string
  /** The loaded content. */
  content?: FileContent
}

/** An entry of the workspace file tree. */
export interface FileNode {
  /** The entry's name. */
  name: string
  /** The workspace-relative path. */
  path: string
  /** The absolute path. */
  absolute: string
  /**
   * What the entry is.
   * - `file`: a file.
   * - `directory`: a directory.
   */
  type: "file" | "directory"
  /** Ignored by the workspace's ignore files. */
  ignored: boolean
}

/** The session screen's workspace files: content, view state and the file tree, of the routed session. */
export interface Files {
  /** The workspace root directory. */
  readonly root: string
  /** The per-file view state (selection, scroll) has loaded. Reactive. */
  ready(): boolean
  /**
   * Normalizes a path, URL or `file://` link to a workspace-relative path. A path outside the root stays absolute.
   *
   * @param path - Any path or link to a file.
   */
  resolve(path: string): string
  /**
   * Whether a normalized path is absolute, and so outside the workspace.
   *
   * @param path - A path from `resolve`.
   */
  absolute(path: string): boolean
  /**
   * The file's state; undefined until `sync` first loads it. Reactive.
   *
   * @param path - A workspace-relative path.
   */
  get(path: string): FileState | undefined
  /**
   * The last load found no such file. Unlike `get`, it does not touch the content cache.
   *
   * @param path - A workspace path.
   */
  missing(path: string): boolean
  /**
   * Loads the file's content, once unless forced.
   *
   * @param path - A workspace path.
   * @param options - Load options.
   */
  sync(
    path: string,
    options?: {
      /** Reloads even when the content has loaded. Defaults to false. */
      readonly force?: boolean
    },
  ): Promise<void>
  /**
   * Searches the workspace by fuzzy path.
   *
   * @param query - The search text.
   * @param options - Search options.
   * @returns Matching workspace-relative paths, best first.
   */
  search(
    query: string,
    options?: {
      /**
       * What to match. Defaults to `file`.
       * - `file`: files only.
       * - `any`: files and directories.
       */
      readonly kind?: "file" | "any"
      /** The most results to return. Defaults to the server's limit. */
      readonly limit?: number
      /** Aborts the search, which then rejects. A search that fails otherwise resolves with no results. */
      readonly signal?: AbortSignal
    },
  ): Promise<string[]>
  /** The selected line range per file, kept with the session's view state. */
  readonly selection: {
    /**
     * The file's selected range: null when the selection was cleared, undefined when none is stored. Reactive.
     *
     * @param path - A workspace path.
     */
    get(path: string): LineRange | null | undefined
    /**
     * Selects a range, or clears the selection with null.
     *
     * @param path - A workspace path.
     * @param range - The range to select.
     */
    set(path: string, range: LineRange | null): void
  }
  /** The scroll offset per file, kept with the session's view state. */
  readonly scroll: {
    /**
     * The file's stored scroll offset.
     *
     * @param path - A workspace path.
     */
    get(path: string): {
      /** Vertical offset in CSS pixels; undefined when none is stored. */
      readonly top?: number
      /** Horizontal offset in CSS pixels; undefined when none is stored. */
      readonly left?: number
    }
    /**
     * Stores the file's scroll offset. An offset left out keeps its stored value.
     *
     * @param path - A workspace path.
     * @param value - The offsets to store.
     */
    set(
      path: string,
      value: {
        /** Vertical offset in CSS pixels. */
        readonly top?: number
        /** Horizontal offset in CSS pixels. */
        readonly left?: number
      },
    ): void
  }
  /** The workspace file tree, loaded one directory at a time. */
  readonly tree: {
    /**
     * The loaded entries of a directory; empty until `sync` loads it. Reactive.
     *
     * @param path - A workspace-relative directory; "" for the root.
     */
    list(path: string): readonly FileNode[]
    /**
     * A directory's tree state; undefined before anything touched it. Reactive.
     *
     * @param path - A workspace-relative directory.
     */
    state(path: string):
      | {
          /** The directory is expanded. */
          expanded: boolean
          /** Its entries have loaded. */
          loaded?: boolean
          /** A load is in flight. */
          loading?: boolean
          /** The last load's error message. */
          error?: string
        }
      | undefined
    /**
     * Loads a directory's entries, once unless forced.
     *
     * @param path - A workspace-relative directory.
     * @param options - Load options.
     */
    sync(
      path: string,
      options?: {
        /** Lists the directory again even when it has loaded. Defaults to false. */
        readonly force?: boolean
      },
    ): Promise<void>
    /**
     * Expands a directory.
     *
     * @param path - A workspace-relative directory.
     * @param options - Expand options.
     */
    expand(
      path: string,
      options?: {
        /** False expands without loading its entries. Defaults to true. */
        readonly list?: boolean
      },
    ): void
    /**
     * Collapses a directory.
     *
     * @param path - A workspace-relative directory.
     */
    collapse(path: string): void
  }
}

/** A line comment the user left on a workspace file, before it is sent. */
export interface Comment {
  /** The comment's id. */
  id: string
  /** When it was made, in milliseconds since the epoch. */
  time: number
  /** The workspace path of the file. */
  file: string
  /** The lines it is about. */
  selection: LineRange
  /** The comment text. */
  comment: string
}

/** The session screen's line comments, by file, of the routed session's next prompt. */
export interface Comments {
  /**
   * The comments on one file, or on every file. Reactive.
   *
   * @param file - A workspace path; omit it for all comments.
   */
  list(file?: string): readonly Comment[]
  /**
   * Adds a comment and focuses it.
   *
   * @param input - The comment without its id and time.
   * @returns The comment with its id and time.
   */
  add(input: Omit<Comment, "id" | "time">): Comment
  /**
   * Replaces a comment's text. An unknown id does nothing.
   *
   * @param id - The comment's id.
   * @param comment - The new text.
   */
  update(id: string, comment: string): void
  /**
   * Removes a comment. An unknown id does nothing.
   *
   * @param id - The comment's id.
   */
  remove(id: string): void
  /** The comment a view should reveal and edit, e.g. the one just added. */
  readonly focus: {
    /** The focused comment, or null. Reactive. */
    current(): {
      /** The comment's file. */
      readonly file: string
      /** The comment's id. */
      readonly id: string
    } | null
    /**
     * Focuses a comment, or clears the focus with null.
     *
     * @param value - The comment's file and id.
     */
    set(
      value: {
        /** The comment's file. */
        readonly file: string
        /** The comment's id. */
        readonly id: string
      } | null,
    ): void
  }
  /** The comment views mark as current. */
  readonly active: {
    /** The current comment, or null. Reactive. */
    current(): {
      /** The comment's file. */
      readonly file: string
      /** The comment's id. */
      readonly id: string
    } | null
    /**
     * Marks a comment as current, or clears the mark with null.
     *
     * @param value - The comment's file and id.
     */
    set(
      value: {
        /** The comment's file. */
        readonly file: string
        /** The comment's id. */
        readonly id: string
      } | null,
    ): void
  }
}

/** A workspace file attached to the composer, with an optional line selection and comment. */
export interface ComposerFile {
  /** The part kind. */
  type: "file"
  /** The workspace path. */
  path: string
  /** The selected text, when only part of the file is attached. */
  selection?: {
    /** First selected line. */
    startLine: number
    /** Last selected line. */
    endLine: number
    /** First selected character on `startLine`. */
    startChar: number
    /** Character after the selection on `endLine`. */
    endChar: number
  }
  /** Text the chip previews. */
  preview?: string
  /** The user's comment on the attachment. */
  comment?: string
  /** The id that `Composer.update` and `detach` take. */
  commentID?: string
  /**
   * The view the comment was made in.
   * - `review`: the review panel.
   * - `file`: a file tab.
   */
  commentOrigin?: "review" | "file"
}

/**
 * A comment on something other than workspace lines, such as an element picked in a page. The model reads
 * "The user made the following comment regarding <subject>: <comment>".
 */
export interface ComposerNote {
  /** The part kind. */
  type: "note"
  /** The extension that attached it. Opening the chip routes `Links.open({ href, origin })` to its LinkHandler. */
  origin: string
  /** The id that `Composer.update` and `detach` take. */
  commentID: string
  /** Chip text naming the subject, e.g. `button#save`. */
  label: string
  /** Chip icon. */
  icon: IconName
  /** What the comment is about, for the model. Quote untrusted text such as page content. */
  subject: string
  /** The user's comment. */
  comment: string
  /** The link opening the chip routes, with `origin`. */
  href?: string
  /**
   * Replaces `subject` and `href` while the note stays in this app process, for references only this process
   * can resolve (e.g. a page element ref). A stored draft and a sent message restored by revert or fork drop it.
   */
  live?: {
    /** The subject while the note stays in this process. */
    readonly subject: string
    /** The link while the note stays in this process. */
    readonly href?: string
  }
}

/** The session screen's composer: the parts attached to the routed session's next prompt. */
export interface Composer {
  /**
   * Attaches a file or a note to the next prompt.
   *
   * @param part - The part to attach.
   */
  attach(part: ComposerFile | ComposerNote): void
  /**
   * Changes an attached part. Files and notes alike; a note takes only `comment`.
   *
   * @param id - The part's `commentID`.
   * @param patch - The fields to change.
   */
  update(
    id: string,
    patch: {
      /** The new comment. */
      readonly comment?: string
      /** The new preview, for a file. */
      readonly preview?: string
    },
  ): void
  /**
   * Removes an attached part.
   *
   * @param id - The part's `commentID`.
   */
  detach(id: string): void
}

/** Work the session moved to the background. */
export interface BackgroundTask {
  /** The task's id. */
  id: string
  /**
   * What runs.
   * - `shell`: a shell command.
   * - `subagent`: a subagent.
   */
  type: "shell" | "subagent"
  /** The task's display label. */
  label: string
  /** The subagent's name, for `subagent` tasks. */
  agent?: string
}

/**
 * A routed session on the session screen: its identity and data, and nothing that acts on whichever session is
 * routed. Slot inputs and panel renders receive it, and `Sessions.current` returns it. One frozen object per routed
 * session and directory: a new one each time a session is routed, each time the routed session moves to another
 * directory, and once its shell tab is known. `key`, `id`, `tab`, `server`, `directory` and `visit` never change on
 * one object, and the other fields read this session's own data, never the route's. A render receives each new
 * object through its reactive input instead of remounting, so read `input.session` or `props.session` where you use
 * it rather than copying it. Key per-session state by `key`, which a move keeps. The workspace files, comments and
 * composer follow the route instead, so they belong to the screen: see `Screen`.
 */
export interface MountedSession extends SessionRef {
  /** This routing visit: a new object each time the session is routed, e.g. after Home and back; a move keeps it. */
  readonly visit: object
  /**
   * This session's project. `sandboxes` includes worktrees found on disk; `name` and `icon` carry the user's local
   * overrides. Reactive.
   */
  readonly project: Project | undefined
  /**
   * The sidebar project whose worktree or a sandbox is this session's directory, with the user's local name and
   * icon. Undefined when no listed project is opened there, e.g. for a session in a project subfolder. Reactive.
   */
  readonly listedProject:
    | {
        /** The project's root directory. */
        readonly worktree: string
        /** The user's local name for the project. */
        readonly name?: string
        /** The project's icon. */
        readonly icon?: Project["icon"]
      }
    | undefined
  /** The session's workspace directory. When the session moves, the next object carries the new one. */
  readonly directory: string
  /** The session runs in the project root rather than a worktree. Reactive. */
  readonly local: boolean
  /** Shell commands and subagents the session moved to the background; empty once another session is routed. */
  readonly background: readonly BackgroundTask[]
}

/**
 * The session screen: the app's view that shows the routed session, and stays the same object while it routes A, then
 * B, then A again. It follows the route on purpose: its files, comments and composer are the screen's workspace models,
 * and every action through them targets the session routed at that moment. Read it where you act, or pass it to the
 * views that render inside it; a `MountedSession` you keep never acts on another session.
 */
export interface SessionScreen {
  /** The routed workspace's files. */
  readonly file: Files
  /** The line comments of the routed session's next prompt. */
  readonly comment: Comments
  /** The routed session's composer. */
  readonly composer: Composer
}

/** The session screen, while it routes the mounted session. */
export interface Screen {
  /**
   * The mounted session screen: the same object for as long as it stays mounted, whichever session it routes. Defined
   * exactly when `Sessions.current()` is, after the screen's first render; undefined on Home, on a draft,
   * while the route has left the mounted screen, and before the app interface mounts. Panel callbacks and session
   * slots receive a non-null screen directly. Reactive.
   */
  current(): SessionScreen | undefined
}

/** The sessions of open shell tabs. */
export interface Sessions {
  /** Sessions owned by open shell tabs. Empty until the app interface mounts. Reactive. */
  list(): readonly SessionRef[]
  /**
   * The routed, mounted session: a new object each time a session is routed. Undefined on Home, on a draft, and
   * before the app interface mounts and during the screen's first render. Defined exactly when `Screen.current()`
   * is, after that first render. Panel and session-slot inputs are available during render directly.
   * Reactive.
   */
  current(): MountedSession | undefined
}

/**
 * Where a panel key stands in a session.
 * - `closed`: not in the strip (a dock: not open).
 * - `open`: in the strip, not selected.
 * - `active`: selected, with the side region closed.
 * - `visible`: selected and on screen (a dock: open).
 */
export type PanelState = "closed" | "open" | "active" | "visible"

/** How `Layout.open` places a tab. */
export interface OpenOptions {
  /**
   * How the tab lands in the strip. Defaults to `open`.
   * - `open`: select it, reusing the preview slot.
   * - `preview`: select it as the new preview tab.
   * - `append`: add it at the end without selecting it, changing neither the region nor the preview tab.
   * - `select`: add it at the end and select it, keeping the preview tab. Like `background`, it keeps the
   *   narrow-screen view and the dock, and opens the side region.
   */
  readonly tab?: "open" | "preview" | "append" | "select"
  /**
   * On narrow screens, keep the current view and the dock, and open the side region so the tab shows when the window
   * is wide. Pass it when the user stays where they are (a palette pick, a composer chip) or the agent opened the tab.
   * Defaults to false.
   */
  readonly background?: boolean
}

/**
 * The session layout: side panel tabs, the dock, scroll offsets, and the settings and project dialogs. Panel keys are
 * `${extension}:${tab id}`. Nothing throws before the app interface mounts: `ready()` is false, reads return what an
 * empty layout holds (each says its default), and writes (`open`, `close`, `toggle`, `side.toggle`, `scroll.set`,
 * `settings`, `project`) wait and apply in call order once it mounts.
 */
export interface Layout {
  /** Viewport under 768px. Reactive. */
  narrow(): boolean
  /** Stored layout (tabs, scroll) has loaded; false before the app interface mounts. Reactive. */
  ready(): boolean
  /**
   * Opens a panel tab. Works for sessions that are not mounted. A key of a `dock` panel opens the dock. On narrow
   * screens, an `open` or `preview` selects the panel's mobile view and closes the dock; opening a tab its panel does
   * not list, or a `transient` tab, stores nothing. A transient tab is never selected on narrow screens, but a stored
   * one stays the preview slot. Writes (`open`, `close`, `toggle`, `scroll.set`) made while `session.location` is
   * unknown wait until it is known, and apply in order.
   *
   * @param key - `${extension}:${tab id}`.
   * @param session - The session whose strip changes.
   * @param options - How the tab lands; see `OpenOptions`.
   */
  open(key: string, session: SessionRef, options?: OpenOptions): void
  /**
   * Removes a tab from the strip (closes the dock for a dock key) and calls its panel's `close`.
   *
   * @param key - `${extension}:${tab id}`.
   * @param session - The session whose strip changes.
   */
  close(key: string, session: SessionRef): void
  /**
   * Closes a visible tab, else opens it. Closing the last panel the side region was opened for also closes the region.
   *
   * @param key - `${extension}:${tab id}`.
   * @param session - The session whose strip changes.
   */
  toggle(key: string, session: SessionRef): void
  /**
   * Where a key stands. "closed" while the session's location is unknown and before the app interface mounts.
   * Reactive.
   *
   * @param key - `${extension}:${tab id}`.
   * @param session - Any session.
   */
  state(key: string, session: SessionRef): PanelState
  /**
   * This extension's tab ids stored in the session's side strip, mounted or not. Empty while the session's location
   * is unknown, as `state` is then "closed", and before the app interface mounts. Reactive.
   *
   * @param session - Any session.
   */
  stored(session: SessionRef): readonly string[]
  /** The side region. */
  readonly side: {
    /**
     * The side region is open; false before the app interface mounts. Reactive.
     *
     * @param session - Any session.
     */
    opened(session: SessionRef): boolean
    /**
     * Opens or closes the side region.
     *
     * @param session - Any session.
     */
    toggle(session: SessionRef): void
  }
  /**
   * The inner sidebar preference every side panel shares, which `usePanel().sidebar` also reads inside a panel render.
   * One value for the app, for code outside a render such as a tab's fields. Reactive.
   */
  readonly sidebar: {
    /** The inner sidebar is open; true until a session screen shows the preference. Reactive. */
    opened(): boolean
  }
  /** The dock, where `dock` panels render. */
  readonly dock: {
    /**
     * The dock is open; false before the app interface mounts. Reactive.
     *
     * @param session - Any session.
     */
    opened(session: SessionRef): boolean
    /**
     * Where the user placed the dock; `side`, the setting's default, before the app interface mounts. Reactive.
     * - `side`: beside the timeline.
     * - `bottom`: below the timeline.
     */
    placement(): "side" | "bottom"
  }
  /** Scroll offsets the host stores per session and key. */
  readonly scroll: {
    /**
     * The stored offset; undefined when none is stored, the location is unknown, or the app interface is not mounted.
     *
     * @param session - Any session.
     * @param key - Your own key, e.g. a panel key.
     */
    get(
      session: SessionRef,
      key: string,
    ):
      | {
          /** Horizontal offset in CSS pixels. */
          readonly x: number
          /** Vertical offset in CSS pixels. */
          readonly y: number
        }
      | undefined
    /**
     * Stores an offset. Waits while the session's location is unknown.
     *
     * @param session - Any session.
     * @param key - Your own key, e.g. a panel key.
     * @param value - The offset.
     */
    set(
      session: SessionRef,
      key: string,
      value: {
        /** Horizontal offset in CSS pixels. */
        readonly x: number
        /** Vertical offset in CSS pixels. */
        readonly y: number
      },
    ): void
  }
  /**
   * Opens Settings.
   *
   * @param page - A `SettingsPage` id you contributed, or a host page tab; defaults to `general`.
   */
  settings(page?: string): void
  /**
   * Opens a project on a server: a directory picker titled `title`, then a new draft. Waits until the server is listed.
   *
   * @param server - The server's `ServerRef.id`.
   * @param title - The picker's title.
   */
  project(server: string, title: string): void
}

/**
 * Where `Storage.store` keeps a value.
 * - `"global"`: one value for the app. The default.
 * - `{ server, directory? }`: one value per server, or per workspace directory on it. Opens once the app interface
 *   mounts; until then `value` is undefined and `update` waits.
 * - `{ session }`: one value per session. Also waits for the session's location, and opens again in a new directory;
 *   a declared `Store.session` does the same for every session.
 */
export type StorageScope =
  | "global"
  | {
      /** The server's `ServerRef.id`. */
      readonly server: string
      /** A workspace directory on that server; omit it for one value per server. */
      readonly directory?: string
    }
  | {
      /** The session. */
      readonly session: SessionRef
    }

/** What `Storage.store` opens. */
export interface StoreOptions<S extends Schema.ConstraintCodec<object, unknown>> {
  /** Decodes the stored JSON, as `StoreDeclaration.schema` does. */
  readonly schema: S
  /** The value before anything is stored, and after `remove`. */
  readonly initial: S["Type"]
  /** Where the value lives. Defaults to `"global"`. */
  readonly scope?: StorageScope
  /**
   * Imports an older host key of the same storage once (the raw stored key, e.g. "workspace:terminal"), or the first
   * of several that holds a value. With pick, only the picked part of the old JSON is copied and the old key stays for
   * its other owners.
   */
  readonly from?: StoreFrom | readonly StoreFrom[]
}

/**
 * Window storage, in the extension's namespace (`extension.<id>.<key>`). Synced across windows. On desktop it loads
 * over IPC, so a value is undefined until it loads; on the web it is synchronous.
 */
export interface Storage {
  /**
   * Opens a durable, schema-decoded store. For keys only known at runtime, such as one per server and directory;
   * declare `stores` in the definition for keys known up front. Derive nothing from it, such as a request, before
   * `value` is defined.
   *
   * @param key - The store's key in your namespace.
   * @param options - Its schema, initial value, scope and older homes.
   */
  store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: StoreOptions<S>): Persisted<S["Type"]>
  /**
   * Window-local state that survives extension reloads, but not a window reload. The first open of a key creates it;
   * later opens return the same store and ignore `initial`.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   * @returns The store and its setter, which edits a draft.
   */
  memory<T extends object>(
    key: string,
    options: {
      /** The value the first open creates. */
      readonly initial: T
    },
  ): readonly [Store<T>, (mutation: (draft: T) => void) => void]
  /**
   * Deletes the value, so opening the key again reads its `initial`. Pass the store's `scope` and `from`: an older key
   * `from` names is deleted too, so it is never imported again, and a key it picks a part of stays for its other owners
   * while the store keeps a marker that blocks the import. A server or session store's removal waits, in call order,
   * until the app interface mounts and the session's location is known.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's scope and older homes.
   */
  remove(
    key: string,
    options?: {
      /** The store's scope. Defaults to `"global"`. */
      readonly scope?: StorageScope
      /** The store's `from`. */
      readonly from?: StoreFrom | readonly StoreFrom[]
    },
  ): void
}

/** System services that work on every platform. */
export interface System {
  /**
   * Copies text to the clipboard.
   *
   * @param text - The text to copy.
   */
  copy(text: string): Promise<void>
  /**
   * Saves a file: a save dialog on desktop, a download on the web.
   *
   * @param file - The suggested name and the content.
   * @returns False when the user cancelled the desktop dialog; always true on the web.
   */
  save(file: {
    /** The suggested file name. */
    readonly name: string
    /** The file's content. */
    readonly content: string
  }): Promise<boolean>
  /**
   * Opens a URL in the system browser; desktop opens file:// URLs with the default app. For links inside the app,
   * use `Links.open`.
   *
   * @param url - The URL to open.
   */
  openExternal(url: string): void
}

/** Desktop-only abilities; `ctx.desktop` is undefined on the web. */
export interface Desktop {
  /** The operating system. */
  readonly os: OS
  /** This window's id. */
  readonly window: string
  /** The window's zoom factor; 1 is 100%. */
  zoom(): number
  /**
   * Opens a path with an app, or with the default app.
   *
   * @param path - An absolute path.
   * @param app - The app's name or path; omit it for the default app.
   */
  launch(path: string, app?: string): Promise<void>
  /**
   * Keeps the window focused for automation and debugging.
   *
   * @param enabled - Turns it on or off.
   */
  forceFocus(enabled: boolean): Promise<void>
  /**
   * Shows a path in the system file manager.
   *
   * @param path - An absolute path.
   * @returns False when it could not.
   */
  reveal(path: string): Promise<boolean>
  /**
   * Whether an app is installed.
   *
   * @param app - The app's name.
   */
  installed(app: string): Promise<boolean>
}

/** The interface language and its writing direction. */
export interface Locale {
  /** BCP 47 locale of the interface language, for Intl formatting. Reactive. */
  locale(): string
  /**
   * The writing direction. Reactive.
   * - `ltr`: left to right.
   * - `rtl`: right to left.
   */
  direction(): "ltr" | "rtl"
  /**
   * Overrides the writing direction.
   *
   * @param direction - `ltr` or `rtl`.
   */
  setDirection(direction: "ltr" | "rtl"): void
}

/** The user's appearance settings. */
export interface Appearance {
  /**
   * The CSS font family the user chose; the default mono font before the app interface mounts. Reactive.
   *
   * @param kind - `mono`, the terminal and code font.
   */
  font(kind: "mono"): string
}

/** The app's route. */
export interface Router {
  /** A route transition is in progress. Reactive. */
  routing(): boolean
  /** The current route path with its query string; "" before the app interface mounts. Reactive. */
  path(): string
}

/** The effective keybinds of published commands. */
export interface Keybinds {
  /**
   * Display parts of a published command's effective keybind, e.g. ["Ctrl", "`\"]. Empty when unbound. Reactive.
   *
   * @param command - A published command id, `${extension}.${id}`.
   */
  keybind(command: string): readonly string[]
  /**
   * Display parts of a chord the app does not own, e.g. "mod+shift+c" that a page handles itself.
   *
   * @param bind - A chord in keybind syntax.
   */
  keys(bind: string): readonly string[]
  /**
   * The event matches a published command's effective keybind.
   *
   * @param command - A published command id.
   * @param event - The keyboard event.
   */
  matches(command: string, event: KeyboardEvent): boolean
}

/** The servers the app lists. */
export interface Servers {
  /** Ids of the servers the app lists (`ServerRef.id`). Reactive. */
  list(): readonly string[]
  /**
   * A listed server's ref, already authenticated for this window: the desktop's own server included, whose credentials
   * stay in the main process. The same ref for the same id; read its `client` each time you call it. Reactive.
   *
   * @param id - The server's id, as `list()` returns it.
   * @returns Undefined while the app does not list the server, and before the app interface mounts.
   *
   * @example
   * ```ts
   * const builtin = () => ctx.servers.list().map((id) => ctx.servers.get(id)).find((server) => server?.builtin)
   * const info = () => builtin()?.client.server.info()
   * ```
   */
  get(id: string): ServerRef | undefined
}

/** Workspace lifecycle events. */
export interface Workspaces {
  /**
   * Listens to an event. The listener is removed with the current owner, else with the extension.
   *
   * @param event - `remove`: the user removed a workspace directory from a server.
   * @param handler - Receives the server's id and the directory.
   * @returns Removes the listener.
   */
  on(
    event: "remove",
    handler: (value: {
      /** The server's `ServerRef.id`. */
      readonly server: string
      /** The removed directory. */
      readonly directory: string
    }) => void,
  ): Cleanup
}

/** Routes local links to the extensions that handle them. */
export interface Links {
  /**
   * Routes a local link to the LinkHandler with the highest priority that matches it.
   *
   * @param link - The link to open.
   * @returns False when no handler matches.
   */
  open(link: Link): boolean
}

/** One dialog `Dialogs.open` opened. */
export interface DialogHandle {
  /**
   * Closes this dialog, wherever it is in the stack; another dialog stays open. A dialog that still waits for the app
   * interface never shows. Does nothing once the dialog closed, including when it never opened because its extension
   * went away first.
   */
  close(): void
}

/**
 * Dialogs. The render runs with this extension's context. A dialog closes when the owner that opened it ends (the
 * component or `createKeyed` run), else when the extension goes away.
 */
export interface Dialogs {
  /**
   * Opens a dialog above the open ones. Opening is deferred to a transition, so a dialog opened while its owner ends
   * never shows. Before the app interface mounts, as during setup, the dialog waits and shows after the interface's
   * first render, behind the writes made before it: never behind the startup screen, and never before the restored
   * route takes focus. A render that throws closes the dialog and records the error.
   *
   * @param render - Renders the dialog's content; receives the dialog's handle, so the content can close itself.
   * @param options - How the dialog opens.
   * @returns The dialog's handle.
   *
   * @example
   * ```ts
   * const dialog = ctx.dialogs.open((dialog) => <Confirm onDone={dialog.close} />)
   * ```
   */
  open(
    render: (dialog: DialogHandle) => JSX.Element,
    options?: {
      /** Closes every open dialog first, the host's and other extensions' too. Defaults to false. */
      readonly replace?: boolean
    },
  ): DialogHandle
  /** Some dialog is open. Reactive. */
  active(): boolean
}

/** Props of `Embeds.View`. */
export interface EmbedProps {
  /** An embed the extension's main entry created with `Embeds.create`. Undefined renders the box alone. */
  readonly id: string | undefined
  /** The embed should be on screen. The host also hides it while the window is hidden or a dialog is open. */
  readonly visible: boolean
  /** Paints a still of the embed in place of the live view, so DOM content can float above it. */
  readonly frozen?: boolean
  /** Radius of the bottom corners in CSS pixels. */
  readonly radius?: number
  /** CSS color the rounded corners show; defaults to the app backdrop behind the panel. */
  readonly background?: string
  /** Classes of the box. */
  readonly class?: string
  /** Rendered inside the box, under the embed. */
  readonly children?: JSX.Element
}

/** Web pages (Electron WebContentsViews) the extension's main entry placed in the window layout. */
export interface Embeds {
  /**
   * The box a main-process embed fills. The host measures it (webview zoom included), pushes
   * coalesced layouts, masks the rounded corners, hides the embed while it is invisible or unmounted,
   * and paints a still of it while floating content covers it. Children render inside the box.
   *
   * @param props - The embed and how to show it.
   */
  View(props: EmbedProps): JSX.Element
  /**
   * A JPEG still of a shown embed; undefined while it is hidden, and always on the web.
   *
   * @param id - The embed's id.
   */
  capture(id: string): Promise<Uint8Array | undefined>
}
