import {
  batch,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  Show,
  Suspense,
  untrack,
  type ParentProps,
  type Signal,
} from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { encodeFilePath, getFilename } from "@opencode/util/path"
import {
  Command,
  createKeyed,
  bindPlugin,
  LinkHandler,
  MenuItem,
  Slot,
  Style,
  usePanel,
  type Files,
  type LineRange,
  type Link,
  type OpenOptions,
  type MountedSession,
  type SessionScreen,
  type ServerRef,
  type Plugin,
} from "@opencode/plugin/gui"
import { artifactKind } from "@opencode/util/artifact"
import { uuid } from "@opencode/util/uuid"
import { resolveArtifactPath } from "./artifact"
import { FileContext, type FileShared } from "./context"
import {
  FileTree,
  OpenInApp,
  type FileListProps,
  type FileTreeProps,
  type OpenInAppProps,
} from "@opencode/plugin/gui/file"
import type File from "./index"
import { FileVisual } from "./label"
import {
  createLinkExistsState,
  linkExistsAnswer,
  transitionLinkExists,
  type LinkExistsEvent,
  type LinkExistsState,
} from "./link-exists-machine"
import {
  createLinkOpenState,
  transitionLinkOpen,
  type LinkOpenEffect,
  type LinkOpenEvent,
  type LinkResolution,
  type LinkRoute,
} from "./link-open-machine"
import {
  createOpenInAppState,
  isOpenAppInstalled,
  isOpenInAppLaunching,
  transitionOpenInApp,
  type OpenInAppEffect,
  type OpenInAppEvent,
} from "./open-in-app-machine"
import { fileTabId, fileTabPath, isFileTab, openInAppParentPath, workspaceFileUrl } from "./path"
import {
  createPickerState,
  pickerBrowsing,
  pickerFilterText,
  pickerFocusRequest,
  transitionPicker,
  type PickerEvent,
} from "./picker-machine"
import tabStyles from "./tabs.css?inline"
import { onIdle, BuiltinPanel, BuiltinSlot, type BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import { Browser } from "@opencode/plugin/gui/browser"
import { Changes } from "@opencode/plugin/gui/review"

const OPEN = "open"

const isLauncher = (id: string) => id === OPEN || id.startsWith(`${OPEN}:`)

const GROUP = "browser"

const TABPANEL = "session-side-panel-file-browser-tabpanel"

const HANDOFF_SESSIONS = 40

const DEFAULT_LINE_HEIGHT = 24

type Handoff = { sessions: Record<string, Record<string, LineRange | null>> }

type StyleLoad = { loaded?: Promise<void> }

/** The pending "Open file" focus request's timeout. */
type FocusTimer = { handle?: ReturnType<typeof setTimeout> }

/** A link click's work in flight: its controller and timeout, and the screen it was clicked on. */
type LinkAttempt = { controller: AbortController; timer: ReturnType<typeof setTimeout>; screen: SessionScreen }

/** One link existence check in flight; `settle` answers the renders waiting on `result`. */
type LinkCheck = {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  result: Promise<boolean>
  settle: (exists: boolean) => void
}

/** The link existence cache of one screen and server connection, and its checks in flight. */
type LinkChecks = { state: LinkExistsState; inFlight: Map<number, LinkCheck> }

const setup: Plugin.Setup<typeof File> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const storage = ctx.storage
  const desktop = ctx.desktop
  const [handoff, setHandoff] = storage.memory<Handoff>("handoff", { initial: { sessions: {} } })
  const preference = desktop ? ctx.stores.app : undefined
  const [openInApp, setOpenInApp] = createSignal(createOpenInAppState())
  const openInAppTimers = new Map<number, ReturnType<typeof setTimeout>>()

  const [machines, setMachines] = createStore({ linkOpen: createLinkOpenState(), picker: createPickerState() })

  const revealListeners = new Map<string, Set<() => void>>()
  const linkAttempts = new Map<number, LinkAttempt>()
  const focusTimer: FocusTimer = {}

  // Tab objects per session screen, which stays while it routes another session, reused so neither strip updates nor a
  // session switch rebuild a trigger. `close` prunes them.
  const tabs = new WeakMap<SessionScreen, Map<string, BuiltinPanelTab>>()

  const tabsOf = (screen: SessionScreen) => {
    const existing = tabs.get(screen)

    if (existing) return existing

    const created = new Map<string, BuiltinPanelTab>()

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

  const dispatchPicker = (event: PickerEvent) => {
    // Renders read the filters; a dispatch from one must not subscribe it to every change.
    const previous = untrack(() => unwrap(machines.picker))
    const next = transitionPicker(previous, event)

    if (next.state !== previous) setMachines(produce((draft) => void (draft.picker = next.state)))

    next.effects.forEach((effect) => {
      clearTimeout(focusTimer.handle)
      focusTimer.handle =
        effect.type === "start-focus-timer"
          ? setTimeout(() => dispatchPicker({ type: "focus.ended", request: effect.request }), effect.timeoutMs)
          : undefined
    })
  }

  const dispatchOpenInApp = (event: OpenInAppEvent) => {
    const next = transitionOpenInApp(untrack(openInApp), event)

    setOpenInApp(next.state)
    next.effects.forEach(runOpenInApp)
  }

  const runOpenInApp = (effect: OpenInAppEffect) => {
    if (effect.type === "clear-timer") {
      clearTimeout(openInAppTimers.get(effect.attempt))
      openInAppTimers.delete(effect.attempt)

      return
    }

    if (effect.type === "toast-failed") {
      ctx.toast.show({ variant: "error", title: ctx.t("common.requestFailed"), description: effect.error })

      return
    }

    const attempt = effect.attempt

    if (effect.type === "check-app") {
      const openWith = effect.openWith
      const drop = () => dispatchOpenInApp({ type: "app.check-dropped", attempt, openWith })

      openInAppTimers.set(attempt, setTimeout(drop, effect.timeoutMs))
      void Promise.try(() => desktop?.installed(openWith)).then(
        (installed) => dispatchOpenInApp({ type: "app.checked", attempt, openWith, installed: Boolean(installed) }),
        drop,
      )

      return
    }

    openInAppTimers.set(
      attempt,
      setTimeout(() => dispatchOpenInApp({ type: "launch.timed-out", attempt }), effect.timeoutMs),
    )
    const target = effect.target

    void Promise.try(() => {
      if (!desktop) throw new Error(ctx.t("common.requestFailed"))

      if (!effect.reveal) return desktop.launch(target, effect.openWith)

      return desktop
        .reveal(target)
        .then((revealed) => (revealed ? undefined : desktop.launch(openInAppParentPath(target))))
    }).then(
      () => dispatchOpenInApp({ type: "launch.succeeded", attempt }),
      (cause: unknown) =>
        dispatchOpenInApp({
          type: "launch.failed",
          attempt,
          error: cause instanceof Error ? cause.message : String(cause),
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
    dispatchPicker({ type: "file.opened", sessionKey: session.key })
    // A closed tab stops watching its file, so a cached copy can be stale: always reread, as links do.
    void screen.file.sync(path, { force: true })
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

  // Reuses the selected launcher; otherwise wide screens add another one beside the open tabs, so several can stay
  // open. Narrow screens never store a launcher, so they keep the one.
  const openPicker = (session: MountedSession, query: string, options?: OpenOptions & { another?: boolean }) => {
    const selected = options?.another
      ? undefined
      : layout.stored(session).find((id) => isLauncher(id) && active(session, id))

    const narrow = layout.narrow()
    const tab = selected ?? (narrow ? OPEN : `${OPEN}:${uuid()}`)

    batch(() => {
      // Before the tab opens, so selecting the launcher keeps the focus request for its filter input.
      dispatchPicker({
        type: "picker.opened",
        sessionKey: session.key,
        query,
        target: narrow ? { kind: "mobile" } : { kind: "launcher", tabId: tab },
        background: Boolean(options?.background),
      })

      if (selected || narrow) layout.open(`file:${tab}`, session, { tab: "preview", background: options?.background })
      else layout.open(`file:${tab}`, session, { tab: "select" })

      if (!options?.background && narrow && !layout.side.opened(session)) layout.side.toggle(session)
    })
  }

  const shared: FileShared = {
    changes: ctx.use(Changes),
    browser: ctx.use(Browser),
    filter: {
      get: (session) => pickerFilterText(machines.picker, session),
      set: (session, value) => dispatchPicker({ type: "filter.changed", sessionKey: session, text: value }),
      browsing: (session) => pickerBrowsing(machines.picker, session),
      setBrowsing: (session, value) => dispatchPicker({ type: "browsing.set", sessionKey: session, browsing: value }),
      focusRequest: (view) => pickerFocusRequest(machines.picker, view),
      focused: (request) => dispatchPicker({ type: "focus.ended", request }),
    },
    app: preference && {
      current: () => preference.value.app,
      set: (app) =>
        preference.update((draft) => {
          draft.app = app
        }),
    },
    openInApp: {
      check: (openWith) => dispatchOpenInApp({ type: "apps.requested", openWith }),
      installed: (openWith) => isOpenAppInstalled(openInApp(), openWith),
      opening: () => isOpenInAppLaunching(openInApp()),
      launch: (input) => dispatchOpenInApp({ type: "launch.requested", ...input }),
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
  const Tree = lazy(() => styled(import("./pierre-tree")))
  const List = lazy(() => styled(import("./list")))

  onCleanup(
    onIdle(() => {
      void import("./pierre-tree")
      void FileBrowser.preload()
      void Tree.preload()
      void List.preload()
      void import("./resolve-link")

      if (layout.narrow()) void MobileFiles.preload()
    }),
  )

  const launcher = (id: string): BuiltinPanelTab => ({
    id,
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
    transient: true,
    group: GROUP,
    dom: { panel: TABPANEL },
  })

  const fileTab = (files: Files, id: string): BuiltinPanelTab => {
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

  ctx.add(BuiltinPanel, {
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
        if (!isLauncher(id) && !isFileTab(id)) return []

        const cache = tabsOf(input.screen)
        const existing = cache.get(id)

        if (existing) return [existing]

        const created = isLauncher(id) ? launcher(id) : fileTab(input.screen.file, id)

        cache.set(id, created)

        return [created]
      })
    },
    close(input) {
      tabs.get(input.screen)?.delete(input.tab.id)

      if (isLauncher(input.tab.id))
        dispatchPicker({ type: "launcher.closed", sessionKey: input.session.key, tabId: input.tab.id })

      if (isFileTab(input.tab.id)) input.screen.file.unwatch(fileTabPath(input.screen.file, input.tab.id))
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

      // A file the user selects on a wide screen is what the narrow-screen view shows too, not the browser. Narrow
      // screens skip this: their side region falls back to a file tab while the launcher opens.
      if (!input.restored && !layout.narrow()) dispatchPicker({ type: "file.opened", sessionKey: input.session.key })

      focused.set(input.screen, input.tab.id)
      void input.screen.file.sync(fileTabPath(input.screen.file, input.tab.id), { silent: true })
    },
  })

  const browse = () => {
    const session = sessions.current()

    if (session) openPicker(session, shared.filter.get(session.key))
  }

  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

  ctx.add(
    Command,
    (): Command => ({
      id: "browse",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      bind: mac ? "ctrl+meta+p" : "ctrl+alt+p",
      editable: true,
      enabled: !!sessions.current(),
      run: browse,
    }),
  )

  // A new tab always offers another launcher, however many are open.
  ctx.add(
    MenuItem,
    (): MenuItem => ({
      menu: "session.panel",
      id: "open",
      title: ctx.t("command.open"),
      icon: "file-tree",
      keybind: "file.browse",
      order: 30,
      run: () => {
        const session = sessions.current()

        if (session) openPicker(session, "", { another: true })
      },
    }),
  )

  const OpenInAppButton = lazy(() => import("./open-in-app"))

  const OpenInAppMenuItem = lazy(() =>
    import("./open-in-app").then((module) => ({ default: module.OpenInAppMenuItem })),
  )

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
    onCleanup(
      onIdle(() => {
        void OpenInAppButton.preload()
        void OpenInAppMenuItem.preload()
      }),
    )
    ctx.add(BuiltinSlot, {
      at: "session.location.path.menu",
      render: (input) => (
        <FileProvider>
          <Suspense>
            <OpenInAppMenuItem session={input.session} />
          </Suspense>
        </FileProvider>
      ),
    })
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
    Button: bindPlugin((props: OpenInAppProps) => {
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

  // The review panel lists its changed files with the browser's tree; it renders under this plugin, on the
  // session screen's file model.
  ctx.provide(FileTree, {
    Tree: bindPlugin((props: FileTreeProps) => (
      <FileProvider>
        <Suspense>
          <Tree
            session={props.session}
            screen={props.screen}
            allowed={props.allowed}
            kinds={props.kinds}
            labels={props.labels}
            draggable={false}
            active={props.active}
            onFileClick={(node) => props.onFileClick(node.path)}
          />
        </Suspense>
      </FileProvider>
    )),
    List: bindPlugin((props: FileListProps) => (
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

    if (/^skill:\/\//i.test(value) || /^[a-z]:\//i.test(value) || value.startsWith("/")) return files.resolve(value)

    const relative = resolveArtifactPath(base ?? "", value)

    if (relative !== undefined) return files.resolve(relative)

    // Climbing past the workspace root: resolve from the referencing folder's absolute location.
    const dir = base ? `${root}/${base.replace(/\/+$/, "")}` : root

    return files.resolve(resolveArtifactPath(dir, value) ?? value)
  }

  // Screens survive tab switches, unlike Markdown and MountedSession objects. Weak client keys also drop results
  // from an old server connection without retaining its controller.
  const linkChecks = new WeakMap<SessionScreen, WeakMap<ServerRef["client"], LinkChecks>>()

  // Messages style a path as a link only when this says the file exists. Markdown renders call it, so the cache is no
  // Solid state.
  const linkExists = (link: Link): boolean | Promise<boolean> => {
    const session = sessions.current()
    const screen = ctx.screen.current()
    const files = screen?.file

    if (ctx.signal.aborted || !session || !screen || !files || (link.session && link.session.key !== session.key))
      return false

    const clients = linkChecks.get(screen) ?? new WeakMap<ServerRef["client"], LinkChecks>()
    linkChecks.set(screen, clients)
    const client = session.server.client
    const checks = clients.get(client) ?? { state: createLinkExistsState(), inFlight: new Map<number, LinkCheck>() }
    clients.set(client, checks)
    const root = files.root
    const cacheKey = JSON.stringify([session.key, root, link.base ?? null, link.href])

    const current = () =>
      !ctx.signal.aborted &&
      sessions.current()?.key === session.key &&
      files.root === root &&
      session.server.client === client

    const dispatch = (event: LinkExistsEvent) => {
      const next = transitionLinkExists(checks.state, event)
      checks.state = next.state

      next.effects.forEach((effect) => {
        if (effect.type === "abort-check") {
          const check = checks.inFlight.get(effect.attempt)
          checks.inFlight.delete(effect.attempt)
          clearTimeout(check?.timer)
          check?.controller.abort()
          check?.settle(false)

          return
        }

        const attempt = effect.attempt
        const controller = new AbortController()
        const signal = AbortSignal.any([ctx.signal, controller.signal])
        const drop = () => dispatch({ type: "check.dropped", key: effect.key, attempt })
        const answer: Pick<LinkCheck, "settle"> = { settle: () => undefined }

        const result = new Promise<boolean>((resolve) => {
          answer.settle = resolve
        })

        checks.inFlight.set(attempt, {
          controller,
          timer: setTimeout(drop, effect.timeoutMs),
          result,
          settle: answer.settle,
        })
        // A reload ends the check; the listener goes with the check's controller.
        ctx.signal.addEventListener("abort", drop, { once: true, signal: controller.signal })

        void import("./resolve-link")
          .then(async ({ checkFileLinkExists, parseFileLink }) => {
            if (!current()) return false

            // A link in a previewed document opens relative to it, so only that path counts.
            const path = parseFileLink(link.href).path

            const direct =
              link.base === undefined || path.startsWith("//") || path.startsWith("~")
                ? undefined
                : resolve(files, path, link.base)

            if (link.base === undefined) return checkFileLinkExists({ files, href: link.href, signal })

            return direct ? files.exists(direct) : false
          })
          .then((exists) => {
            // Aborted, failed or no-longer-current checks are retryable, not cached negatives.
            if (!current()) return drop()

            checks.inFlight.get(attempt)?.settle(exists)
            dispatch({ type: "check.settled", key: effect.key, attempt, exists, now: Date.now() })
          }, drop)
      })
    }

    dispatch({ type: "check.requested", key: cacheKey, now: Date.now() })

    const answer = linkExistsAnswer(checks.state, cacheKey)

    return answer.kind === "value" ? answer.value : (checks.inFlight.get(answer.attempt)?.result ?? false)
  }

  // Where the user is now, compared with where a link was clicked before its result counts.
  const linkRoute = (screen: SessionScreen): LinkRoute => ({
    sessionKey: sessions.current()?.key,
    root: screen.file.root,
    sameScreen: ctx.screen.current() === screen,
  })

  const dispatchLink = (event: LinkOpenEvent) => {
    const previous = untrack(() => unwrap(machines.linkOpen))
    const next = transitionLinkOpen(previous, event)

    if (next.state !== previous) setMachines(produce((draft) => void (draft.linkOpen = next.state)))

    next.effects.forEach(runLink)
  }

  const runLink = (effect: LinkOpenEffect) => {
    if (effect.type === "resolve") {
      const screen = ctx.screen.current()
      const attempt = effect.attempt

      if (!screen) return dispatchLink({ type: "link.cancelled", attempt })

      const controller = new AbortController()

      linkAttempts.set(attempt, {
        controller,
        screen,
        timer: setTimeout(() => dispatchLink({ type: "link.timed-out", attempt }), effect.timeoutMs),
      })

      void resolveLink(screen, effect, AbortSignal.any([ctx.signal, controller.signal])).then(
        (resolution) => dispatchLink({ type: "link.resolved", attempt, route: linkRoute(screen), resolution }),
        (cause) =>
          dispatchLink({
            type: "link.failed",
            attempt,
            route: linkRoute(screen),
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )

      return
    }

    if (effect.type === "sync") {
      const handle = linkAttempts.get(effect.attempt)

      if (!handle) return

      const files = handle.screen.file
      const attempt = effect.attempt

      // Confirm the file exists before a tab appears for it, and always reread: a cached copy can be stale. Silent,
      // because this click reports its own outcome, and a superseded click none.
      void files.sync(effect.path, { force: true, silent: true }).then(
        () => {
          const state = files.get(effect.path)
          const routed = sessions.current()

          dispatchLink({
            type: "file.synced",
            attempt,
            route: linkRoute(handle.screen),
            loaded: Boolean(state?.loaded),
            notFound: Boolean(state?.notFound),
            opened: !!routed && layout.stored(routed).includes(fileTabId(files, effect.path)),
            error: state?.error,
          })
        },
        (cause) =>
          dispatchLink({
            type: "link.failed",
            attempt,
            route: linkRoute(handle.screen),
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )

      return
    }

    if (effect.type === "abort") {
      const handle = linkAttempts.get(effect.attempt)
      linkAttempts.delete(effect.attempt)
      clearTimeout(handle?.timer)
      handle?.controller.abort()

      return
    }

    if (effect.type === "toast-failed") {
      ctx.toast.show({
        variant: "error",
        title: ctx.t("load.failed"),
        description: effect.error ?? ctx.t("tab.notFound", { name: getFilename(effect.path) || effect.path }),
      })

      return
    }

    if (effect.type === "toast-timeout") {
      ctx.toast.show({
        variant: "error",
        title: ctx.t("load.failed"),
        description: ctx.t("load.timeout", { name: getFilename(effect.path) || effect.path }),
      })

      return
    }

    const routed = sessions.current()
    const screen = ctx.screen.current()

    if (!routed || !screen) return

    if (effect.type === "open-exact") return open(routed, effect.path, { background: effect.background })

    if (effect.type === "open-picker") return openPicker(routed, effect.query, { background: effect.background })

    if (effect.type === "open-browser") {
      const pane = shared.browser()

      if (pane.status === "active") pane.value.open(routed, effect.url)

      return
    }

    batch(() => {
      applySelection(routed, screen.file, effect.path, effect.selection)
      layout.open(key(screen.file, effect.path), routed, { background: effect.background })

      // A tapped link switches the narrow-screen view; the side region still opens for when the window is wide.
      if (layout.narrow() && !layout.side.opened(routed)) layout.side.toggle(routed)
    })
    // After the batch, as in `open`: the mobile tab strip registers the tab before it leaves the browser.
    dispatchPicker({ type: "file.opened", sessionKey: routed.key })
  }

  const resolveLink = async (
    screen: SessionScreen,
    link: { href: string; base?: string; background: boolean },
    signal: AbortSignal,
  ): Promise<LinkResolution> => {
    const { findFileLink, isAbsoluteLink, parseFileLink } = await import("./resolve-link")
    const parsed = parseFileLink(link.href)
    const direct = resolve(screen.file, parsed.path, link.base)

    if (!direct) return { kind: "missing" }

    // Absolute paths, links written relative to a document, and agent previews name one exact file.
    if (isAbsoluteLink(parsed.path) || link.base !== undefined || link.background)
      return fileOrPage(screen, direct, parsed.selection)

    const target = await findFileLink({ files: screen.file, path: parsed.path, signal })

    if (target?.kind === "picker") return { kind: "picker", query: target.query }

    // With no match, the literal path still covers files the search index skips, such as an ignored `.env`.
    return fileOrPage(screen, target?.path ?? direct, parsed.selection)
  }

  // The browser pane shows HTML it can load. While it is pending or off, the file opens as a tab instead.
  const fileOrPage = (screen: SessionScreen, path: string, selection: LineRange | undefined): LinkResolution => {
    const pane = shared.browser()
    const routed = sessions.current()

    if (routed && artifactKind(path) === "html" && pane.status === "active" && pane.value.canOpen(routed, path))
      return { kind: "browser", url: workspaceFileUrl(screen.file.root, path) }

    return { kind: "file", path, selection }
  }

  onCleanup(() => {
    dispatchLink({ type: "disposed" })
    dispatchPicker({ type: "disposed" })
    dispatchOpenInApp({ type: "disposed" })
  })

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

      // A known workspace file (the palette, a file comment) opens at once with every file listed.
      if (link.exact || link.origin === "file")
        return dispatchLink({
          type: "link.exact",
          href: link.href,
          path: files.resolve(link.href),
          background: Boolean(link.background),
        })

      dispatchLink({
        type: "link.clicked",
        sessionKey: session.key,
        root: files.root,
        href: link.href,
        base: link.base,
        background: Boolean(link.background),
      })
    },
  })

  // A new workspace directory drops loaded files; reload the selected file tab.
  const root = createMemo<string | undefined>((previous) => ctx.screen.current()?.file.root ?? previous)

  const moved = createMemo(on(root, () => ({}), { defer: true }))

  createKeyed(moved, () => {
    const session = sessions.current()
    const screen = ctx.screen.current()

    if (!session || !screen) return

    const id = focused.get(screen)

    if (id && active(session, id)) void screen.file.sync(fileTabPath(screen.file, id), { force: true, silent: true })
  })
}

export default setup
