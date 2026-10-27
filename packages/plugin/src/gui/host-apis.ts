import type { Data } from "@opencode/client/solid"
import type { LocationRef, OpenCodeClient, ProjectListOutput, WorktreeDirectory } from "@opencode/client/promise"
import type { Schema } from "effect"
import type { JSX } from "solid-js"
import type { Store } from "solid-js/store"
import type { Cleanup, OS, Persisted, StoreFrom } from "./core.js"
import type { IconName, Link, SessionPanelMenuItem } from "./registries.js"

/**
 * A server the app lists. One ref per id that follows the live connection: read `client`, `data` and `url` from it
 * each time, as a restarted or re-authenticated server gets a new controller under the same id.
 */
export interface ServerRef {
  /** Host key: "sidecar", an http URL, or `${plugin}:${id}` for servers a plugin contributes. */
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
   * - `binary`: `bytes` holds the raw bytes, `content` is base64 when `encoding` says so, or empty when only `size` is known.
   */
  type: "text" | "binary"
  /** The text, or the base64 bytes of a binary file. */
  content: string
  /** The raw bytes of a binary file, when kept without base64 encoding. */
  bytes?: Uint8Array
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
  /** A URL the server streams the file from with range requests, set instead of `bytes` for images, audio and video. */
  url?: string
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
   * Loads the file's content, once unless forced, and asks the server to watch a workspace file for changes.
   *
   * @param path - A workspace path.
   * @param options - Load options.
   */
  sync(
    path: string,
    options?: {
      /** Reloads even when the content has loaded. Defaults to false. */
      readonly force?: boolean
      /** Suppresses the error toast when the load fails. Defaults to false. */
      readonly silent?: boolean
    },
  ): Promise<void>
  /**
   * Stops the server watch `sync` started, for a file whose tab closed.
   *
   * @param path - A workspace path.
   */
  unwatch(path: string): void
  /**
   * Whether a file exists, checked by listing its directory without reading the file.
   *
   * @param path - A workspace-relative or absolute path.
   * @returns False when the file is missing or its directory cannot be listed.
   */
  exists(path: string): Promise<boolean>
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
  /** The plugin that attached it. Opening the chip routes `Links.open({ href, origin })` to its LinkHandler. */
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

/**
 * Text the user quoted from something the plugin shows, such as terminal output, with an optional comment. It
 * renders like a quote from the session timeline, under the source's icon and label. The model reads "The user quoted
 * the following from <subject>:" and the text, each line prefixed with `> `, then the comment when there is one.
 */
export interface ComposerQuote {
  /** The part kind. */
  type: "quote"
  /** The id that `Composer.update`, `detach` and `focus` take. */
  commentID: string
  /** The quoted text, as plain text. */
  text: string
  /** The user's comment on the quote. Omit it to let the user add one from the chip. */
  comment?: string
  /** Where the text came from. It stays with the draft and the sent message. */
  source: {
    /** Chip text while the quote has no comment, e.g. `Terminal`. */
    readonly label: string
    /** Chip icon. */
    readonly icon: IconName
    /** Where the text came from, for the model, e.g. `the terminal`. Not localized. */
    readonly subject: string
  }
}

/** A model the composer sends a prompt with, as the model picker names it. */
export interface ComposerModel {
  /** The provider's id, e.g. `anthropic`. */
  providerID: string
  /** The model's id within its provider, e.g. `claude-sonnet-4-5`. */
  modelID: string
  /** The model's variant, e.g. `high`. Undefined for the model's default. */
  variant?: string
}

/**
 * The session screen's composer: the routed session's next prompt, with its text, its attached parts and the model it
 * is sent with. Nothing here sends the prompt; the user does. A write to the draft (`insert`, `setText`, `attach`,
 * `update`, `detach`) made before the session's stored draft loads waits for it, then applies to the session routed
 * when it was made, in call order with the other draft writes; the stored draft is never replaced.
 */
export interface Composer {
  /**
   * The prompt's text, as plain text: a mention reads as its `@` text, and attachments and attached parts are left
   * out. In shell mode, the shell command. Empty until the session's draft loads, and in a subagent's session, which
   * has no composer. Reactive.
   *
   * @example
   * const empty = () => screen.composer.text().trim() === ""
   */
  text(): string
  /**
   * Inserts plain text into the prompt as typing would, at the cursor the user last left in it, else at the end, and
   * moves the cursor after it. Selected text is not replaced. The text is not parsed: `@path` stays text rather than a
   * mention, and line breaks stay line breaks. Focus stays where it is; call `focus` to move it. Before the session's
   * draft loads, it waits and applies in call order. Does nothing in a subagent's session, which has no composer, or
   * for empty text.
   *
   * @param text - The text to insert.
   *
   * @example
   * screen.composer.insert(`Explain ${path}`)
   */
  insert(text: string): void
  /**
   * Replaces the prompt's text, mentions included, and moves the cursor to the end. Attachments and attached parts
   * stay. Before the session's draft loads, it waits and applies in call order. Does nothing in a subagent's session,
   * which has no composer.
   *
   * @param text - The new text. Empty clears the text.
   */
  setText(text: string): void
  /**
   * The model the next prompt is sent with: the user's choice for the routed session, else the session's agent
   * default, else the app's default. Undefined while the model catalog loads, when no connected provider offers the
   * choice, and in a subagent's session, which has no composer. Reactive.
   */
  model(): ComposerModel | undefined
  /**
   * Selects the model for the routed session's next prompts, as picking it in the model picker does: it becomes the
   * session's choice and the first recent model. Without `variant`, the model keeps the variant the picker would show
   * for it. Returns false, and changes nothing, while the model catalog loads, when no connected provider offers the
   * model, when the model has no such variant, and in a subagent's session.
   *
   * @param model - The model, and optionally its variant.
   */
  setModel(model: ComposerModel): boolean
  /**
   * Selects a variant of the current model, as the composer's variant control does. Returns false, and changes
   * nothing, when there is no current model, when the model has no such variant, and in a subagent's session.
   *
   * @param variant - The variant. Undefined selects the model's default.
   */
  setVariant(variant: string | undefined): boolean
  /**
   * Attaches a file, a note or a quote to the next prompt. Focus stays where it is; call `focus` to move it. Before
   * the session's draft loads, it waits and applies in call order.
   *
   * @param part - The part to attach.
   */
  attach(part: ComposerFile | ComposerNote | ComposerQuote): void
  /**
   * Whether the composer takes quotes now. False in a subagent's session, which has no composer, and while the
   * composer runs shell commands. Reactive.
   *
   * @example
   * if (screen.composer.quotable()) screen.composer.attach(quote)
   */
  quotable(): boolean
  /**
   * Moves focus to the prompt, at its cursor. With the `commentID` of an attached quote, opens that quote's comment
   * editor instead. While the composer is not shown, such as on a narrow screen showing a panel, the prompt keeps
   * its focus and the comment editor opens once the composer shows.
   *
   * @param commentID - The attached quote whose comment editor to open. Omit it to focus the prompt.
   */
  focus(commentID?: string): void
  /**
   * Changes an attached part. Files, notes and quotes alike; a note or a quote takes only `comment`. Before the
   * session's draft loads, it waits and applies in call order.
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
   * Removes an attached part. Before the session's draft loads, it waits and applies in call order.
   *
   * @param id - The part's `commentID`.
   */
  detach(id: string): void
  /**
   * Whether keyboard focus is in the prompt now. Not reactive: read it where you act, such as in `Command.run`.
   *
   * @example
   * run: () => (screen.composer.focused() ? send() : false)
   */
  focused(): boolean
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
 * - `closed`: not in the strip.
 * - `open`: in the strip, not the tab its pane shows.
 * - `active`: the tab its pane shows, with the pane hidden (the side region closed, or the bottom pane hidden).
 * - `visible`: the tab its pane shows, on screen.
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
   *   narrow-screen view, and opens the side region.
   */
  readonly tab?: "open" | "preview" | "append" | "select"
  /**
   * On narrow screens, keep the current view, and open the side region so the tab shows when the window
   * is wide. Pass it when the user stays where they are (a palette pick, a composer chip) or the agent opened the tab.
   * Defaults to false.
   */
  readonly background?: boolean
}

/**
 * The session layout: side panel tabs, scroll offsets, and the settings and project dialogs. Panel keys are
 * `${plugin}:${tab id}`. Nothing throws before the app interface mounts: `ready()` is false, reads return what an
 * empty layout holds (each says its default), and writes (`open`, `close`, `toggle`, `hide`, `side.toggle`, `scroll.set`,
 * `settings`, `project`) wait and apply in call order once it mounts.
 */
export interface Layout {
  /** Viewport under 768px. Reactive. */
  narrow(): boolean
  /** Stored layout (tabs, scroll) has loaded; false before the app interface mounts. Reactive. */
  ready(): boolean
  /**
   * Opens a panel tab. Works for sessions that are not mounted. On narrow screens, an `open` or `preview` selects the
   * panel's mobile view; opening a tab its panel does not list, or a `transient` tab, stores nothing. A transient tab
   * is never selected on narrow screens, but a stored one stays the preview slot. Writes (`open`, `close`, `toggle`, `scroll.set`) made while `session.location` is
   * unknown wait until it is known, and apply in order.
   *
   * @param key - `${plugin}:${tab id}`.
   * @param session - The session whose strip changes.
   * @param options - How the tab lands; see `OpenOptions`.
   */
  open(key: string, session: SessionRef, options?: OpenOptions): void
  /**
   * Removes a tab from the strip and calls its panel's `close`.
   *
   * @param key - `${plugin}:${tab id}`.
   * @param session - The session whose strip changes.
   */
  close(key: string, session: SessionRef): void
  /**
   * Closes a visible tab, else opens it. Closing the last panel the side region was opened for also closes the region.
   *
   * @param key - `${plugin}:${tab id}`.
   * @param session - The session whose strip changes.
   */
  toggle(key: string, session: SessionRef): void
  /**
   * Hides the pane that shows a visible tab without closing the tab: the side region for a tab in the side panes, the
   * bottom pane for a tab the user moved there. Does nothing unless `state` is "visible". Opening the tab again shows
   * its pane.
   *
   * @param key - `${plugin}:${tab id}`.
   * @param session - The session whose pane hides.
   */
  hide(key: string, session: SessionRef): void
  /**
   * Where a key stands. "closed" while the session's location is unknown and before the app interface mounts.
   * Reactive.
   *
   * @param key - `${plugin}:${tab id}`.
   * @param session - Any session.
   */
  state(key: string, session: SessionRef): PanelState
  /**
   * This plugin's tab ids stored in the session's side strip, mounted or not. Empty while the session's location
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
    /**
     * The + menu's items: every plugin's `session.panel` `MenuItem`, in `order`. Use it to list them on a page of
     * your own, such as a new tab page. Empty before the app interface mounts. Reactive.
     *
     * @example
     * ```ts
     * const launchers = () => ctx.layout.side.menu().filter((item) => !item.primary && !item.opened)
     * ```
     */
    menu(): readonly SessionPanelMenuItem[]
  }
  /**
   * The inner sidebar preference every side panel shares, which `usePanel().sidebar` also reads inside a panel render.
   * One value for the app, for code outside a render such as a tab's fields. Reactive.
   */
  readonly sidebar: {
    /** The inner sidebar is open; true until a session screen shows the preference. Reactive. */
    opened(): boolean
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
  /**
   * Opens a new draft session in a directory on a server with its prompt filled in, for the user to review and send.
   * The draft opens in its own tab, as a new session from Home does. Does nothing when the app does not list the
   * server.
   *
   * @param input - Where the draft runs and what it asks.
   *
   * @example
   * ```ts
   * ctx.layout.draft({ server: session.server.id, directory, prompt: ctx.t("setup.prompt") })
   * ```
   */
  draft(input: {
    /** The server's `ServerRef.id`. */
    readonly server: string
    /** The directory the new session runs in. */
    readonly directory: string
    /** The prompt the draft starts with. */
    readonly prompt: string
  }): void
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
   * Imports an older key of the same storage once (the raw stored key, e.g. `"plugin.acme.recent"`), or the first of
   * several that holds a value. See `StoreFrom`.
   */
  readonly from?: StoreFrom | readonly StoreFrom[]
}

/**
 * Window storage, in the plugin's namespace (`plugin.<id>.<key>`). Synced across windows. On desktop it loads
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
   * Window-local state that survives plugin reloads, but not a window reload. The first open of a key creates it;
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
   * `from` names is deleted too, so it is never imported again. A server or session store's removal waits, in call
   * order, until the app interface mounts and the session's location is known.
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
  /**
   * Asks the user for files or folders with the system's open dialog. Desktop only: a browser never tells the page
   * where a picked file is.
   *
   * @param options - What to pick.
   * @returns The absolute paths the user picked, in the order the dialog reports them; empty when the user cancelled.
   *   Rejects when the dialog cannot open.
   *
   * @example
   * ```ts
   * const [folder] = (await ctx.desktop?.pick({ directory: true, title: ctx.t("pick.folder") })) ?? []
   * ```
   */
  pick(options?: PickOptions): Promise<readonly string[]>
}

/** What `Desktop.pick` asks for. */
export interface PickOptions {
  /** Picks folders instead of files. Defaults to false. */
  readonly directory?: boolean
  /** Lets the user pick more than one. Defaults to false. */
  readonly multiple?: boolean
  /** The dialog's title; the system's default title when omitted. Not every system shows it. */
  readonly title?: string
  /** File extensions to offer, without the dot (e.g. `["json"]`); every file when omitted. Ignored for folders. */
  readonly extensions?: readonly string[]
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
}

/** The user's appearance settings. */
export interface Appearance {
  /**
   * The CSS font family the user chose; the default mono font before the app interface mounts. Reactive.
   *
   * @param kind - `mono`, the terminal font.
   */
  font(kind: "mono"): string
  /**
   * The color scheme the interface shows: the user's choice in Settings › Appearance, with "System" resolved to the
   * system's current scheme. Before the app interface mounts, the system's scheme. Reactive.
   * - `light`: dark text on light backgrounds.
   * - `dark`: light text on dark backgrounds.
   *
   * @example
   * ```ts
   * const background = () => (ctx.appearance.mode() === "dark" ? "#000" : "#fff")
   * ```
   */
  mode(): "light" | "dark"
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
   * Display parts of a published command's effective keybind, e.g. ["Ctrl", "K"]. Empty when unbound. Reactive.
   *
   * @param command - A published command id, `${plugin}.${id}`.
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
   * Listens to an event. The listener is removed with the current owner, else with the plugin.
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

/** Routes local links to the plugins that handle them. */
export interface Links {
  /**
   * Routes a local link to the LinkHandler with the highest priority that matches it.
   *
   * @param link - The link to open.
   * @returns False when no handler matches.
   */
  open(link: Link): boolean
  /**
   * Whether a link's target exists, so text that names it can be styled as a link. Asks the LinkHandler `open` would
   * use. Untracked: calling it inside an effect does not subscribe that effect.
   *
   * @param link - The candidate link.
   * @returns False when no handler matches, the handler has no `exists`, or the target does not exist.
   */
  exists(link: Link): boolean | Promise<boolean>
}

/** One dialog `Dialogs.open` opened. */
export interface DialogHandle {
  /**
   * Closes this dialog, wherever it is in the stack; another dialog stays open. A dialog that still waits for the app
   * interface never shows. Does nothing once the dialog closed, including when it never opened because its plugin
   * went away first.
   */
  close(): void
}

/**
 * Dialogs. The render runs with this plugin's context. A dialog closes when the owner that opened it ends (the
 * component or `createKeyed` run), else when the plugin goes away.
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
      /** Closes every open dialog first, the host's and other plugins' too. Defaults to false. */
      readonly replace?: boolean
    },
  ): DialogHandle
  /** Some dialog is open. Reactive. */
  active(): boolean
  /**
   * Asks the user to confirm an action, in the app's own confirmation dialog. Opens as `open` does, with the same
   * lifetime: it waits for the app interface, and closes with the owner that asked, else with the plugin.
   *
   * @param options - The question and its buttons.
   * @returns True only when the user chose the confirm button. False when they chose cancel, pressed Escape or clicked
   *   outside, when another dialog replaced it, and when it closed or never opened because its owner or plugin went
   *   away.
   *
   * @example
   * ```ts
   * if (await ctx.dialogs.confirm({ title: ctx.t("end.title"), confirm: ctx.t("end"), danger: true })) end()
   * ```
   */
  confirm(options: ConfirmOptions): Promise<boolean>
  /**
   * Tells the user something they must acknowledge, in a dialog with one button. Opens and closes as `confirm` does.
   *
   * @param options - What the dialog says.
   * @returns Resolves once the dialog closes, however it closes.
   *
   * @example
   * ```ts
   * await ctx.dialogs.alert({ title: ctx.t("export.done"), description: path })
   * ```
   */
  alert(options: AlertOptions): Promise<void>
  /**
   * Asks the user for a line of text, in the app's own dialog. Enter submits. Opens and closes as `confirm` does.
   *
   * @param options - The question, the field and its button.
   * @returns The text the user submits, which is never empty: the submit button and Enter do nothing while the field
   *   is empty. Undefined when the user cancels, dismisses the dialog, or it closes with its owner.
   *
   * @example
   * ```ts
   * const invite = await ctx.dialogs.prompt({ title: ctx.t("join.title"), placeholder: "https://…" })
   * ```
   */
  prompt(options: PromptOptions): Promise<string | undefined>
  /**
   * Asks the user to pick one option from a searchable list, in the app's own dialog, as the command palette lists
   * commands. Opens and closes as `confirm` does.
   *
   * @param options - The title, the search field and the options.
   * @returns The picked option's `value`; undefined when the user dismisses the dialog or it closes with its owner.
   *
   * @example
   * ```ts
   * const url = await ctx.dialogs.select({ title: ctx.t("links"), options: links.map((url) => ({ title: url, value: url })) })
   * ```
   */
  select<T>(options: SelectOptions<T>): Promise<T | undefined>
}

/** What `Dialogs.confirm` asks. */
export interface ConfirmOptions {
  /** The question, as the dialog's title. */
  readonly title: string
  /** More detail under the title, such as what the action cannot undo. Omit it for none. */
  readonly description?: string
  /** The confirm button's label. Defaults to the app's "Confirm". */
  readonly confirm?: string
  /** The cancel button's label. Defaults to the app's "Cancel". */
  readonly cancel?: string
  /**
   * Styles the confirm button as destructive, for an action that deletes or ends something, and starts focus on
   * Cancel. Defaults to false.
   */
  readonly danger?: boolean
}

/** What `Dialogs.alert` says. */
export interface AlertOptions {
  /** The headline, as the dialog's title. */
  readonly title: string
  /** More detail under the title. Omit it for none. */
  readonly description?: string
  /** The button's label. Defaults to the app's "OK". */
  readonly ok?: string
}

/** What `Dialogs.prompt` asks. */
export interface PromptOptions {
  /** The question, as the dialog's title. */
  readonly title: string
  /** More detail under the title. Omit it for none. */
  readonly description?: string
  /** The field's placeholder. Omit it for none. */
  readonly placeholder?: string
  /** The field's initial text, selected so typing replaces it. Defaults to "". */
  readonly value?: string
  /**
   * Hides what the user types, for a password or a token. The host neither stores nor logs the value. Defaults to
   * false.
   */
  readonly secret?: boolean
  /** The submit button's label. Defaults to the app's "Submit". */
  readonly submit?: string
}

/** One option of `Dialogs.select`. */
export interface SelectOption<T> {
  /** The option's label; search matches it. */
  readonly title: string
  /** What `select` resolves with when the user picks this option. */
  readonly value: T
  /** A muted second line; search matches it too. Omit it for none. */
  readonly description?: string
  /** The heading the option lists under. Options of one group list together, in the order first seen. */
  readonly group?: string
}

/** What `Dialogs.select` asks. */
export interface SelectOptions<T> {
  /** The dialog's title. */
  readonly title: string
  /** The search field's placeholder. Defaults to the app's "Search". */
  readonly placeholder?: string
  /** The options, in display order. */
  readonly options: readonly SelectOption<T>[]
  /** The value of the option to highlight first, compared with `===`. Defaults to the first option. */
  readonly current?: T
}

/** A button on a toast. */
export interface ToastAction {
  /** The button's label. */
  readonly label: string
  /** Runs when the user clicks it; the toast then closes. A throw is logged to the console and the toast still closes. */
  run(): void
}

/** What `Toasts.show` shows. */
export interface ToastOptions {
  /** The headline. */
  readonly title: string
  /** More detail under the title. Omit it for none. */
  readonly description?: string
  /**
   * The toast's tone. Defaults to `default`.
   * - `default`: neutral information.
   * - `success`: something finished; shows a check icon unless `icon` is set.
   * - `error`: something failed.
   * - `loading`: something is in progress. Pair it with `persistent` and dismiss it when the work ends.
   */
  readonly variant?: "default" | "success" | "error" | "loading"
  /** An icon before the title. Omit it for none, or the variant's own. */
  readonly icon?: IconName
  /** Milliseconds before the toast closes itself. Ignored when `persistent` is true. Defaults to the app's 5 seconds. */
  readonly duration?: number
  /** Stays until the user or `dismiss` closes it, instead of closing after `duration`. Defaults to false. */
  readonly persistent?: boolean
  /** Buttons on the toast, in order. Omit it for none. */
  readonly actions?: readonly ToastAction[]
}

/** One toast `Toasts.show` showed. */
export interface ToastHandle {
  /** Closes the toast. Does nothing once it closed. */
  dismiss(): void
}

/**
 * The app's toasts: short messages in a corner of the window that do not take focus. Every toast of a plugin that is
 * still showing closes when the plugin goes away (disabled, reloaded or removed), so no button outlives the code it
 * runs; a toast does not close with the component or `createKeyed` run that showed it.
 */
export interface Toasts {
  /**
   * Shows a toast at once, also before the app interface mounts: it appears as soon as the window shows its toasts.
   * Showing a toast equal to one still showing (same title, description, variant, duration, persistence and action
   * labels) replaces that one instead of stacking a copy.
   *
   * @param options - What the toast shows.
   * @returns The toast's handle.
   */
  show(options: ToastOptions): ToastHandle
}

/** What `Attention.notify` sends. */
export interface NotifyOptions {
  /** The notification's headline. */
  readonly title: string
  /** The notification's body. Omit it for none. */
  readonly message?: string
  /**
   * Which of the user's notification settings it follows, both the system notification and the sound. Defaults to
   * `default`.
   * - `default`: Settings › Notifications › Agent ("complete or needs attention") and its sound.
   * - `error`: Settings › Notifications › Errors and its sound.
   */
  readonly variant?: "default" | "error"
  /** The session the notification is about: clicking the notification opens and shows it, as `Tabs.open` does. */
  readonly session?: {
    /** The server's `ServerRef.id`. */
    readonly server: string
    /** The session's id on that server. */
    readonly id: string
  }
  /** Plays the sound the user chose for `variant`, when its sound is on. False never plays one. Defaults to true. */
  readonly sound?: boolean
  /**
   * Shows the notification and plays its sound at most once across the app's windows, each of which runs its own
   * instance of the plugin: the first window to send an id wins, and later sends with that id do nothing. Use an id
   * of the event, such as a run's id. Omit it to always notify.
   */
  readonly id?: string
}

/** What `Attention.notify` did. */
export interface NotifyResult {
  /**
   * The app asked the system to show the notification. False when the user turned it off for `variant`, when one of
   * the app's windows has focus, or when another window already sent `id`. The system may still hide one it was
   * asked to show, for example when the user denied a browser's permission.
   */
  readonly notification: boolean
  /** The sound started. False when `sound` is false, the user turned it off for `variant`, or `id` was sent before. */
  readonly sound: boolean
}

/** Gets the user's attention while they look elsewhere, with the same rules as the app's own notifications. */
export interface Attention {
  /**
   * Sends a system notification while no window of the app has focus, and plays a sound, each only when the user's
   * notification settings for `variant` allow it. Clicking the notification brings the window forward and opens
   * `session`, when given. Before the app interface mounts, it waits for it.
   *
   * @param options - What to send.
   * @returns What it did; never rejects.
   */
  notify(options: NotifyOptions): Promise<NotifyResult>
}

/** The commands the app runs from its command palette, keybinds and slash menu. */
export interface Commands {
  /**
   * Runs a command as choosing it in the command palette does: a published plugin command (`${plugin}.${id}`, any
   * plugin's) or one of the app's own. The app's command ids are not a stable API and may change between releases.
   * A command that is listed but disabled does not run. A command that runs async work is not awaited.
   *
   * @param id - The command's id.
   * @returns False when no enabled command has the id, and before the app interface mounts, when the app has
   *   registered no commands yet.
   */
  run(id: string): boolean
}

/** One tab of the shell's tab strip. */
export interface ShellTab {
  /** The tab's key, `SessionRef.tab` for a session's tab. Stays the same while the tab is open. */
  readonly key: string
  /** The session the tab shows; undefined for a draft. */
  readonly session: SessionRef | undefined
  /** The tab is the one on screen. */
  readonly active: boolean
}

/**
 * The shell's tab strip: the sessions and drafts open as tabs. Nothing throws before the app interface mounts:
 * `list` is empty, and writes wait and apply in call order once it mounts.
 */
export interface Tabs {
  /** The open tabs, in strip order. Reactive. */
  list(): readonly ShellTab[]
  /**
   * Opens a session as a tab at the end of the strip, or keeps its open tab where it is. A tab that shows the session
   * already, such as a subagent opened from its parent's tab, is its tab. Does nothing when the app does not list the
   * server. A session id the server does not know still opens a tab, which shows the app's "session not found" page.
   *
   * @param session - The session's server and id.
   * @param options - Whether to show the tab.
   *
   * @example
   * ```ts
   * ctx.tabs.open({ server: session.server.id, id: session.id }, { focus: true })
   * ```
   */
  open(
    session: {
      /** The server's `ServerRef.id`. */
      readonly server: string
      /** The session's id on that server. */
      readonly id: string
    },
    options?: {
      /**
       * Also shows the tab and the session in it, as clicking the session in the session list does. Defaults to
       * false: the tab opens in the background.
       */
      readonly focus?: boolean
    },
  ): void
  /**
   * Shows an open tab, as a click on it does. Does nothing when no open tab has the key.
   *
   * @param key - The tab's `ShellTab.key`.
   */
  focus(key: string): void
  /**
   * Moves an open tab to a place in the strip. Does nothing when no open tab has the key.
   *
   * @param key - The tab's `ShellTab.key`.
   * @param index - The tab's new place, from 0; clamped to the strip.
   */
  move(key: string, index: number): void
  /**
   * Closes an open tab, as the user does: it lists under recently closed tabs. Does nothing when no open tab has the key.
   *
   * @param key - The tab's `ShellTab.key`.
   */
  close(key: string): void
}

/** Props of `Embeds.View`. */
export interface EmbedProps {
  /** An embed the plugin's main entry created with `Embeds.create`. Undefined renders the box alone. */
  readonly id: string | undefined
  /** The embed should be on screen. The host also hides it while the window is hidden or a dialog is open. */
  readonly visible: boolean
  /** Paints a still of the embed in place of the live view, so DOM content can float above it. */
  readonly frozen?: boolean
  /**
   * What the embed shows, such as its URL. While a panel moves, the host paints a still of the embed in its place; a
   * still taken while this had another value is dropped rather than shown.
   */
  readonly page?: string
  /** Radius of the bottom corners in CSS pixels. */
  readonly radius?: number
  /** CSS color the rounded corners show; defaults to the app backdrop behind the panel. */
  readonly background?: string
  /** Classes of the box. */
  readonly class?: string
  /** Rendered inside the box, under the embed. */
  readonly children?: JSX.Element
}

/** Web pages (Electron WebContentsViews) the plugin's main entry placed in the window layout. */
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

/** Props of `Ui.Icon`. */
export interface UiIconProps {
  /** The artwork, by its name in the app's icon catalog. */
  readonly name: IconName
  /**
   * The icon's size. Defaults to `normal`.
   * - `small`: 14px.
   * - `normal`: 16px.
   * - `large`: 20px.
   */
  readonly size?: "small" | "normal" | "large"
  /** Classes of the `svg`, for layout and color: the icon draws in `currentColor`. */
  readonly class?: string
}

/** Props of `Ui.Button`. */
export interface UiButtonProps {
  /** The button's text. */
  readonly children: JSX.Element
  /** Runs when the user clicks the button, or presses Enter or Space on it. Not called while it is disabled or busy. */
  readonly onClick?: (event: MouseEvent) => void
  /**
   * How the button looks. Defaults to `neutral`.
   * - `neutral`: a bordered button for most actions.
   * - `contrast`: the main action of a dialog or form.
   * - `ghost`: no border or background until hovered, for toolbars.
   * - `ghost-muted`: like `ghost`, with muted text, for secondary toolbar actions.
   * - `danger`: an action that deletes or discards.
   */
  readonly variant?: "neutral" | "contrast" | "ghost" | "ghost-muted" | "danger"
  /**
   * The button's height. Defaults to `normal`.
   * - `small`: for dense rows.
   * - `normal`: for most places.
   * - `large`: for toolbars that use large icon buttons.
   */
  readonly size?: "small" | "normal" | "large"
  /** An icon before the text. Omit it for none. */
  readonly icon?: IconName
  /** The button cannot be clicked. Defaults to false. */
  readonly disabled?: boolean
  /**
   * The action is running: a loading indicator replaces the icon, and the button cannot be clicked until it is false
   * again. Defaults to false.
   */
  readonly busy?: boolean
  /** `submit` submits the form the button is in. Defaults to `button`. */
  readonly type?: "button" | "submit"
  /** Takes focus when its dialog opens, as the app's own dialogs focus their main button. Defaults to false. */
  readonly autofocus?: boolean
  /** Classes of the button, for layout. The app's styles give it its look. */
  readonly class?: string
}

/** Props of `Ui.IconButton`. */
export interface UiIconButtonProps {
  /** The button's icon. */
  readonly icon: IconName
  /** The button's accessible name, which screen readers announce. Pass translated copy; it is not shown. */
  readonly label: string
  /** Runs when the user clicks the button, or presses Enter or Space on it. Not called while it is disabled or busy. */
  readonly onClick?: (event: MouseEvent) => void
  /**
   * How the button looks. Defaults to `ghost-muted`.
   * - `neutral`: a bordered button.
   * - `ghost`: no border or background until hovered.
   * - `ghost-muted`: like `ghost`, with a muted icon, for toolbars.
   */
  readonly variant?: "neutral" | "ghost" | "ghost-muted"
  /**
   * The button's size. Defaults to `normal`.
   * - `small`: for dense rows.
   * - `normal`: for most places.
   * - `large`: for panel toolbars.
   */
  readonly size?: "small" | "normal" | "large"
  /** The button cannot be clicked. Defaults to false. */
  readonly disabled?: boolean
  /** The button is a toggle that is on: it shows pressed and reports `aria-pressed`. Omit it for a plain button. */
  readonly pressed?: boolean
  /**
   * The action is running: a loading indicator replaces the icon, and the button cannot be clicked until it is false
   * again. Defaults to false.
   */
  readonly busy?: boolean
  /** Classes of the button, for layout. The app's styles give it its look. */
  readonly class?: string
}

/** Props of `Ui.Tooltip`. */
export interface UiTooltipProps {
  /** What the tooltip shows: usually translated text. */
  readonly value: JSX.Element
  /** Keys shown after `value`, such as `ctx.keybinds.keybind(command)`. Omit it, or pass an empty list, for none. */
  readonly keys?: readonly string[]
  /** Where the tooltip opens from the element. Defaults to `top`; it flips when there is no room. */
  readonly placement?: "top" | "bottom" | "left" | "right"
  /** The element that shows the tooltip while the pointer rests on it or it has keyboard focus. */
  readonly children: JSX.Element
}

/** An action in `UiMenuProps.items`. */
export interface UiMenuItem {
  /** Marks the entry as an action. Optional: an entry without `type` is an action. */
  readonly type?: "item"
  /** The action's text. */
  readonly label: string
  /** An icon before the text. Omit it for none. */
  readonly icon?: IconName
  /** Keys shown at the end of the row, such as `ctx.keybinds.keybind(command)`. Omit it for none. */
  readonly keys?: readonly string[]
  /** The action cannot be chosen. Defaults to false. */
  readonly disabled?: boolean
  /** Runs when the user chooses the action; the menu then closes. */
  onSelect(): void
}

/** A line between entries in `UiMenuProps.items`. */
export interface UiMenuSeparator {
  /** Marks the entry as a separator. */
  readonly type: "separator"
}

/** Actions under a heading in `UiMenuProps.items`. */
export interface UiMenuGroup {
  /** Marks the entry as a group. */
  readonly type: "group"
  /** The group's heading. */
  readonly label: string
  /** The group's actions, in order. */
  readonly items: readonly UiMenuItem[]
}

/** One entry of `UiMenuProps.items`: an action, a separator, or a group of actions under a heading. */
export type UiMenuEntry = UiMenuItem | UiMenuSeparator | UiMenuGroup

/** Props of `Ui.Menu`. */
export interface UiMenuProps {
  /** The trigger's accessible name, and its text when `trigger` is `button`. Pass translated copy. */
  readonly label: string
  /** The menu's entries, in order. */
  readonly items: readonly UiMenuEntry[]
  /**
   * The button that opens the menu. Defaults to `icon`.
   * - `icon`: an icon button, as `Ui.IconButton` with the `ghost-muted` look.
   * - `button`: a button that shows `label`, as `Ui.Button`.
   */
  readonly trigger?: "icon" | "button"
  /** The trigger's icon. Defaults to the "more" dots for an `icon` trigger, and to no icon for a `button` trigger. */
  readonly icon?: IconName
  /** Where the menu opens from the trigger. Defaults to `bottom-end`; it flips when there is no room. */
  readonly placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end"
  /** The trigger cannot open the menu. Defaults to false. */
  readonly disabled?: boolean
}

/** Props of `Ui.Loader`. */
export interface UiLoaderProps {
  /**
   * The indicator's size. Defaults to `normal`.
   * - `small`: 14px, for buttons and dense rows.
   * - `normal`: 16px.
   * - `large`: 20px, for a pane that loads.
   */
  readonly size?: "small" | "normal" | "large"
  /** Classes of the indicator, for layout and color. */
  readonly class?: string
}

/** Props of `Ui.Dialog`. */
export interface UiDialogProps {
  /** The dialog's title, which also names it for screen readers. */
  readonly title: string
  /** Text under the title. Omit it for none. */
  readonly description?: string
  /** The dialog's content, with the app's dialog padding. It scrolls when it is taller than the dialog. */
  readonly children?: JSX.Element
  /** The dialog's buttons, aligned to the end of its last row. Omit it for none. */
  readonly footer?: JSX.Element
  /**
   * The dialog's size. Defaults to `fit`.
   * - `fit`: 480px wide and as tall as its content.
   * - `normal`: 480 by 368px.
   * - `large`: 640 by 480px.
   * - `x-large`: up to 980 by 600px, smaller in a small window.
   */
  readonly size?: "fit" | "normal" | "large" | "x-large"
  /**
   * Shows the close button in the header, labelled with the app's "Close". Escape and a click outside close the dialog
   * either way. Defaults to true.
   */
  readonly closable?: boolean
}

/** Props of `Ui.Switch`. */
export interface UiSwitchProps {
  /** The switch is on. */
  readonly checked: boolean
  /** Runs with the new state when the user flips the switch. Pass it on to `checked` to keep the switch in step. */
  readonly onChange: (checked: boolean) => void
  /** The switch's label, which also names it for screen readers. Pass translated copy. */
  readonly label: string
  /** Hides the label from view and keeps it for screen readers, for a row that shows its own text. Defaults to false. */
  readonly hideLabel?: boolean
  /** Text under the label. Omit it for none. */
  readonly description?: string
  /** The switch cannot be flipped. Defaults to false. */
  readonly disabled?: boolean
}

/** Props of `Ui.TextInput`. */
export interface UiTextInputProps {
  /** The field's text. */
  readonly value: string
  /** Runs with the field's text on every edit. Pass it on to `value` to keep the field in step. */
  readonly onInput: (value: string) => void
  /** The field's accessible name, which screen readers announce. Pass translated copy; it is not shown. */
  readonly label: string
  /** Text the empty field shows. Omit it for none. */
  readonly placeholder?: string
  /** Runs with the field's text when the user presses Enter, except while an input method composes text. */
  readonly onSubmit?: (value: string) => void
  /**
   * What the field holds. Defaults to `text`.
   * - `text`: plain text.
   * - `password`: hidden text.
   * - `search`: a search query.
   * - `url`: a web address.
   */
  readonly type?: "text" | "password" | "search" | "url"
  /**
   * The field's height. Defaults to `normal`.
   * - `normal`: 28px.
   * - `large`: 32px, as in dialogs.
   */
  readonly size?: "normal" | "large"
  /** The field cannot be edited. Defaults to false. */
  readonly disabled?: boolean
  /** Shows the field as invalid and reports `aria-invalid`. Defaults to false. */
  readonly invalid?: boolean
  /** Takes focus when its dialog opens. Defaults to false. */
  readonly autofocus?: boolean
  /** Classes of the field, for layout. The app's styles give it its look. */
  readonly class?: string
}

/** Props of `Ui.Keybind`. */
export interface UiKeybindProps {
  /** The keys, one chip each, as `Keybinds.keybind` and `Keybinds.keys` return them. Empty shows nothing. */
  readonly keys: readonly string[]
  /** Classes of the chips' row, for layout. */
  readonly class?: string
}

/** Props of `Ui.Markdown`. */
export interface UiMarkdownProps {
  /** The Markdown source. */
  readonly text: string
  /** Classes of the rendered block, such as a text size. */
  readonly class?: string
}

/** Props of `Ui.Code`. */
export interface UiCodeProps {
  /** The code, shown as it is. */
  readonly content: string
  /**
   * The language to highlight, by a highlighter id or a common alias (`ts`, `tsx`, `py`, `json`, `bash`). A language
   * the app cannot highlight shows plain text; `mermaid` draws the diagram, as the timeline does. Defaults to plain
   * text.
   */
  readonly language?: string
  /** Classes of the code block, for layout. */
  readonly class?: string
}

/**
 * The app's own components, so a plugin's UI looks and behaves like the app's: the same buttons, menus, dialogs and
 * fields, in the user's theme, fonts and language. Each takes a small set of props the SDK keeps stable. A component
 * renders with the context of the plugin that renders it, and works in any of its contributions and dialogs.
 */
export interface Ui {
  /**
   * An icon from the app's catalog, the artwork every `icon` field of the SDK names.
   *
   * @param props - The icon and its size.
   *
   * @example
   * ```tsx
   * <ctx.ui.Icon name="branch" size="small" />
   * ```
   */
  Icon(props: UiIconProps): JSX.Element
  /**
   * A button with text.
   *
   * @param props - Its text, look and action.
   *
   * @example
   * ```tsx
   * <ctx.ui.Button variant="contrast" busy={saving()} onClick={save}>{ctx.t("save")}</ctx.ui.Button>
   * ```
   */
  Button(props: UiButtonProps): JSX.Element
  /**
   * A button that shows only an icon. Wrap it in `Tooltip` to show its label on hover.
   *
   * @param props - Its icon, accessible name and action.
   *
   * @example
   * ```tsx
   * <ctx.ui.IconButton icon="outline-rotate-clockwise" label={ctx.t("reload")} onClick={reload} />
   * ```
   */
  IconButton(props: UiIconButtonProps): JSX.Element
  /**
   * A tooltip on an element.
   *
   * @param props - What it shows, and the element.
   *
   * @example
   * ```tsx
   * <ctx.ui.Tooltip value={ctx.t("toggle")} keys={ctx.keybinds.keybind(`${ctx.id}.toggle`)}>
   *   <ctx.ui.IconButton icon="sidebar" label={ctx.t("toggle")} onClick={toggle} />
   * </ctx.ui.Tooltip>
   * ```
   */
  Tooltip(props: UiTooltipProps): JSX.Element
  /**
   * A button that opens a menu of actions.
   *
   * @param props - The trigger and the entries.
   *
   * @example
   * ```tsx
   * <ctx.ui.Menu label={ctx.t("more")} items={[{ label: ctx.t("delete"), icon: "trash", onSelect: remove }]} />
   * ```
   */
  Menu(props: UiMenuProps): JSX.Element
  /**
   * The app's loading indicator, for anything that loads, connects or runs that is not the AI working.
   *
   * @param props - Its size.
   *
   * @example
   * ```tsx
   * <Show when={!loading()} fallback={<ctx.ui.Loader />}>{content()}</Show>
   * ```
   */
  Loader(props: UiLoaderProps): JSX.Element
  /**
   * The app's dialog frame: title, content and buttons. Render it from `ctx.dialogs.open`; it renders nothing useful
   * elsewhere.
   *
   * @param props - The title, content and buttons.
   *
   * @example
   * ```tsx
   * ctx.dialogs.open((dialog) => (
   *   <ctx.ui.Dialog title={ctx.t("about")} footer={<ctx.ui.Button onClick={dialog.close}>{ctx.t("done")}</ctx.ui.Button>}>
   *     {ctx.t("about.body")}
   *   </ctx.ui.Dialog>
   * ))
   * ```
   */
  Dialog(props: UiDialogProps): JSX.Element
  /**
   * An on/off switch with a label.
   *
   * @param props - Its state, label and handler.
   *
   * @example
   * ```tsx
   * <ctx.ui.Switch label={ctx.t("wrap")} checked={wrap()} onChange={setWrap} />
   * ```
   */
  Switch(props: UiSwitchProps): JSX.Element
  /**
   * A one-line text field.
   *
   * @param props - Its text, accessible name and handlers.
   *
   * @example
   * ```tsx
   * <ctx.ui.TextInput label={ctx.t("name")} value={name()} onInput={setName} onSubmit={save} />
   * ```
   */
  TextInput(props: UiTextInputProps): JSX.Element
  /**
   * Keys shown as chips, as menus and tooltips show shortcuts.
   *
   * @param props - The keys.
   *
   * @example
   * ```tsx
   * <ctx.ui.Keybind keys={ctx.keybinds.keybind(`${ctx.id}.toggle`)} />
   * ```
   */
  Keybind(props: UiKeybindProps): JSX.Element
  /**
   * Markdown rendered as the timeline renders a message: headings, lists, tables, links, math and highlighted code
   * blocks with a copy button. On the session screen, links to local files open through the LinkHandler
   * contributions, as the timeline's do. Rendering is asynchronous: the block fills in shortly after it mounts.
   *
   * @param props - The Markdown source.
   *
   * @example
   * ```tsx
   * <ctx.ui.Markdown text={summary()} />
   * ```
   */
  Markdown(props: UiMarkdownProps): JSX.Element
  /**
   * A read-only code block, highlighted as the timeline highlights code, with a copy button. Highlighting is
   * asynchronous: the block fills in shortly after it mounts.
   *
   * @param props - The code and its language.
   *
   * @example
   * ```tsx
   * <ctx.ui.Code content={JSON.stringify(config, null, 2)} language="json" />
   * ```
   */
  Code(props: UiCodeProps): JSX.Element
}
