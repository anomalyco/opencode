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
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Global } from "@opencode-ai/core/global"
import { openEditor } from "@opencode-ai/tui/editor"
import { registerOpencodeKeymap } from "@opencode-ai/tui/keymap"
import { Session as SessionApi } from "@/session/session"
import * as Locale from "@/util/locale"
import { resolveInteractiveStdin } from "./runtime.stdin"
import { entrySplash, exitSplash, splashMeta } from "./splash"
import { resolveRunTheme } from "./theme"
import type {
  FooterApi,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunInput,
  RunPrompt,
  RunResource,
  RunTuiConfig,
} from "./types"
import { formatModelLabel } from "./variant.shared"

const FOOTER_HEIGHT = 4

// Some environments (Termux + proot, embedded terminals) never deliver
// SIGWINCH to the Bun process, so Bun's process.stdout rows/columns stay
// frozen at the startup value and the renderer never reflows. Poll the real
// terminal size directly through ioctl(TIOCGWINSZ) and push it into the
// renderer via resize(), bypassing the frozen process.stdout cache.
const TIOCGWINSZ = 0x5413
type Winsize = { rows: number; cols: number }

let ioctlFn:
  | ((fd: number, request: number, arg: unknown) => number)
  | undefined
let ffiPtr: ((buffer: ArrayBufferView) => unknown) | undefined
try {
  const ffi = await import("bun:ffi")
  const candidates = [
    "/lib/aarch64-linux-gnu/libc.so.6",
    "/lib/x86_64-linux-gnu/libc.so.6",
    "/usr/lib/x86_64-linux-gnu/libc.so.6",
    "/lib/arm-linux-gnueabihf/libc.so.6",
    "libc.so.6",
  ]
  for (const candidate of candidates) {
    try {
      const lib = ffi.dlopen(candidate, {
        ioctl: { args: ["int", "int", "ptr"], returns: "int" },
      })
      ioctlFn = lib.symbols.ioctl as typeof ioctlFn
      ffiPtr = ffi.ptr as typeof ffiPtr
      break
    } catch {
      // try next libc candidate
    }
  }
} catch {
  ioctlFn = undefined
}

function readTerminalSize(): Winsize | undefined {
  if (!ioctlFn || !ffiPtr) {
    return undefined
  }

  const fds = [process.stdout.fd, 1, 0]
  for (const fd of fds) {
    if (typeof fd !== "number" || fd < 0) {
      continue
    }

    try {
      const winsize = new Uint16Array(4)
      const rc = ioctlFn(fd, TIOCGWINSZ, ffiPtr(winsize))
      if (rc < 0) {
        continue
      }

      const rows = winsize[0]
      const cols = winsize[1]
      if (rows > 0 && cols > 0) {
        return { rows, cols }
      }
    } catch {
      // try next fd
    }
  }

  return undefined
}

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
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: RunAgent[]
  resources: RunResource[]
  sessionID: string
  sessionTitle?: string
  getSessionID?: () => string | undefined
  first: boolean
  history: RunPrompt[]
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  tuiConfig: RunTuiConfig
  backgroundSubagents: boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycleVariant?: () => CycleResult | void
  onModelSelect?: (model: NonNullable<RunInput["model"]>) => CycleResult | void | Promise<CycleResult | void>
  onVariantSelect?: (variant: string | undefined) => CycleResult | void | Promise<CycleResult | void>
  onInterrupt?: () => void
  onBackground?: () => void
  onSubagentSelect?: (sessionID: string | undefined) => void
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
  if (title && !SessionApi.isDefaultTitle(title)) {
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

  if (!input.model) {
    return {
      agentLabel,
      modelLabel: "Model default",
    }
  }

  return {
    agentLabel,
    modelLabel: formatModelLabel(input.model, input.variant),
  }
}

function directoryLabel(directory: string) {
  const resolved = path.resolve(directory)
  const display =
    resolved === Global.Path.home
      ? "~"
      : resolved.startsWith(`${Global.Path.home}${path.sep}`)
        ? resolved.replace(Global.Path.home, "~")
        : resolved
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
  const source = resolveInteractiveStdin()
  let unregisterKeymap: (() => void) | undefined

  try {
    const renderer = await createCliRenderer({
      stdin: source.stdin,
      targetFps: 30,
      maxFps: 60,
      useMouse: false,
      autoFocus: false,
      openConsoleOnError: false,
      exitOnCtrlC: false,
      useKittyKeyboard: { events: process.platform === "win32" },
      screenMode: "split-footer",
      footerHeight: FOOTER_HEIGHT,
      externalOutputMode: "capture-stdout",
      consoleMode: "disabled",
      clearOnShutdown: false,
    })
    const theme = await resolveRunTheme(renderer)
    renderer.setBackgroundColor(theme.background)
    const keymap = createDefaultOpenTuiKeymap(renderer)
    unregisterKeymap = registerOpencodeKeymap(keymap, renderer, input.tuiConfig)
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
    const footerTask = import("./footer")
    const wrote = queueSplash(
      renderer,
      state,
      "entry",
      entrySplash({
        ...meta,
        theme: theme.splash,
        showSession: splash.showSession,
        detail: directoryLabel(input.directory),
      }),
    )
    await renderer.idle().catch(() => {})

    const { RunFooter } = await footerTask
    let closed = false
    let sigintRegistered = false

    // Fallback for environments that never deliver SIGWINCH (Termux/proot):
    // poll the true terminal size via ioctl(TIOCGWINSZ) and notify the renderer
    // when it changes. v3: drop the process.stdout.isTTY gate (opencode may swap
    // process.stdout during TUI setup, which would silently disable the poll),
    // and on change take BOTH insurance paths:
    //   1) renderer.resize() — external resize API (may be a no-op in some builds)
    //   2) process.kill(self, SIGWINCH) — reliably wakes OpenTUI's SIGWINCH
    //      handler, which re-reads the real terminal size and repaints. This is
    //      the path verified to actually reflow under Termux+proot.
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let lastPollSize: Winsize | undefined
    const startSizePoll = () => {
      if (pollTimer) {
        return
      }

      pollTimer = setInterval(() => {
        if (renderer.isDestroyed || closed) {
          return
        }

        const size = readTerminalSize()
        if (!size) {
          return
        }

        if (
          lastPollSize &&
          lastPollSize.rows === size.rows &&
          lastPollSize.cols === size.cols
        ) {
          return
        }

        lastPollSize = size
        try {
          renderer.resize(size.cols, size.rows)
        } catch {
          // ignore
        }
        try {
          process.kill(process.pid, "SIGWINCH")
        } catch {
          // ignore
        }
      }, 300)
    }
    startSizePoll()

    const footer = new RunFooter(renderer, {
      directory: input.directory,
      findFiles: input.findFiles,
      agents: input.agents,
      resources: input.resources,
      sessionID: input.getSessionID ?? (() => input.sessionID),
      ...labels,
      model: input.model,
      variant: input.variant,
      first: input.first,
      history: input.history,
      theme,
      wrote,
      keymap,
      tuiConfig: input.tuiConfig,
      backgroundSubagents: input.backgroundSubagents,
      diffStyle: input.tuiConfig.diff_style ?? "auto",
      onPermissionReply: input.onPermissionReply,
      onQuestionReply: input.onQuestionReply,
      onQuestionReject: input.onQuestionReject,
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
        const ignore = () => {}
        detachSigint()
        process.on("SIGINT", ignore)
        try {
          return await openEditor({
            value,
            cwd: input.directory,
            renderer,
            stdin: source.stdin,
          })
        } finally {
          process.off("SIGINT", ignore)
          attachSigint()
        }
      },
      onSubagentSelect: input.onSubagentSelect,
    })

    const sigint = () => {
      footer.requestExit()
    }

    const attachSigint = () => {
      if (closed || sigintRegistered) {
        return
      }

      process.on("SIGINT", sigint)
      sigintRegistered = true
    }

    const detachSigint = () => {
      if (!sigintRegistered) {
        return
      }

      process.off("SIGINT", sigint)
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
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
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
        unregisterKeymap?.()
        shutdown(renderer)
        if (!wroteExit) {
          process.stdout.write("\n")
        }
        source.cleanup?.()
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
            detail: directoryLabel(input.directory),
          }),
        )
        renderer.requestRender()
      },
      close,
    }
  } catch (error) {
    unregisterKeymap?.()
    source.cleanup?.()
    throw error
  }
}
