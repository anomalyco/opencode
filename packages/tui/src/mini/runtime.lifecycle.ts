// Lifecycle management for the split-footer renderer.
//
// Creates the OpenTUI CliRenderer in split-footer mode, resolves the theme
// from the terminal palette, writes the entry splash to scrollback, and
// constructs the RunFooter. Returns a Lifecycle handle whose close() writes
// the exit splash and tears everything down in the right order:
// footer.close → footer.destroy → renderer shutdown.
//
// Also wires SIGINT so Ctrl-c clears a live prompt draft first, then falls
// back to the usual two-press exit sequence through RunFooter.requestExit().
import path from "path"
import { CliRenderEvents, createCliRenderer, type CliRenderer, type ScrollbackWriter } from "@opentui/core"
import { isDefaultTitle } from "../util/session"
import { Locale } from "../util/locale"
import { entrySplash, exitSplash, splashMeta } from "./splash"
import { resolveRunTheme } from "./theme"
import type {
  FooterApi,
  FormCancel,
  FormReply,
  MiniHost,
  PermissionReply,
  RunAgent,
  RunInput,
  RunPrompt,
  RunReference,
  RunTuiConfig,
} from "./types"
import { formatModelLabel } from "./variant.shared"

const FOOTER_HEIGHT = 4

type SplashState = {
  entry: boolean
  exit: boolean
}

type CycleResult = {
  modelLabel?: string
  status?: string
  variant?: string | undefined
  variants?: string[]
}

type FooterLabels = {
  agentLabel: string
  modelLabel: string
}

export type LifecycleInput = {
  host: MiniHost
  getDirectory: () => string
  findFiles: (query: string) => Promise<string[]>
  agents: RunAgent[]
  references: RunReference[]
  sessionID: string
  sessionTitle?: string
  getSessionID?: () => string | undefined
  first: boolean
  history: RunPrompt[]
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  tuiConfig: RunTuiConfig | Promise<RunTuiConfig>
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onFormReply: (input: FormReply) => void | Promise<void>
  onFormCancel: (input: FormCancel) => void | Promise<void>
  onCycleVariant?: () => CycleResult | void
  onModelSelect?: (model: NonNullable<RunInput["model"]>) => CycleResult | void | Promise<CycleResult | void>
  onVariantSelect?: (variant: string | undefined) => CycleResult | void | Promise<CycleResult | void>
  onInterrupt?: () => void
  onBackground?: () => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  onSubagentInterrupt?: (sessionID: string) => void
}

export type Lifecycle = {
  footer: FooterApi
  onResize(fn: () => void): () => void
  refreshTheme(): void
  resetForReplay(input: { sessionTitle?: string; sessionID?: string; history: RunPrompt[] }): Promise<void>
  close(input: { showExit: boolean; sessionTitle?: string; sessionID?: string; history?: RunPrompt[] }): Promise<void>
}

// Gracefully tears down the renderer. Order matters: switch external output
// back to passthrough before leaving split-footer mode, so pending stdout
// doesn't get captured into the now-dead scrollback pipeline.
function shutdown(renderer: CliRenderer): void {
  if (renderer.isDestroyed) {
    return
  }

  if (renderer.externalOutputMode === "capture-stdout") {
    renderer.externalOutputMode = "passthrough"
  }

  if (renderer.screenMode === "split-footer") {
    renderer.screenMode = "main-screen"
  }

  if (!renderer.isDestroyed) {
    renderer.destroy()
  }
}

function splashInfo(title: string | undefined, history: RunPrompt[]) {
  if (title && !isDefaultTitle(title)) {
    return {
      title,
      showSession: true,
    }
  }

  const next = history.find((item) => item.text.trim().length > 0)
  return {
    title: next?.text ?? title,
    showSession: !!next,
  }
}

function footerLabels(input: Pick<RunInput, "agent" | "model" | "variant">): FooterLabels {
  const agentLabel = Locale.titlecase(input.agent ?? "build")
  return {
    agentLabel,
    modelLabel: input.model ? formatModelLabel(input.model, input.variant) : "",
  }
}

function directoryLabel(directory: string, home: string) {
  const resolved = path.resolve(directory)
  const display =
    resolved === home ? "~" : resolved.startsWith(`${home}${path.sep}`) ? resolved.replace(home, "~") : resolved
  return display.replaceAll("\\", "/")
}

function queueSplash(
  renderer: Pick<CliRenderer, "writeToScrollback" | "requestRender">,
  state: SplashState,
  phase: keyof SplashState,
  write: ScrollbackWriter | undefined,
): boolean {
  if (state[phase]) {
    return false
  }

  if (!write) {
    return false
  }

  state[phase] = true
  renderer.writeToScrollback(write)
  renderer.requestRender()
  return true
}

// Boots the split-footer renderer and constructs the RunFooter.
//
// The renderer starts in split-footer mode with captured stdout so that
// scrollback commits and footer repaints happen in the same frame. After
// the entry splash, RunFooter takes over the footer region.
export async function createRuntimeLifecycle(input: LifecycleInput): Promise<Lifecycle> {
  const footerTask = import("./footer")
  const renderer = await createCliRenderer({
    stdin: input.host.terminal.stdin,
    targetFps: 30,
    maxFps: 60,
    useMouse: false,
    autoFocus: false,
    openConsoleOnError: false,
    exitOnCtrlC: false,
    useKittyKeyboard: { events: input.host.platform === "win32" },
    screenMode: "split-footer",
    footerHeight: FOOTER_HEIGHT,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
    clearOnShutdown: false,
  })
  const tuiConfig = await input.tuiConfig
  const theme = await resolveRunTheme(renderer, tuiConfig.theme)
  renderer.setBackgroundColor(theme.background)
  const state: SplashState = {
    entry: false,
    exit: false,
  }
  const splash = splashInfo(input.sessionTitle, input.history)
  const meta = splashMeta({
    title: splash.title,
    session_id: input.sessionID,
  })
  const labels = footerLabels({
    agent: input.agent,
    model: input.model,
    variant: input.variant,
  })
  const wrote = queueSplash(
    renderer,
    state,
    "entry",
    entrySplash({
      ...meta,
      theme: theme.splash,
      showSession: splash.showSession,
      detail: directoryLabel(input.getDirectory(), input.host.paths.home),
    }),
  )
  await renderer.idle().catch(() => {})

  const { RunFooter } = await footerTask
  let closed = false
  let sigintRegistered = false
  let detachSigintListener: (() => void) | undefined

  const footer = new RunFooter(renderer, {
    directory: input.getDirectory,
    findFiles: input.findFiles,
    agents: input.agents,
    references: input.references,
    sessionID: input.getSessionID ?? (() => input.sessionID),
    ...labels,
    model: input.model,
    variant: input.variant,
    first: input.first,
    history: input.history,
    theme,
    wrote,
    tuiConfig,
    onPermissionReply: input.onPermissionReply,
    onFormReply: input.onFormReply,
    onFormCancel: input.onFormCancel,
    onCycleVariant: input.onCycleVariant,
    onModelSelect: input.onModelSelect,
    onVariantSelect: input.onVariantSelect,
    onInterrupt: input.onInterrupt,
    onBackground: input.onBackground,
    onEditorOpen: async ({ value }) => {
      if (closed || renderer.isDestroyed) {
        return
      }

      await renderer.idle().catch(() => {})
      detachSigint()
      const detachIgnore = input.host.signals.sigint.subscribe(() => {})
      try {
        return await input.host.editor.open({
          value,
          cwd: input.getDirectory(),
          renderer,
          stdin: input.host.terminal.stdin,
        })
      } finally {
        detachIgnore()
        attachSigint()
      }
    },
    subscribeThemeSignal: input.host.signals.sigusr2.subscribe,
    onSubagentSelect: input.onSubagentSelect,
    onSubagentInterrupt: input.onSubagentInterrupt,
  })

  const sigint = () => {
    footer.requestExit()
  }

  const attachSigint = () => {
    if (closed || sigintRegistered) {
      return
    }

    detachSigintListener = input.host.signals.sigint.subscribe(sigint)
    sigintRegistered = true
  }

  const detachSigint = () => {
    if (!sigintRegistered) {
      return
    }

    detachSigintListener?.()
    detachSigintListener = undefined
    sigintRegistered = false
  }

  attachSigint()

  const close = async (next: {
    showExit: boolean
    sessionTitle?: string
    sessionID?: string
    history?: RunPrompt[]
  }) => {
    if (closed) {
      return
    }

    closed = true
    detachSigint()
    let wroteExit = false

    try {
      await footer.idle().catch(() => {})

      const show = renderer.isDestroyed ? false : next.showExit
      if (!renderer.isDestroyed && show) {
        const sessionID = next.sessionID || input.getSessionID?.() || input.sessionID
        const splash = splashInfo(next.sessionTitle ?? input.sessionTitle, next.history ?? input.history)
        wroteExit = queueSplash(
          renderer,
          state,
          "exit",
          exitSplash({
            ...splashMeta({
              title: splash.title,
              session_id: sessionID,
            }),
            theme: footer.currentTheme().splash,
          }),
        )
        await renderer.idle().catch(() => {})
      }
    } finally {
      footer.close()
      await footer.idle().catch(() => {})
      footer.destroy()
      shutdown(renderer)
      if (!wroteExit) {
        input.host.stdout.write("\n")
      }
    }
  }

  return {
    footer,
    refreshTheme() {
      footer.refreshTheme()
    },
    onResize(fn) {
      let width = renderer.terminalWidth
      let height = renderer.terminalHeight
      const resize = () => {
        if (width === renderer.terminalWidth && height === renderer.terminalHeight) {
          return
        }

        width = renderer.terminalWidth
        height = renderer.terminalHeight
        fn()
      }
      renderer.on(CliRenderEvents.RESIZE, resize)
      return () => renderer.off(CliRenderEvents.RESIZE, resize)
    },
    async resetForReplay(next) {
      if (closed || renderer.isDestroyed || footer.isClosed) {
        throw new Error("runtime closed")
      }

      await footer.idle()
      if (closed || renderer.isDestroyed || footer.isClosed) {
        throw new Error("runtime closed")
      }

      footer.resetForReplay(true)
      renderer.resetSplitFooterForReplay({ clearSavedLines: true })
      const splash = splashInfo(next.sessionTitle ?? input.sessionTitle, next.history)
      renderer.writeToScrollback(
        entrySplash({
          ...splashMeta({
            title: splash.title,
            session_id: next.sessionID ?? input.getSessionID?.() ?? input.sessionID,
          }),
          theme: footer.currentTheme().splash,
          showSession: splash.showSession,
          detail: directoryLabel(input.getDirectory(), input.host.paths.home),
        }),
      )
      renderer.requestRender()
      await renderer.idle().catch(() => {})
    },
    close,
  }
}
