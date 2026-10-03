// The first-run tab: a live checklist for connecting to opencode, allowing site scripts, Browser Control,
// and opening the side panel. It watches the background's setup status over its own port.
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Logo } from "@opencode/ui/logo"
import { Spinner } from "@opencode/ui/spinner"
import { ThemeProvider } from "@opencode/ui/theme/context"
import { Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import {
  WELCOME_PORT,
  type FromWelcome,
  type RelayState,
  type ServiceState,
  type ToWelcome,
} from "../shared/protocol"
import type { SiteScriptsState } from "../shared/site-script"
import {
  CommandBlock,
  INSTALL_COMMAND,
  sentence,
  KeyCaps,
  RelayProblemFix,
  UserScriptsSteps,
  Waiting,
  createServiceWatch,
  createShortcut,
  relayProblem,
  relayProblemTitle,
} from "../sidepanel/onboarding"

const reconnectDelay = 300

function createStatus() {
  const [state, setState] = createStore<{
    service: ServiceState
    scripts: SiteScriptsState
    browserControl: RelayState
  }>({
    service: { status: "loading" },
    // Assume allowed until the worker says otherwise, so the step does not flash its instructions.
    scripts: { available: true, scripts: [] },
    browserControl: { status: "offline", tabs: [] },
  })
  let port: chrome.runtime.Port | undefined
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const connect = () => {
    const next = chrome.runtime.connect({ name: WELCOME_PORT })
    port = next
    next.onMessage.addListener((message: ToWelcome) => {
      if (message.type === "service") return setState("service", message.state)
      if (message.type === "scripts") return setState("scripts", reconcile(message.state))
      if (message.type === "browserControl") setState("browserControl", reconcile(message.state))
    })
    // The worker may restart at any time; reconnect and it sends the current status again.
    next.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      if (port === next) port = undefined
      if (disposed) return
      clearTimeout(timer)
      timer = setTimeout(connect, reconnectDelay)
    })
  }
  connect()
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
    port?.disconnect()
  })
  return {
    state,
    send(message: FromWelcome) {
      try {
        port?.postMessage(message)
      } catch {
        port = undefined
      }
    },
  }
}

/** Whether a side panel is open in any window, for the last step. */
function createPanelOpen() {
  const [open, setOpen] = createSignal(false)
  const check = () =>
    void chrome.runtime
      .getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] })
      .then((contexts) => setOpen(contexts.length > 0))
      .catch(() => undefined)
  check()
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") check()
  }, 1_500)
  onCleanup(() => clearInterval(timer))
  return open
}

export function Welcome() {
  return (
    <ThemeProvider>
      <Page />
    </ThemeProvider>
  )
}

function Page() {
  const status = createStatus()
  const service = createServiceWatch({
    state: () => status.state.service,
    refresh: () => status.send({ type: "service.refresh" }),
  })
  const panelOpen = createPanelOpen()
  const shortcut = createShortcut()
  // sidePanel.open must run inside the click, so the window is known before then.
  const [windowID, setWindowID] = createSignal<number>()
  onMount(() => void chrome.tabs.getCurrent().then((tab) => setWindowID(tab?.windowId)))

  // Coming back from the extensions page: re-check user scripts without a click.
  const recheck = () => {
    if (document.visibilityState === "visible") status.send({ type: "scripts.refresh" })
  }
  window.addEventListener("focus", recheck)
  document.addEventListener("visibilitychange", recheck)
  onCleanup(() => {
    window.removeEventListener("focus", recheck)
    document.removeEventListener("visibilitychange", recheck)
  })

  const relay = () => status.state.browserControl.status
  const problem = () => relayProblem(relay())
  const ready = () => {
    const state = service.state()
    return state.status === "ready" ? state.info : undefined
  }
  const failure = () => {
    const state = service.state()
    return state.status === "error" ? state : undefined
  }
  const host = (url: string) => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  const openPanel = () => {
    void chrome.sidePanel.open({ windowId: windowID() ?? chrome.windows.WINDOW_ID_CURRENT }).catch(() => undefined)
  }

  return (
    <main class="flex min-h-dvh justify-center px-5 pt-14 pb-12 sm:px-8 sm:pt-20">
      <div class="flex w-full max-w-[560px] flex-col">
        <Logo class="block aspect-[234/42] w-[124px] self-start" />
        <h1 class="mt-6 text-[22px] font-[530] leading-7 tracking-[-0.3px] text-v2-text-text-base">
          Welcome to OpenCode Browser
        </h1>
        <p class="mt-1.5 max-w-[480px] text-[14px] leading-[22px] text-v2-text-text-muted">
          Chat with opencode in a side panel, let agents work in your tabs, and reshape sites with site scripts.
        </p>

        <ol class="mt-8 flex flex-col overflow-hidden rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base">
          <Step
            n={1}
            title="Connect to opencode"
            marker={ready() ? "done" : failure()?.hostMissing ? "todo" : failure() ? "attention" : "loading"}
            label={
              <Switch fallback={<StatusLabel>Checking…</StatusLabel>}>
                <Match when={ready()}>
                  <StatusLabel tone="success">Connected</StatusLabel>
                </Match>
                <Match when={failure()?.hostMissing}>
                  <StatusLabel>Not set up</StatusLabel>
                </Match>
                <Match when={failure()}>
                  <StatusLabel tone="warning">Not reachable</StatusLabel>
                </Match>
              </Switch>
            }
          >
            <Switch fallback={<Description>Looking for opencode on this computer…</Description>}>
              <Match when={ready()}>
                {(info) => (
                  <Description>
                    Using opencode at <span class="text-v2-text-text-base">{host(info().url)}</span>
                    {info().source === "manual" ? ", set manually." : "."}
                  </Description>
                )}
              </Match>
              <Match when={failure()?.hostMissing}>
                <Description>
                  OpenCode Browser reaches opencode through a small helper. Run this once in a terminal. It installs the
                  helper and starts opencode.
                </Description>
                <CommandBlock command={INSTALL_COMMAND} class="mt-3" />
                <Waiting checking={service.checking()} onRetry={service.retry}>
                  Waiting for opencode. This page updates on its own.
                </Waiting>
              </Match>
              <Match when={failure()}>
                {(error) => (
                  <>
                    <Description>
                      <span class="break-words">{sentence(error().message)}</span> Run the install command again to
                      start opencode.
                    </Description>
                    <CommandBlock command={INSTALL_COMMAND} class="mt-3" />
                    <Waiting checking={service.checking()} onRetry={service.retry}>
                      Checking again every few seconds.
                    </Waiting>
                  </>
                )}
              </Match>
            </Switch>
          </Step>

          <Step
            n={2}
            title="Allow site scripts"
            optional
            marker={status.state.scripts.available ? "done" : "todo"}
            label={
              status.state.scripts.available ? (
                <StatusLabel tone="success">Allowed</StatusLabel>
              ) : (
                <StatusLabel>Off</StatusLabel>
              )
            }
          >
            <Description>Agents can install scripts that change how sites look and work, with your approval.</Description>
            <Show when={!status.state.scripts.available}>
              <UserScriptsSteps class="mt-3" onCheck={() => status.send({ type: "scripts.refresh" })} />
            </Show>
          </Step>

          <Step
            n={3}
            title="Browser Control"
            marker={problem() ? "attention" : "done"}
            label={
              <Switch fallback={<StatusLabel>Idle</StatusLabel>}>
                <Match when={relay() === "connected"}>
                  <StatusLabel tone="success">Connected</StatusLabel>
                </Match>
                <Match when={problem()}>
                  <StatusLabel tone="warning">Needs attention</StatusLabel>
                </Match>
              </Switch>
            }
          >
            <Show
              when={problem()}
              fallback={
                <Description>
                  {relay() === "connected"
                    ? "Connected. Browser Control agents can use the tabs you let them."
                    : "Ready. It connects on its own when an agent starts using Browser Control."}
                </Description>
              }
            >
              {(value) => (
                <>
                  <Description>{relayProblemTitle(value())}.</Description>
                  <div class="mt-2">
                    <RelayProblemFix
                      problem={value()}
                      hideTitle
                      onReconnect={() => status.send({ type: "browserControl.reconnect" })}
                    />
                  </div>
                </>
              )}
            </Show>
          </Step>

          <Step
            n={4}
            title="Open the side panel"
            marker={panelOpen() ? "done" : "todo"}
            label={panelOpen() ? <StatusLabel tone="success">Open</StatusLabel> : undefined}
          >
            <Description>Chat with opencode next to any page, and see what agents do in your tabs.</Description>
            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button variant={panelOpen() ? "neutral" : "submit"} size="normal" icon="sidebar-right" onClick={openPanel}>
                Open side panel
              </Button>
              <Show
                when={shortcut().length > 0}
                fallback={
                  <button
                    type="button"
                    class="text-12-regular text-v2-text-text-muted underline decoration-v2-border-border-base underline-offset-2 hover:text-v2-text-text-base"
                    onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
                  >
                    Set a keyboard shortcut
                  </button>
                }
              >
                <span class="flex items-center gap-2 text-12-regular text-v2-text-text-faint">
                  or press <KeyCaps keys={shortcut()} />
                </span>
              </Show>
            </div>
            <p class="mt-3 flex items-start gap-1.5 text-12-regular leading-[18px] text-v2-text-text-faint">
              <PuzzleIcon />
              <span>Pin OpenCode Browser from the extensions menu to open it in one click.</span>
            </p>
          </Step>
        </ol>

        <p class="mt-5 text-12-regular leading-[18px] text-v2-text-text-faint">
          {ready() && !problem()
            ? "You're set. You can close this tab."
            : "You can close this tab anytime. The side panel walks you through anything that's missing."}
        </p>
      </div>
    </main>
  )
}

type Marker = "done" | "todo" | "loading" | "attention"

function Step(props: {
  n: number
  title: string
  optional?: boolean
  marker: Marker
  label?: JSX.Element
  children: JSX.Element
}) {
  return (
    <li class="flex gap-3 border-t border-v2-border-border-muted px-4 py-4 first:border-t-0 sm:px-5">
      <StepMarker n={props.n} marker={props.marker} />
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-h-5 items-center justify-between gap-3">
          <h2 class="flex min-w-0 items-center gap-2 text-[13px] font-[530] leading-5 text-v2-text-text-base">
            <span class="truncate">{props.title}</span>
            <Show when={props.optional}>
              <span class="shrink-0 text-12-regular text-v2-text-text-faint">Optional</span>
            </Show>
          </h2>
          {props.label}
        </div>
        {props.children}
      </div>
    </li>
  )
}

function StepMarker(props: { n: number; marker: Marker }) {
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center rounded-full text-12-medium tabular-nums"
      classList={{
        "bg-v2-state-bg-success text-v2-state-fg-success": props.marker === "done",
        "bg-v2-state-bg-warning text-v2-state-fg-warning": props.marker === "attention",
        "border border-v2-border-border-base text-v2-text-text-muted": props.marker === "todo",
        "text-v2-icon-icon-muted": props.marker === "loading",
      }}
    >
      <Switch fallback={props.n}>
        <Match when={props.marker === "done"}>
          <Icon name="check-small" size="small" />
        </Match>
        <Match when={props.marker === "attention"}>
          <span aria-hidden="true" class="text-[11px] font-[600] leading-none">
            !
          </span>
        </Match>
        <Match when={props.marker === "loading"}>
          <Spinner class="size-3.5" />
        </Match>
      </Switch>
    </span>
  )
}

function StatusLabel(props: { tone?: "success" | "warning"; children: string }) {
  return (
    <span
      class="shrink-0 text-12-regular leading-5"
      classList={{
        "text-v2-state-fg-success": props.tone === "success",
        "text-v2-state-fg-warning": props.tone === "warning",
        "text-v2-text-text-faint": !props.tone,
      }}
    >
      {props.children}
    </span>
  )
}

function Description(props: { children: JSX.Element }) {
  return <p class="mt-0.5 text-12-regular leading-[18px] text-v2-text-text-muted">{props.children}</p>
}

/** The browser's extensions (puzzle piece) button, for the pin hint. */
function PuzzleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="mt-0.5 shrink-0">
      <path
        d="M6.5 2.5a1.5 1.5 0 0 1 3 0V4H12v2.5h-1a1.5 1.5 0 0 0 0 3h1V12H9.5v-1a1.5 1.5 0 0 0-3 0v1H4V9.5H2.5a1.5 1.5 0 0 1 0-3H4V4h2.5V2.5Z"
        stroke="currentColor"
        stroke-linejoin="round"
      />
    </svg>
  )
}
