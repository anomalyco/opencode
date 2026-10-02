import { batch, createEffect, createMemo, lazy, on, onCleanup, Show, Suspense, type ParentProps } from "solid-js"
import { Schema, Struct } from "effect"
import { Icon } from "@opencode/ui/icon"
import { encodeFilePath, getFilename } from "@opencode/util/path"
import { Browser } from "../browser/contract"
import { Changes } from "../review/contract"
import {
  ExtensionContext,
  Layout,
  Link,
  Menu,
  Native,
  Panel,
  Sessions,
  Slot,
  Storage,
  Style,
  usePanel,
  type LineRange,
  type PanelTab,
  type SessionView,
  type Setup,
  onIdle,
} from "../sdk"
import { OpenAppPreferences } from "./apps"
import { artifactKind } from "@opencode/util/artifact"
import { resolveArtifactPath } from "./artifact"
import { FileContext, type FileShared } from "./context"
import { FileTree } from "./contract"
import { FileVisual } from "./label"
import { fileTabId, fileTabPath, isFileTab, workspaceFileUrl } from "./path"
import tabStyles from "./tabs.css?inline"

const OPEN = "open"
const GROUP = "browser"
const TABPANEL = "session-side-panel-file-browser-tabpanel"
const HANDOFF_SESSIONS = 40

const TreeState = Schema.Struct({ tab: Schema.Literals(["changes", "all"]) }).mapFields(Struct.map(Schema.mutableKey))

const setup: Setup = (ctx) => {
  const sessions = ctx.use(Sessions)
  const layout = ctx.use(Layout)
  const storage = ctx.use(Storage)
  const native = ctx.use(Native)
  const changes = ctx.use(Changes)
  const browser = ctx.use(Browser)

  const [tree, setTree] = storage.store("tree", {
    schema: TreeState,
    initial: { tab: "changes" },
    from: { key: "layout", pick: (value: { fileTree?: { tab?: unknown } } | null) => ({ tab: value?.fileTree?.tab }) },
  })
  const [handoff, setHandoff] = storage.memory("handoff", {
    initial: { sessions: {} as Record<string, Record<string, LineRange | null>> },
  })
  const preference = native
    ? storage.store("app", { schema: OpenAppPreferences, initial: { app: "finder" }, from: "open.app" })
    : undefined

  // Tab objects per routed view, reused so strip updates never rebuild a trigger. `close` prunes them.
  const tabs = new WeakMap<SessionView, Map<string, PanelTab>>()
  const tabsOf = (session: SessionView) => {
    const existing = tabs.get(session)
    if (existing) return existing
    const created = new Map<string, PanelTab>()
    tabs.set(session, created)
    return created
  }
  // The file tab each view last selected, for reloads the side panel does not see.
  const focused = new WeakMap<SessionView, string>()

  const key = (session: SessionView, path: string) => `file:${fileTabId(session.file, path)}`
  const active = (session: SessionView, id: string) => {
    const state = layout.state(`file:${id}`, session)
    return state === "active" || state === "visible"
  }
  const open = (
    session: SessionView,
    path: string,
    options?: { readonly preview?: boolean; readonly background?: boolean },
  ) => {
    layout.open(key(session, path), session, options)
    void session.file.sync(path)
  }

  const shared: FileShared = {
    changes,
    browser,
    tree: {
      tab: () => tree.tab,
      setTab: (tab) =>
        setTree((draft) => {
          draft.tab = tab
        }),
    },
    filter: {},
    installed: new Map(),
    app: preference && {
      current: () => preference[0].app,
      set: (app) =>
        preference[1]((draft) => {
          draft.app = app
        }),
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
  const Provided = (props: ParentProps) => <FileContext.Provider value={shared}>{props.children}</FileContext.Provider>

  // Tab trigger styles render with the strip, before any panel chunk loads.
  ctx.add(Style, tabStyles)
  const style = { loaded: undefined as Promise<void> | undefined }
  const styled = <T,>(module: Promise<T>) => {
    style.loaded ??= import("./styles").then((css) => void ctx.add(Style, css.default))
    return Promise.all([module, style.loaded]).then(([value]) => value)
  }
  const FileBrowser = lazy(() => styled(import("./browser")))
  const MobileFiles = lazy(() => styled(import("./mobile")))
  const Sidebar = lazy(() => styled(import("./sidebar")))
  const Tree = lazy(() => styled(import("./tree-v2")))
  const List = lazy(() => styled(import("./list")))
  ctx.cleanup(
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
    kind: "launcher",
    sidebar: "locked",
    group: GROUP,
    dom: { panel: TABPANEL },
  }

  const fileTab = (session: SessionView, id: string): PanelTab => {
    const path = () => fileTabPath(session.file, id)
    const missing = () => session.file.missing(path())
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
      fallback: 3,
      dom: { panel: TABPANEL },
    }
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    legacy: { "open-file": OPEN },
    // Older builds stored some files as absolute paths; one file is one tab once the workspace root is known.
    // Resolves the stored URL once and encodes the result, so an encoded name such as a%23b.txt stays one file.
    normalize: (id, session) =>
      isFileTab(id) && session.file.ready() ? `//${encodeFilePath(fileTabPath(session.file, id))}` : id,
    mobile: {
      get title() {
        return ctx.t("mobile.title")
      },
      order: 20,
      kind: "tab",
    },
    list(session, stored) {
      const cache = tabsOf(session)
      return stored.flatMap((id) => {
        if (id === OPEN) return [launcher]
        if (!isFileTab(id)) return []
        const existing = cache.get(id)
        if (existing) return [existing]
        const created = fileTab(session, id)
        cache.set(id, created)
        return [created]
      })
    },
    close(tab, session) {
      tabs.get(session)?.delete(tab.id)
    },
    render: (tab, session) => {
      const panel = usePanel()
      return (
        <Provided>
          <Suspense>
            <Show when={panel.placement() === "mobile"} fallback={<FileBrowser tab={tab} session={session} />}>
              <MobileFiles session={session} />
            </Show>
          </Suspense>
        </Provided>
      )
    },
    focus(tab, session, change) {
      if (!isFileTab(tab.id)) return
      focused.set(session, tab.id)
      void session.file.sync(fileTabPath(session.file, tab.id))
      // A restored file tab keeps the tree tab the user left, e.g. Changes across a reload.
      if (!change.restored && tree.tab === "changes") shared.tree.setTab("all")
    },
  })

  ctx.add(Menu, {
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
      layout.open(`file:${OPEN}`, session, { preview: true })
      queueMicrotask(() => {
        const element = shared.filter.element
        if (element?.isConnected) return element.focus()
        shared.filter.pending = true
      })
    },
  })

  if (native) {
    const OpenInAppButton = lazy(() => import("./open-in-app"))
    ctx.cleanup(onIdle(() => void OpenInAppButton.preload()))
    ctx.add(Slot, {
      at: "session.panel.end",
      render: (input) => (
        <Provided>
          <Suspense>
            <OpenInAppButton session={input.session} />
          </Suspense>
        </Provided>
      ),
    })
  }

  ctx.add(Slot, {
    at: "session.panel.sidebar",
    render: (input) => (
      <Provided>
        <Suspense>
          <Sidebar session={input.session} />
        </Suspense>
      </Provided>
    ),
  })

  // The review panel lists its changed files with the browser's tree; it renders under this extension.
  ctx.provide(FileTree, {
    Tree: (props) => (
      <ExtensionContext.Provider value={ctx}>
        <Provided>
          <Suspense>
            <Tree
              session={props.session}
              allowed={props.allowed}
              kinds={props.kinds}
              draggable={false}
              active={props.active}
              onFileClick={(node) => props.onFileClick(node.path)}
            />
          </Suspense>
        </Provided>
      </ExtensionContext.Provider>
    ),
    List: (props) => (
      <ExtensionContext.Provider value={ctx}>
        <Provided>
          <Suspense>
            <List
              session={props.session}
              files={props.files}
              kinds={props.kinds}
              active={props.active}
              highlighted={props.highlighted}
              onFileClick={(path) => props.onFileClick(path)}
            />
          </Suspense>
        </Provided>
      </ExtensionContext.Provider>
    ),
  })

  /**
   * Turn a link into a path the file model can load: workspace-relative when it is under the root,
   * otherwise absolute. Relative links resolve against `base`; ones that climb past the root
   * become absolute too, so a `../../shared/report.pdf` still opens.
   */
  const resolve = (session: SessionView, href: string, base?: string) => {
    const root = session.file.root.replaceAll("\\", "/").replace(/\/+$/, "")
    // Agents cite locations as path:line or path:line:col; the file is what opens.
    const value = href.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "")
    if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return session.file.resolve(value)
    const relative = resolveArtifactPath(base ?? "", value)
    if (relative !== undefined) return session.file.resolve(relative)
    // Climbing past the workspace root: resolve from the referencing folder's absolute location.
    const dir = base ? `${root}/${base.replace(/\/+$/, "")}` : root
    return session.file.resolve(resolveArtifactPath(dir, value) ?? value)
  }

  // Opens files the agent references as side panel tabs, inside or outside the workspace, or as
  // a browser tab for HTML when the desktop can load the file directly.
  ctx.add(Link, {
    match: () => true,
    open(link) {
      const session = sessions.current()
      if (!session || (link.session && link.session.key !== session.key)) return
      // A known workspace file (the palette, a file comment) opens at once with every file listed.
      if (link.exact || link.origin === "file") {
        const path = session.file.resolve(link.href)
        if (!path) return
        batch(() => {
          open(session, path, { background: link.background })
          shared.tree.setTab("all")
        })
        return
      }
      const path = resolve(session, link.href, link.base)
      if (!path) return
      const pane = browser()
      if (artifactKind(path) === "html" && pane?.canOpen(session, path)) {
        pane.open(session, workspaceFileUrl(session.file.root, path))
        return
      }
      // Inline paths are guessed from text, so confirm the file exists before a tab appears for it.
      // Always reread: V2 publishes no workspace file change events, so a cached copy can be stale.
      void session.file.sync(path, { force: true }).then(() => {
        if (!session.file.get(path)?.loaded) return
        batch(() => {
          layout.open(key(session, path), session, { background: link.background })
          // A tapped link switches the narrow-screen view; the side region still opens for when the window is wide.
          if (layout.narrow() && !layout.side.opened(session)) layout.side.toggle(session)
        })
      })
    },
  })

  // Review reveals a change: the tree shows the changed files.
  createEffect(() => {
    const service = changes()
    if (!service) return
    onCleanup(service.onReveal(() => shared.tree.setTab("changes")))
  })

  // A new workspace directory drops loaded files; reload the selected file tab.
  const root = createMemo<string | undefined>((previous) => sessions.current()?.file.root ?? previous)
  createEffect(
    on(
      root,
      () => {
        const session = sessions.current()
        if (!session) return
        const id = focused.get(session)
        if (id && active(session, id)) void session.file.sync(fileTabPath(session.file, id), { force: true })
      },
      { defer: true },
    ),
  )
}

export default setup
