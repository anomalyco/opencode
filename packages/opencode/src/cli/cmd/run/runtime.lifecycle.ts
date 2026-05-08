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
import { createCliRenderer, type CliRenderer, type ScrollbackWriter } from "@opentui/core"
import { Session as SessionApi } from "@/session/session"
import * as Locale from "@/util/locale"
import { withRunSpan } from "./otel"
import { resolveInteractiveStdin } from "./runtime.stdin"
import { entrySplash, exitSplash, splashMeta } from "./splash"
import { resolveRunTheme } from "./theme"
import type {
  FooterApi,
  FooterKeybinds,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunDiffStyle,
  RunInput,
  RunPrompt,
  RunResource,
} from "./types"
import { formatModelLabel } from "./variant.shared"

const FOOTER_HEIGHT = 7

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
  keybinds: FooterKeybinds
  diffStyle: RunDiffStyle
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycleVariant?: () => CycleResult | void
  onModelSelect?: (model: NonNullable<RunInput["model"]>) => CycleResult | void | Promise<CycleResult | void>
  onVariantSelect?: (variant: string | undefined) => CycleResult | void | Promise<CycleResult | void>
  onInterrupt?: () => void
  onSubagentSelect?: (sessionID: string | undefined) => void
}

export type Lifecycle = {
  footer: FooterApi
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
  return withRunSpan(
    "RunLifecycle.boot",
    {
      "opencode.agent.name": input.agent,
      "opencode.directory": input.directory,
      "opencode.first": input.first,
      "opencode.model.provider": input.model?.providerID,
      "opencode.model.id": input.model?.modelID,
      "opencode.model.variant": input.variant,
      "session.id": input.getSessionID?.() || input.sessionID || undefined,
    },
    async () => {
      const source = resolveInteractiveStdin()

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
        const state: SplashState = {
          entry: false,
          exit: false,
        }
        const splash = splashInfo(input.sessionTitle, input.history)
        const meta = splashMeta({
          title: splash.title,
          session_id: input.sessionID,
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
          }),
        )
        await renderer.idle().catch(() => {})

        const { RunFooter } = await footerTask

        const labels = footerLabels({
          agent: input.agent,
          model: input.model,
          variant: input.variant,
        })
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
          keybinds: input.keybinds,
          diffStyle: input.diffStyle,
          onPermissionReply: input.onPermissionReply,
          onQuestionReply: input.onQuestionReply,
          onQuestionReject: input.onQuestionReject,
          onCycleVariant: input.onCycleVariant,
          onModelSelect: input.onModelSelect,
          onVariantSelect: input.onVariantSelect,
          onInterrupt: input.onInterrupt,
          onSubagentSelect: input.onSubagentSelect,
        })

        const sigint = () => {
          footer.requestExit()
        }
        process.on("SIGINT", sigint)

        let closed = false
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
          return withRunSpan(
            "RunLifecycle.close",
            {
              "opencode.show_exit": next.showExit,
              "session.id": next.sessionID || input.getSessionID?.() || input.sessionID || undefined,
            },
            async () => {
              process.off("SIGINT", sigint)

              try {
                await footer.idle().catch(() => {})

                const show = renderer.isDestroyed ? false : next.showExit
                if (!renderer.isDestroyed && show) {
                  const sessionID = next.sessionID || input.getSessionID?.() || input.sessionID
                  const splash = splashInfo(next.sessionTitle ?? input.sessionTitle, next.history ?? input.history)
                  queueSplash(
                    renderer,
                    state,
                    "exit",
                    exitSplash({
                      ...splashMeta({
                        title: splash.title,
                        session_id: sessionID,
                      }),
                      theme: theme.splash,
                    }),
                  )
                  await renderer.idle().catch(() => {})
                }
              } finally {
                footer.close()
                await footer.idle().catch(() => {})
                footer.destroy()
                shutdown(renderer)
                source.cleanup?.()
              }
            },
          )
        }

        return {
          footer,
          close,
        }
      } catch (error) {
        source.cleanup?.()
        throw error
      }
    },
  )
}
