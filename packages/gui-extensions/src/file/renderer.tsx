import {
  batch,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  Show,
  Suspense,
  type ParentProps,
  type Signal,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { encodeFilePath, getFilename } from "@opencode/util/path"
import {
  createKeyed,
  bindExtension,
  LinkHandler,
  MenuItem,
  Panel,
  Slot,
  Style,
  usePanel,
  type Files,
  type LineRange,
  type Link,
  type OpenOptions,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
  type Setup,
  onIdle,
} from "../sdk"
import { artifactKind } from "@opencode/util/artifact"
import { resolveArtifactPath } from "./artifact"
import { FileContext, type FileShared } from "./context"
import type { OpenApp } from "./apps"
import { FileTree, OpenInApp } from "./contract"
import type File from "./index"
import { FileVisual } from "./label"
import { fileTabId, fileTabPath, isFileTab, workspaceFileUrl } from "./path"
import tabStyles from "./tabs.css?inline"

const OPEN = "open"

const GROUP = "browser"

const TABPANEL = "session-side-panel-file-browser-tabpanel"

const HANDOFF_SESSIONS = 40

const FILTER_SESSIONS = 40

const DEFAULT_LINE_HEIGHT = 24

type Handoff = { sessions: Record<string, Record<string, LineRange | null>> }

type StyleLoad = { loaded?: Promise<void> }

const setup: Setup<typeof File> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const storage = ctx.storage
  const desktop = ctx.desktop
  const tree = ctx.stores.tree
  const [handoff, setHandoff] = storage.memory<Handoff>("handoff", { initial: { sessions: {} } })
  const preference = desktop ? ctx.stores.app : undefined
  const [request, setRequest] = createStore<{ app?: OpenApp }>({})

  const [filters, setFilters] = createStore<Record<string, { text: string; browsing: boolean } | undefined>>({})

  const revealListeners = new Map<string, Set<() => void>>()
  let clickController: AbortController | undefined

  // Tab objects per session screen, which stays while it routes another session, reused so neither strip updates nor a
  // session switch rebuild a trigger. `close` prunes them.
  const tabs = new WeakMap<SessionScreen, Map<string, PanelTab>>()

  const tabsOf = (screen: SessionScreen) => {
    const existing = tabs.get(screen)

    if (existing) return existing

    const created = new Map<string, PanelTab>()

    tabs.set(screen, created)

    return created
  }

  // The file tab each session screen last selected, for reloads the side panel does not see.
  const focused = new WeakMap<SessionScreen, string>()

  const key = (files: Files, path: string) => `file:${fileTabId(files, path)}`

  const active = (session: MountedSession, id: string) => {
    const state = layout.state(`file:${id}`, session)

    return state === "active" || state === "visible"
  }

  const updateFilter = (session: string, patch: { text?: string; browsing?: boolean }) => {
    setFilters(
      produce((draft) => {
        const current = draft[session]
        const text = patch.text ?? current?.text ?? ""
        const browsing = patch.browsing ?? current?.browsing ?? false
        delete draft[session]

        if (!text && !browsing) return
        draft[session] = { text, browsing }
        const keys = Object.keys(draft)

        keys.slice(0, Math.max(0, keys.length - FILTER_SESSIONS)).forEach((item) => delete draft[item])
      }),
    )
  }

  // Opens on the session screen, whose file model serves the routed session `session` is.
  const open = (session: MountedSession, path: string, options?: OpenOptions) => {
    const screen = ctx.screen.current()

    if (!screen) return

    // Not batched: the mobile tab strip must register the new tab before it leaves the browser, or Kobalte falls back
    // to the first tab and reselects it.
    layout.open(key(screen.file, path), session, options)
    updateFilter(session.key, { browsing: false })
    void screen.file.sync(path)
  }

  const applySelection = (session: MountedSession, files: Files, path: string, selection: LineRange | undefined) => {
    if (!selection || artifactKind(path) !== "text") return

    const tabKey = key(files, path)
    const existing = layout.scroll.get(session, tabKey)

    files.selection.set(path, selection)
    layout.scroll.set(session, tabKey, {
      x: existing?.x ?? 0,
      y: Math.max(0, (selection.start - 4) * DEFAULT_LINE_HEIGHT),
    })
    shared.reveal.run(session.key, path)
  }

  const openPicker = (session: MountedSession, query: string, options?: OpenOptions) => {
    batch(() => {
      updateFilter(session.key, { text: query, browsing: true })
      layout.open(`file:${OPEN}`, session, { tab: "preview", background: options?.background })

      if (!options?.background && layout.narrow() && !layout.side.opened(session)) layout.side.toggle(session)
    })

    if (options?.background) return

    queueMicrotask(() => {
      const element = shared.filter.element

      if (element?.isConnected) return element.focus()

      shared.filter.pending = true
    })
  }

  const shared: FileShared = {
    changes: ctx.uses.changes,
    browser: ctx.uses.browser,
    tree: {
      tab: () => tree.value.tab,
      setTab: (tab) =>
        tree.update((draft) => {
          draft.tab = tab
        }),
    },
    filter: {
      get: (session) => filters[session]?.text ?? "",
      set: (session, value) => updateFilter(session, { text: value }),
      browsing: (session) => filters[session]?.browsing ?? false,
      setBrowsing: (session, value) => updateFilter(session, { browsing: value }),
    },
    installed: new Map(),
    app: preference && {
      current: () => preference.value.app,
      set: (app) =>
        preference.update((draft) => {
          draft.app = app
        }),
    },
    request: {
      app: () => request.app,
      set: (app) => setRequest("app", app),
    },
    handoff: {
      get: (session, path) => handoff.sessions[session]?.[path],
      set: (session, files) =>
        setHandoff((draft) => {
          delete draft.sessions[session]
          draft.sessions[session] = files
          const keys = Object.keys(draft.sessions)

          keys.slice(0, Math.max(0, keys.length - HANDOFF_SESSIONS)).forEach((item) => delete draft.sessions[item])
        }),
    },
    reveal: {
      register(session, path, run) {
        const targetKey = `${session}\n${path}`
        const set = revealListeners.get(targetKey) ?? new Set()
        set.add(run)
        revealListeners.set(targetKey, set)

        return () => {
          set.delete(run)

          if (set.size === 0) revealListeners.delete(targetKey)
        }
      },
      run(session, path) {
        revealListeners.get(`${session}\n${path}`)?.forEach((fn) => fn())
      },
    },
    active,
    open,
  }

  const FileProvider = (props: ParentProps) => (
    <FileContext.Provider value={shared}>{props.children}</FileContext.Provider>
  )

  // Tab trigger styles render with the strip, before any panel chunk loads.
  ctx.add(Style, tabStyles)

  const style: StyleLoad = {}

  const styled = <T,>(module: Promise<T>) => {
    style.loaded ??= import("./styles").then((css) => void ctx.add(Style, css.default))

    return Promise.all([module, style.loaded]).then(([value]) => value)
  }

  const FileBrowser = lazy(() => styled(import("./browser")))
  const MobileFiles = lazy(() => styled(import("./mobile")))
  const Sidebar = lazy(() => styled(import("./sidebar")))
  const Tree = lazy(() => styled(import("./tree-v2")))
  const List = lazy(() => styled(import("./list")))

  onCleanup(
    onIdle(() => {
      void FileBrowser.preload()
      void Sidebar.preload()
      void Tree.preload()
      void List.preload()
      void import("./resolve-link")

      if (layout.narrow()) void MobileFiles.preload()
    }),
  )

  const launcher: PanelTab = {
    id: OPEN,
    get title() {
      return ctx.t("command.open")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="file-tree" size="small" />
        <span>{ctx.t("command.open")}</span>
      </div>
    ),
    draggable: false,
    closable: "hover",
    transient: true,
    group: GROUP,
    dom: { panel: TABPANEL },
  }

  const fileTab = (files: Files, id: string): PanelTab => {
    const path = () => fileTabPath(files, id)
    const missing = () => files.missing(path())

    return {
      id,
      get title() {
        const name = getFilename(path())

        return missing() ? ctx.t("tab.notFound", { name }) : name
      },
      label: (state) => <FileVisual path={path()} temporary={state.preview} notFound={missing()} />,
      get missing() {
        return missing()
      },
      get file() {
        return path()
      },
      group: GROUP,
      // A gone selection falls back to the first file tab.
      fallback: true,
      dom: { panel: TABPANEL },
    }
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    legacy: { "open-file": OPEN },
    // Older builds stored some files as absolute paths; one file is one tab once the workspace root is known.
    // Resolves the stored URL once and encodes the result, so an encoded name such as a%23b.txt stays one file.
    normalize: (input) =>
      isFileTab(input.id) && input.screen.file.ready()
        ? `//${encodeFilePath(fileTabPath(input.screen.file, input.id))}`
        : input.id,
    mobile: {
      get title() {
        return ctx.t("mobile.title")
      },
      order: 20,
      kind: "menu",
      icon: "folder",
    },
    list(input) {
      return input.open.flatMap((id) => {
        if (id === OPEN) return [launcher]

        if (!isFileTab(id)) return []

        const cache = tabsOf(input.screen)
        const existing = cache.get(id)

        if (existing) return [existing]

        const created = fileTab(input.screen.file, id)

        cache.set(id, created)

        return [created]
      })
    },
    close(input) {
      tabs.get(input.screen)?.delete(input.tab.id)
    },
    render: (props) => {
      const panel = usePanel()

      return (
        <FileProvider>
          <Suspense>
            <Show
              when={panel.placement() === "mobile"}
              fallback={<FileBrowser tab={() => props.tab} session={props.session} screen={props.screen} />}
            >
              <MobileFiles session={props.session} screen={props.screen} />
            </Show>
          </Suspense>
        </FileProvider>
      )
    },
    focus(input) {
      if (!isFileTab(input.tab.id)) return

      focused.set(input.screen, input.tab.id)
      void input.screen.file.sync(fileTabPath(input.screen.file, input.tab.id))

      // A restored file tab keeps the tree tab the user left, e.g. Changes across a reload.
      if (!input.restored && tree.value.tab === "changes") shared.tree.setTab("all")
    },
  })

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open",
    get title() {
      return ctx.t("command.open")
    },
    icon: "file-tree",
    keybind: "file.open",
    order: 10,
    run() {
      const session = sessions.current()

      if (!session) return

      openPicker(session, shared.filter.get(session.key))
    },
  })

  const OpenInAppButton = lazy(() => import("./open-in-app"))

  // How many "Open in" buttons each screen's panel headers show; the tab strip shows its own only while none do.
  const headers = new WeakMap<SessionScreen, Signal<number>>()

  const headerButtons = (screen: SessionScreen) => {
    const existing = headers.get(screen)

    if (existing) return existing

    const created = createSignal(0)

    headers.set(screen, created)

    return created
  }

  if (desktop) {
    onCleanup(onIdle(() => void OpenInAppButton.preload()))
    ctx.add(Slot, {
      at: "session.panel.end",
      render: (input) => (
        <Show when={headerButtons(input.screen)[0]() === 0}>
          <FileProvider>
            <Suspense>
              <OpenInAppButton session={input.session} screen={input.screen} />
            </Suspense>
          </FileProvider>
        </Show>
      ),
    })
  }

  ctx.provide(OpenInApp, {
    Button: bindExtension((props) => {
      const count = headerButtons(props.screen)

      count[1]((value) => value + 1)
      onCleanup(() => count[1]((value) => value - 1))

      return (
        <Show when={desktop}>
          <FileProvider>
            <Suspense>
              <OpenInAppButton session={props.session} screen={props.screen} />
            </Suspense>
          </FileProvider>
        </Show>
      )
    }),
  })

  ctx.add(Slot, {
    at: "session.panel.sidebar",
    render: (input) => (
      <FileProvider>
        <Suspense>
          <Sidebar session={input.session} screen={input.screen} />
        </Suspense>
      </FileProvider>
    ),
  })

  // The review panel lists its changed files with the browser's tree; it renders under this extension, on the
  // session screen's file model.
  ctx.provide(FileTree, {
    Tree: bindExtension((props) => (
      <FileProvider>
        <Suspense>
          <Tree
            session={props.session}
            screen={props.screen}
            allowed={props.allowed}
            kinds={props.kinds}
            draggable={false}
            active={props.active}
            onFileClick={(node) => props.onFileClick(node.path)}
          />
        </Suspense>
      </FileProvider>
    )),
    List: bindExtension((props) => (
      <FileProvider>
        <Suspense>
          <List
            session={props.session}
            screen={props.screen}
            files={props.files}
            kinds={props.kinds}
            active={props.active}
            highlighted={props.highlighted}
            onFileClick={(path) => props.onFileClick(path)}
          />
        </Suspense>
      </FileProvider>
    )),
  })

  /**
   * Turn a link into a path the file model can load: workspace-relative when it is under the root,
   * otherwise absolute. Relative links resolve against `base`; ones that climb past the root
   * become absolute too, so a `../../shared/report.pdf` still opens.
   */
  const resolve = (files: Files, value: string, base?: string) => {
    const root = files.root.replaceAll("\\", "/").replace(/\/+$/, "")

    if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return files.resolve(value)

    const relative = resolveArtifactPath(base ?? "", value)

    if (relative !== undefined) return files.resolve(relative)

    // Climbing past the workspace root: resolve from the referencing folder's absolute location.
    const dir = base ? `${root}/${base.replace(/\/+$/, "")}` : root

    return files.resolve(resolveArtifactPath(dir, value) ?? value)
  }

  // Messages style a path as a link only when this says the file exists.
  const linkExists = (link: Link): boolean | Promise<boolean> => {
    const session = sessions.current()
    const files = ctx.screen.current()?.file

    if (!session || !files || (link.session && link.session.key !== session.key)) return false

    return import("./resolve-link")
      .then(({ checkFileLinkExists, parseFileLink }) => {
        if (link.base === undefined) return checkFileLinkExists({ files, href: link.href, signal: ctx.signal })

        // A link in a previewed document opens relative to it, so only that path counts.
        const path = parseFileLink(link.href).path
        const direct = path.startsWith("//") || path.startsWith("~") ? undefined : resolve(files, path, link.base)

        return direct ? files.exists(direct) : false
      })
      .catch(() => false)
  }

  // Opens files the agent references as side panel tabs, inside or outside the workspace, or as
  // a browser tab for HTML when the desktop can load the file directly.
  ctx.add(LinkHandler, {
    match: () => true,
    exists: linkExists,
    open(link) {
      const session = sessions.current()
      const screen = ctx.screen.current()
      const files = screen?.file

      if (!session || !screen || !files || (link.session && link.session.key !== session.key)) return

      clickController?.abort()

      // A known workspace file (the palette, a file comment) opens at once with every file listed.
      if (link.exact || link.origin === "file") {
        const path = files.resolve(link.href)

        if (!path) return

        batch(() => {
          open(session, path, { background: link.background })
          shared.tree.setTab("all")
        })

        return
      }

      const controller = new AbortController()
      clickController = controller
      const signal = AbortSignal.any([ctx.signal, controller.signal])
      const sessionKey = session.key

      const stillCurrent = () => {
        const current = sessions.current()

        return !signal.aborted && current?.key === sessionKey && ctx.screen.current() === screen ? current : undefined
      }

      const openResolvedFile = (targetPath: string, selection?: LineRange) => {
        const routed = stillCurrent()

        if (!routed) return Promise.resolve()

        // The browser pane shows HTML it can load. While it is pending or off, the file opens as a tab instead.
        const pane = ctx.uses.browser()

        if (artifactKind(targetPath) === "html" && pane.status === "active" && pane.value.canOpen(routed, targetPath)) {
          pane.value.open(routed, workspaceFileUrl(files.root, targetPath))

          return Promise.resolve()
        }

        // Confirm the file exists before a tab appears for it; a file deleted since its link rendered shows the load
        // error. Always reread: a cached copy can be stale.
        return files.sync(targetPath, { force: true }).then(() => {
          const latest = stillCurrent()

          if (!latest || !files.get(targetPath)?.loaded) return

          batch(() => {
            applySelection(latest, files, targetPath, selection)
            layout.open(key(files, targetPath), latest, { background: link.background })

            // A tapped link switches the narrow-screen view; the side region still opens for when the window is wide.
            if (layout.narrow() && !layout.side.opened(latest)) layout.side.toggle(latest)
          })
          // After the batch, as in `open`: the mobile tab strip registers the tab before it leaves the browser.
          updateFilter(latest.key, { browsing: false })
        })
      }

      void (async () => {
        const { findFileLink, isAbsoluteLink, parseFileLink } = await import("./resolve-link")

        if (!stillCurrent()) return

        const parsed = parseFileLink(link.href)
        const direct = resolve(files, parsed.path, link.base)

        if (!direct) return

        // Absolute paths, links written relative to a document, and agent previews name one exact file.
        if (isAbsoluteLink(parsed.path) || link.base !== undefined || link.background) {
          await openResolvedFile(direct, parsed.selection)

          return
        }

        const target = await findFileLink({ files, path: parsed.path, signal })
        const latest = stillCurrent()

        if (!latest) return

        if (target?.kind === "picker") {
          openPicker(latest, target.query)

          return
        }

        // With no match, the literal path still covers files the search index skips, such as an ignored `.env`.
        await openResolvedFile(target?.path ?? direct, parsed.selection)
      })()
    },
  })

  // Review reveals a change: the tree shows the changed files.
  createKeyed(ctx.uses.changes, (changes) => onCleanup(changes.onReveal(() => shared.tree.setTab("changes"))))

  // A new workspace directory drops loaded files; reload the selected file tab.
  const root = createMemo<string | undefined>((previous) => ctx.screen.current()?.file.root ?? previous)

  const moved = createMemo(on(root, () => ({}), { defer: true }))

  createKeyed(moved, () => {
    const session = sessions.current()
    const screen = ctx.screen.current()

    if (!session || !screen) return

    const id = focused.get(screen)

    if (id && active(session, id)) void screen.file.sync(fileTabPath(screen.file, id), { force: true })
  })
}

export default setup
