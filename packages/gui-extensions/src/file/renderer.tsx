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
import { createStore } from "solid-js/store"
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

  // Opens on the session screen, whose file model serves the routed session `session` is.
  const open = (session: MountedSession, path: string, options?: OpenOptions) => {
    const screen = ctx.screen.current()

    if (!screen) return

    layout.open(key(screen.file, path), session, options)
    void screen.file.sync(path)
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
    filter: {},
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
      kind: "tab",
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

      layout.open(`file:${OPEN}`, session, { tab: "preview" })
      queueMicrotask(() => {
        const element = shared.filter.element

        if (element?.isConnected) return element.focus()

        shared.filter.pending = true
      })
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
  const resolve = (files: Files, href: string, base?: string) => {
    const root = files.root.replaceAll("\\", "/").replace(/\/+$/, "")
    // Agents cite locations as path:line or path:line:col; the file is what opens.
    const value = href.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "")

    if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return files.resolve(value)

    const relative = resolveArtifactPath(base ?? "", value)

    if (relative !== undefined) return files.resolve(relative)

    // Climbing past the workspace root: resolve from the referencing folder's absolute location.
    const dir = base ? `${root}/${base.replace(/\/+$/, "")}` : root

    return files.resolve(resolveArtifactPath(dir, value) ?? value)
  }

  // Opens files the agent references as side panel tabs, inside or outside the workspace, or as
  // a browser tab for HTML when the desktop can load the file directly.
  ctx.add(LinkHandler, {
    match: () => true,
    open(link) {
      const session = sessions.current()
      const files = ctx.screen.current()?.file

      if (!session || !files || (link.session && link.session.key !== session.key)) return

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

      const path = resolve(files, link.href, link.base)

      if (!path) return

      // The browser pane shows HTML it can load. While it is pending or off, the file opens as a tab instead.
      const pane = ctx.uses.browser()

      if (artifactKind(path) === "html" && pane.status === "active" && pane.value.canOpen(session, path)) {
        pane.value.open(session, workspaceFileUrl(files.root, path))

        return
      }

      // Inline paths are guessed from text, so confirm the file exists before a tab appears for it.
      // Always reread: V2 publishes no workspace file change events, so a cached copy can be stale.
      void files.sync(path, { force: true }).then(() => {
        if (!files.get(path)?.loaded) return

        batch(() => {
          layout.open(key(files, path), session, { background: link.background })

          // A tapped link switches the narrow-screen view; the side region still opens for when the window is wide.
          if (layout.narrow() && !layout.side.opened(session)) layout.side.toggle(session)
        })
      })
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
