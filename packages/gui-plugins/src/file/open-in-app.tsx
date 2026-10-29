import { createMemo, createSignal, For, onCleanup, Show, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { AppIcon } from "@opencode/ui/app-icon"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Loader } from "@opencode/ui/loader"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "@opencode/ui/split-button"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import {
  createLatest,
  usePlugin,
  type Context,
  type OS,
  type MountedSession,
  type SessionScreen,
} from "@opencode/plugin/gui"
import type { OpenApp } from "./apps"
import { useShared, type OpenRequest } from "./context"
import { openInAppParentPath } from "./path"

const MAC_OPEN_APPS = [
  { id: "vscode", label: "open.app.vscode", icon: "vscode", openWith: "Visual Studio Code" },
  { id: "cursor", label: "open.app.cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "open.app.zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "open.app.textmate", icon: "textmate", openWith: "TextMate" },
  { id: "antigravity", label: "open.app.antigravity", icon: "antigravity", openWith: "Antigravity" },
  { id: "terminal", label: "open.app.terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "open.app.iterm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "open.app.ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "open.app.warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "open.app.xcode", icon: "xcode", openWith: "Xcode" },
  { id: "android-studio", label: "open.app.androidStudio", icon: "android-studio", openWith: "Android Studio" },
  { id: "sublime-text", label: "open.app.sublimeText", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const WINDOWS_OPEN_APPS = [
  { id: "vscode", label: "open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "open.app.zed", icon: "zed", openWith: "zed" },
  { id: "powershell", label: "open.app.powershell", icon: "powershell", openWith: "powershell" },
  { id: "sublime-text", label: "open.app.sublimeText", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const LINUX_OPEN_APPS = [
  { id: "vscode", label: "open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "open.app.zed", icon: "zed", openWith: "zed" },
  { id: "sublime-text", label: "open.app.sublimeText", icon: "sublime-text", openWith: "Sublime Text" },
] as const

function openAppsForOS(os: OS) {
  if (os === "macos") return MAC_OPEN_APPS

  if (os === "windows") return WINDOWS_OPEN_APPS

  return LINUX_OPEN_APPS
}

// File manager names match the host's project menus.
function fileManagerApp(os: OS) {
  if (os === "macos") return { label: "open.finder", icon: "finder" } as const

  if (os === "windows") return { label: "open.fileExplorer", icon: "file-explorer" } as const

  return { label: "open.fileManager", icon: "finder" } as const
}

// A rejection's reason: usually an Error, else whatever the platform rejected with.
const showRequestError = (ctx: Context, err: Error | string) => {
  showToast({
    variant: "error",
    title: ctx.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

export function useOpenInApp(input: { session: MountedSession; path: () => string; request?: OpenRequest }) {
  const ctx = usePlugin()
  const desktop = ctx.desktop
  const shared = useShared()

  const os = () => desktop?.os ?? "linux"
  const apps = createMemo(() => openAppsForOS(os()))
  const fileManager = createMemo(() => fileManagerApp(os()))

  const checkAppExists = (app: string) => {
    const cached = shared.installed.get(app)

    if (cached) return cached

    const request = Promise.resolve(desktop?.installed(app))
      .then(Boolean)
      .catch(() => false)

    shared.installed.set(app, request)

    return request
  }

  // Which of the OS's apps are installed; none are listed until the check answers.
  const installed = createLatest(
    () => desktop && apps(),
    (list) =>
      Promise.all(list.map((app) => checkAppExists(app.openWith).then((ok) => [app.id, ok] as const))).then(
        (entries) => new Map<OpenApp, boolean>(entries),
      ),
  )

  const options = createMemo(() => {
    return [
      { id: "finder", label: ctx.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => installed.latest?.get(app.id))
        .map((app) => ({ ...app, label: ctx.t(app.label) })),
    ] as const
  })

  const [menu, setMenu] = createStore({ open: false })
  const [local, setLocal] = createStore<{ app?: OpenApp }>({})

  const request = input.request ?? { app: () => local.app, set: (app: OpenApp | undefined) => setLocal("app", app) }

  const canOpen = createMemo(() => !!desktop && input.session.server.local)

  const current = createMemo(
    () =>
      options().find((o) => o.id === shared.app?.current()) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )

  const opening = createMemo(() => request.app() !== undefined)

  const selectApp = (app: OpenApp | "finder") => {
    if (!options().some((item) => item.id === app)) return
    shared.app?.set(app)
  }

  const openPath = (app: OpenApp | "finder", target = input.path(), reveal = false) => {
    if (opening() || !canOpen() || !desktop) return

    if (!target) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    request.set(app)

    const launched =
      app === "finder" && reveal
        ? desktop
            .reveal(target)
            .then((revealed) => (revealed ? undefined : desktop.launch(openInAppParentPath(target))))
        : desktop.launch(target, openWith)

    launched
      .catch((err) => showRequestError(ctx, err))
      .finally(() => {
        request.set(undefined)
      })
  }

  const copyPath = (target = input.path()) => {
    if (!target) return
    navigator.clipboard
      .writeText(target)
      .then(() => {
        showToast({
          variant: "success",
          // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
          // SAFETY: the toast inserts `icon` as a child, and Solid's insert renders a function child as an accessor.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
          icon: (() => <Icon name="circle-check" />) as unknown as JSX.Element,
          title: ctx.t("common.copied"),
          description: target,
        })
      })
      .catch((err) => showRequestError(ctx, err))
  }

  return {
    canOpen,
    opening,
    current,
    options,
    menu,
    setMenu,
    openPath,
    selectApp,
    copyPath,
  }
}

type OpenInAppState = ReturnType<typeof useOpenInApp>

export function OpenInAppMenuItem(props: { session: MountedSession }) {
  const ctx = usePlugin()

  const state = useOpenInApp({
    get session() {
      return props.session
    },
    path: () => props.session.directory,
    request: useShared().request,
  })

  return (
    <Show when={state.canOpen() && state.current().id !== "finder"}>
      <Menu.Item disabled={state.opening()} onSelect={() => state.openPath(state.current().id)}>
        <AppIcon id={state.current().icon} class="size-3.5 shrink-0" />
        {ctx.t("open.ariaLabel", { app: state.current().label })}
      </Menu.Item>
    </Show>
  )
}

export default function OpenInAppButton(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = usePlugin()
  const directory = () => props.screen.file.root
  const state = useOpenInApp({ session: props.session, path: directory, request: useShared().request })

  return (
    <Show when={directory() && state.canOpen()}>
      <SplitButton class="session-review-v2-open-in-app" onPointerDown={(event) => event.stopPropagation()}>
        <Tooltip
          placement="bottom"
          value={ctx.t("open.ariaLabel", { app: state.current().label })}
          class="flex items-center"
        >
          <SplitButtonAction
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()

              if (state.opening()) return
              state.openPath(state.current().id)
            }}
            disabled={state.opening()}
            aria-label={ctx.t("open.ariaLabel", { app: state.current().label })}
          >
            <Show when={state.opening()} fallback={<AppIcon id={state.current().icon} class="size-[18px]" />}>
              <Loader class="size-3.5" />
            </Show>
          </SplitButtonAction>
        </Tooltip>
        <Menu
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={state.menu.open}
          onOpenChange={(open) => state.setMenu("open", open)}
        >
          <Menu.Trigger
            as={SplitButtonMenuTrigger}
            disabled={state.opening()}
            aria-label={ctx.t("open.menu")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Icon name="chevron-down" size="small" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="open-in-app-v2-menu">
              <OpenInAppMenuItemsV2 state={state} close={() => state.setMenu("open", false)} />
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </SplitButton>
    </Show>
  )
}

export function OpenInAppMenuItemsV2(props: {
  state: OpenInAppState
  path?: () => string
  reveal?: boolean
  selection?: boolean
  copyPath?: boolean
  close?: () => void
}) {
  const ctx = usePlugin()
  const path = () => props.path?.()

  return (
    <>
      <Menu.Group>
        <Menu.GroupLabel>{ctx.t("open.in")}</Menu.GroupLabel>
        <Show
          when={props.selection !== false}
          fallback={
            <For each={props.state.options()}>
              {(option) => (
                <Menu.Item
                  disabled={props.state.opening()}
                  onSelect={() => {
                    props.state.selectApp(option.id)
                    props.close?.()
                    props.state.openPath(option.id, path(), props.reveal)
                  }}
                >
                  <AppIcon id={option.icon} />
                  {option.label}
                </Menu.Item>
              )}
            </For>
          }
        >
          <Menu.RadioGroup
            value={props.state.current().id}
            onChange={(value) => {
              const option = props.state.options().find((item) => item.id === value)

              if (option) props.state.selectApp(option.id)
            }}
          >
            <For each={props.state.options()}>
              {(option) => (
                <Menu.RadioItem
                  value={option.id}
                  closeOnSelect
                  disabled={props.state.opening()}
                  onSelect={() => {
                    props.state.selectApp(option.id)
                    props.close?.()
                    props.state.openPath(option.id, path(), props.reveal)
                  }}
                >
                  <AppIcon id={option.icon} />
                  {option.label}
                </Menu.RadioItem>
              )}
            </For>
          </Menu.RadioGroup>
        </Show>
      </Menu.Group>
      <Show when={props.copyPath !== false}>
        <Menu.Separator />
        <Menu.Item
          onSelect={() => {
            props.close?.()
            props.state.copyPath(path())
          }}
        >
          <Icon name="copy" size="small" class="text-icon-weak" />
          {ctx.t("open.copyPath")}
        </Menu.Item>
      </Show>
    </>
  )
}

export function OpenInAppContextMenuV2(
  props: ParentProps<{
    state?: OpenInAppState
    resolvePath: (event: MouseEvent) => string | undefined
    /** Keeps the trigger within its container, for content that clips its own rows rather than scrolling sideways. */
    fit?: boolean
  }>,
) {
  const state = props.state

  if (!state) return props.children
  const [open, setOpen] = createSignal(false)
  const [path, setPath] = createSignal("")
  let hoveredRow: HTMLElement | undefined

  const clearHover = () => {
    if (!hoveredRow) return
    delete hoveredRow.dataset.itemContextHover
    hoveredRow = undefined
  }

  onCleanup(clearHover)

  const closeMenu = () => {
    setOpen(false)
    clearHover()
  }

  return (
    <Show when={state.canOpen()} fallback={props.children}>
      <Menu.Context
        modal={false}
        onOpenChange={(next) => {
          setOpen(next)

          if (!next) clearHover()
        }}
      >
        <Menu.Context.Trigger
          as="div"
          class="h-full w-full flex flex-col min-h-0 flex-1"
          classList={{ "min-w-max": !props.fit, "min-w-0": props.fit }}
          data-slot="file-tree-v2-context-trigger"
          data-context-menu-open={open() ? "" : undefined}
          on:contextmenu={{
            capture: true,
            handleEvent(event: MouseEvent) {
              clearHover()
              const next = props.resolvePath(event)

              if (!next) {
                closeMenu()
                event.preventDefault()
                event.stopPropagation()

                return
              }

              for (const target of event.composedPath()) {
                if (
                  target instanceof HTMLElement &&
                  (target.dataset.type === "item" || target.dataset.slot === "file-tree-v2-row")
                ) {
                  hoveredRow = target
                  target.dataset.itemContextHover = "true"
                  break
                }
              }

              setPath(next)
            },
          }}
        >
          {props.children}
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content class="open-in-app-v2-menu">
            <OpenInAppMenuItemsV2 state={state} path={path} reveal selection={false} close={closeMenu} />
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
    </Show>
  )
}
