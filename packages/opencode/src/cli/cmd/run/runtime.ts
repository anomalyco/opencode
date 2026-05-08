// Top-level orchestrator for `run --interactive`.
//
// Wires the boot sequence, lifecycle (renderer + footer), stream transport,
// and prompt queue together into a single session loop. Two entry points:
//
//   runInteractiveMode     -- used when an SDK client already exists (attach mode)
//   runInteractiveLocalMode -- used for local in-process mode (no server)
//
// Both delegate to runInteractiveRuntime, which:
//   1. resolves keybinds, diff style, model info, and session history,
//   2. creates the split-footer lifecycle (renderer + RunFooter),
//   3. starts the stream transport (SDK event subscription), lazily for fresh
//      local sessions,
//   4. runs the prompt queue until the footer closes.
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createRunDemo } from "./demo"
import { resolveDiffStyle, resolveFooterKeybinds, resolveModelInfo, resolveSessionInfo } from "./runtime.boot"
import { createRuntimeLifecycle } from "./runtime.lifecycle"
import { recordRunSpanError, setRunSpanAttributes, withRunSpan } from "./otel"
import { trace } from "./trace"
import { cycleVariant, formatModelLabel, resolveSavedVariant, resolveVariant, saveVariant } from "./variant.shared"
import type { RunInput, RunPrompt, RunProvider } from "./types"

/** @internal Exported for testing */
export { pickVariant, resolveVariant } from "./variant.shared"

/** @internal Exported for testing */
export { runPromptQueue } from "./runtime.queue"

type BootContext = Pick<
  RunInput,
  "sdk" | "directory" | "sessionID" | "sessionTitle" | "resume" | "agent" | "model" | "variant"
>

type CreateSessionInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
}

type CreateSession = (
  sdk: RunInput["sdk"],
  input: CreateSessionInput,
) => Promise<{ id: string; title?: string }>

type RunRuntimeInput = {
  boot: () => Promise<BootContext>
  afterPaint?: (ctx: BootContext) => Promise<void> | void
  resolveSession?: (
    ctx: BootContext,
  ) => Promise<{ sessionID: string; sessionTitle?: string; agent?: string | undefined }>
  createSession?: (ctx: BootContext, input: CreateSessionInput) => Promise<ResolvedSession>
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  demo?: RunInput["demo"]
}

type RunLocalInput = {
  directory: string
  fetch: typeof globalThis.fetch
  resolveAgent: () => Promise<string | undefined>
  session: (sdk: RunInput["sdk"]) => Promise<{ id: string; title?: string } | undefined>
  share: (sdk: RunInput["sdk"], sessionID: string) => Promise<void>
  createSession?: CreateSession
  agent: RunInput["agent"]
  model: RunInput["model"]
  variant: RunInput["variant"]
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  demo?: RunInput["demo"]
}

type StreamState = {
  mod: Awaited<typeof import("./stream.transport")>
  handle: Awaited<ReturnType<Awaited<typeof import("./stream.transport")>["createSessionTransport"]>>
}

type ResolvedSession = {
  sessionID: string
  sessionTitle?: string
  agent?: string | undefined
}

function createSessionResolver(fn?: CreateSession) {
  if (!fn) {
    return undefined
  }

  return async (ctx: BootContext, input: CreateSessionInput): Promise<ResolvedSession> => {
    const created = await fn(ctx.sdk, input)
    if (!created.id) {
      throw new Error("Failed to create session")
    }

    return {
      sessionID: created.id,
      sessionTitle: created.title,
      agent: input.agent,
    }
  }
}

type RuntimeState = {
  shown: boolean
  aborting: boolean
  model: RunInput["model"]
  providers: RunProvider[]
  variants: string[]
  limits: Record<string, number>
  activeVariant: string | undefined
  sessionID: string
  history: RunPrompt[]
  sessionTitle?: string
  agent: string | undefined
  switching?: Promise<void>
  demo?: ReturnType<typeof createRunDemo>
  selectSubagent?: (sessionID: string | undefined) => void
  session?: Promise<void>
  stream?: Promise<StreamState>
}

function hasSession(input: RunRuntimeInput, state: RuntimeState) {
  return !input.resolveSession || !!state.sessionID
}

function eagerStream(input: RunRuntimeInput, ctx: BootContext) {
  return ctx.resume === true || !input.resolveSession || !!input.demo
}

function variantsFor(providers: RunProvider[], model: RunInput["model"]) {
  if (!model) {
    return []
  }

  return Object.keys(providers.find((item) => item.id === model.providerID)?.models?.[model.modelID]?.variants ?? {})
}

async function resolveExitTitle(
  ctx: BootContext,
  input: RunRuntimeInput,
  state: RuntimeState,
): Promise<string | undefined> {
  if (!state.shown || !hasSession(input, state)) {
    return undefined
  }

  return ctx.sdk.session
    .get({
      sessionID: state.sessionID,
    })
    .then((x) => x.data?.title)
    .catch(() => undefined)
}

// Core runtime loop. Boot resolves the SDK context, then we set up the
// lifecycle (renderer + footer), wire the stream transport for SDK events,
// and feed prompts through the queue until the user exits.
//
// Files only attach on the first prompt turn -- after that, includeFiles
// flips to false so subsequent turns don't re-send attachments.
async function runInteractiveRuntime(input: RunRuntimeInput): Promise<void> {
  return withRunSpan(
    "RunInteractive.session",
    {
      "opencode.mode": input.resolveSession ? "local" : "attach",
      "opencode.initial_input": !!input.initialInput,
      "opencode.demo": input.demo,
    },
    async (span) => {
      const start = performance.now()
      const log = trace()
      const keybindTask = resolveFooterKeybinds()
      const diffTask = resolveDiffStyle()
      const ctx = await input.boot()
      const modelTask = resolveModelInfo(ctx.sdk, ctx.directory, ctx.model)
      const sessionTask =
        ctx.resume === true
          ? resolveSessionInfo(ctx.sdk, ctx.sessionID, ctx.model)
          : Promise.resolve({
              first: true,
              history: [],
              variant: undefined,
            })
      const savedTask = resolveSavedVariant(ctx.model)
      const [keybinds, diffStyle, session, savedVariant] = await Promise.all([
        keybindTask,
        diffTask,
        sessionTask,
        savedTask,
      ])
      const state: RuntimeState = {
        shown: !session.first,
        aborting: false,
        model: ctx.model,
        providers: [],
        variants: [],
        limits: {},
        activeVariant: resolveVariant(ctx.variant, session.variant, savedVariant, []),
        sessionID: ctx.sessionID,
        history: [...session.history],
        sessionTitle: ctx.sessionTitle,
        agent: ctx.agent,
      }
      setRunSpanAttributes(span, {
        "opencode.directory": ctx.directory,
        "opencode.resume": ctx.resume === true,
        "opencode.agent.name": state.agent,
        "opencode.model.provider": state.model?.providerID,
        "opencode.model.id": state.model?.modelID,
        "opencode.model.variant": state.activeVariant,
        "session.id": state.sessionID || undefined,
      })
      const ensureSession = () => {
        if (!input.resolveSession || state.sessionID) {
          return Promise.resolve()
        }

        if (state.session) {
          return state.session
        }

        state.session = input.resolveSession(ctx).then((next) => {
          state.sessionID = next.sessionID
          state.sessionTitle = next.sessionTitle ?? state.sessionTitle
          state.agent = next.agent
          setRunSpanAttributes(span, {
            "opencode.agent.name": state.agent,
            "session.id": state.sessionID,
          })
        })
        return state.session
      }

      const shell = await createRuntimeLifecycle({
        directory: ctx.directory,
        findFiles: (query) =>
          ctx.sdk.find
            .files({ query, directory: ctx.directory })
            .then((x) => x.data ?? [])
            .catch(() => []),
        agents: [],
        resources: [],
        sessionID: state.sessionID,
        sessionTitle: state.sessionTitle,
        getSessionID: () => state.sessionID,
        first: session.first,
        history: session.history,
        agent: state.agent,
        model: state.model,
        variant: state.activeVariant,
        keybinds,
        diffStyle,
        onPermissionReply: async (next) => {
          if (state.demo?.permission(next)) {
            return
          }

          log?.write("send.permission.reply", next)
          await ctx.sdk.permission.reply(next)
        },
        onQuestionReply: async (next) => {
          if (state.demo?.questionReply(next)) {
            return
          }

          await ctx.sdk.question.reply(next)
        },
        onQuestionReject: async (next) => {
          if (state.demo?.questionReject(next)) {
            return
          }

          await ctx.sdk.question.reject(next)
        },
        onCycleVariant: () => {
          if (!state.model || state.variants.length === 0) {
            return {
              status: "no variants available",
            }
          }

          state.activeVariant = cycleVariant(state.activeVariant, state.variants)
          saveVariant(state.model, state.activeVariant)
          setRunSpanAttributes(span, {
            "opencode.model.variant": state.activeVariant,
          })
          return {
            status: state.activeVariant ? `variant ${state.activeVariant}` : "variant default",
            modelLabel: formatModelLabel(state.model, state.activeVariant, state.providers),
            variant: state.activeVariant,
          }
        },
        onModelSelect: async (model) => {
          if (state.model?.providerID === model.providerID && state.model.modelID === model.modelID) {
            return
          }

          state.model = model
          state.activeVariant = undefined
          state.variants = variantsFor(state.providers, model)
          const switching = resolveSavedVariant(model).then((saved) => {
            const current = state.model
            if (!current || current.providerID !== model.providerID || current.modelID !== model.modelID) {
              return
            }

            state.activeVariant = resolveVariant(ctx.variant, undefined, saved, state.variants)
          })
          state.switching = switching
          await switching
          if (state.switching === switching) {
            state.switching = undefined
          }

          const current = state.model
          if (!current || current.providerID !== model.providerID || current.modelID !== model.modelID) {
            return
          }

          setRunSpanAttributes(span, {
            "opencode.model.provider": model.providerID,
            "opencode.model.id": model.modelID,
            "opencode.model.variant": state.activeVariant,
          })
          return {
            modelLabel: formatModelLabel(model, state.activeVariant, state.providers),
            status: `model ${model.modelID}`,
            variant: state.activeVariant,
            variants: state.variants,
          }
        },
        onVariantSelect: async (variant) => {
          if (!state.model || state.variants.length === 0) {
            return {
              status: "no variants available",
            }
          }

          if (variant && !state.variants.includes(variant)) {
            return {
              status: `variant ${variant} unavailable`,
            }
          }

          state.activeVariant = variant
          saveVariant(state.model, state.activeVariant)
          setRunSpanAttributes(span, {
            "opencode.model.variant": state.activeVariant,
          })
          return {
            status: state.activeVariant ? `variant ${state.activeVariant}` : "variant default",
            modelLabel: formatModelLabel(state.model, state.activeVariant, state.providers),
            variant: state.activeVariant,
            variants: state.variants,
          }
        },
        onInterrupt: () => {
          if (!hasSession(input, state) || state.aborting) {
            return
          }

          state.aborting = true
          void ctx.sdk.session
            .abort({
              sessionID: state.sessionID,
            })
            .catch(() => {})
            .finally(() => {
              state.aborting = false
            })
        },
        onSubagentSelect: (sessionID) => {
          state.selectSubagent?.(sessionID)
          log?.write("subagent.select", {
            sessionID,
          })
        },
      })
      const footer = shell.footer

      const loadCatalog = async (): Promise<void> => {
        if (footer.isClosed) {
          return
        }

        const [agents, resources, commands] = await Promise.all([
          ctx.sdk.app
            .agents({ directory: ctx.directory })
            .then((x) => x.data ?? [])
            .catch(() => []),
          ctx.sdk.experimental.resource
            .list({ directory: ctx.directory })
            .then((x) => Object.values(x.data ?? {}))
            .catch(() => []),
          ctx.sdk.command
            .list({ directory: ctx.directory })
            .then((x) => x.data ?? [])
            .catch(() => []),
        ])
        if (footer.isClosed) {
          return
        }

        footer.event({
          type: "catalog",
          agents,
          resources,
          commands,
        })
      }

      void footer
        .idle()
        .then(loadCatalog)
        .catch(() => {})

      if (Flag.OPENCODE_SHOW_TTFD) {
        footer.append({
          kind: "system",
          text: `startup ${Math.max(0, Math.round(performance.now() - start))}ms`,
          phase: "final",
          source: "system",
        })
      }

      if (input.demo) {
        await ensureSession()
        state.demo = createRunDemo({
          footer,
          sessionID: state.sessionID,
          thinking: input.thinking,
          limits: () => state.limits,
        })
      }

      if (input.afterPaint) {
        void Promise.resolve(input.afterPaint(ctx)).catch(() => {})
      }

      void modelTask.then((info) => {
        state.providers = info.providers
        state.variants = variantsFor(state.providers, state.model)
        state.limits = info.limits

        const next = resolveVariant(ctx.variant, session.variant, savedVariant, state.variants)
        if (next !== state.activeVariant) {
          state.activeVariant = next
          setRunSpanAttributes(span, {
            "opencode.model.variant": state.activeVariant,
          })
        }

        if (footer.isClosed) {
          return
        }

        footer.event({ type: "models", providers: info.providers })
        footer.event({ type: "variants", variants: state.variants, current: state.activeVariant })
        if (!state.model) {
          return
        }

        footer.event({
          type: "model",
          model: formatModelLabel(state.model, state.activeVariant, state.providers),
        })
      })

      const streamTask = import("./stream.transport")
      const ensureStream = () => {
        if (state.stream) {
          return state.stream
        }

        // Share eager prewarm and first-turn boot through one in-flight promise,
        // but clear it if transport creation fails so a later prompt can retry.
        const next = (async () => {
          await ensureSession()
          if (footer.isClosed) {
            throw new Error("runtime closed")
          }

          const mod = await streamTask
          if (footer.isClosed) {
            throw new Error("runtime closed")
          }

          const handle = await mod.createSessionTransport({
            sdk: ctx.sdk,
            sessionID: state.sessionID,
            thinking: input.thinking,
            limits: () => state.limits,
            footer,
            trace: log,
          })
          if (footer.isClosed) {
            await handle.close()
            throw new Error("runtime closed")
          }

          state.selectSubagent = (sessionID) => handle.selectSubagent(sessionID)
          return { mod, handle }
        })()
        state.stream = next
        void next.catch(() => {
          if (state.stream === next) {
            state.stream = undefined
          }
        })
        return next
      }

      const runQueue = async () => {
        let includeFiles = true
        if (state.demo) {
          await state.demo.start()
        }

        const mod = await import("./runtime.queue")
        const createSession = input.createSession
        await mod.runPromptQueue({
          footer,
          initialInput: input.initialInput,
          trace: log,
          onSend: (prompt) => {
            state.shown = true
            state.history.push(prompt)
          },
          onNewSession: createSession
            ? async () => {
                try {
                  await state.switching?.catch(() => {})
                  const created = await createSession(ctx, {
                    agent: state.agent,
                    model: state.model,
                    variant: state.activeVariant,
                  })
                  await footer.idle().catch(() => {})
                  await state.stream?.then((item) => item.handle.close()).catch(() => {})
                  state.stream = undefined
                  state.session = undefined
                  state.selectSubagent = undefined
                  state.shown = false
                  state.sessionID = created.sessionID
                  state.sessionTitle = created.sessionTitle
                  state.agent = created.agent ?? state.agent
                  state.history = []
                   includeFiles = true
                   state.demo = input.demo
                     ? createRunDemo({
                        footer,
                        sessionID: state.sessionID,
                        thinking: input.thinking,
                        limits: () => state.limits,
                      })
                    : undefined
                  setRunSpanAttributes(span, {
                    "opencode.agent.name": state.agent,
                    "opencode.model.provider": state.model?.providerID,
                    "opencode.model.id": state.model?.modelID,
                    "opencode.model.variant": state.activeVariant,
                    "session.id": state.sessionID,
                  })
                  log?.write("session.new", {
                    sessionID: state.sessionID,
                  })
                  footer.event({
                    type: "stream.subagent",
                    state: {
                      tabs: [],
                      details: {},
                      permissions: [],
                      questions: [],
                    },
                  })
                  footer.event({ type: "stream.view", view: { type: "prompt" } })
                  footer.event({
                    type: "stream.patch",
                    patch: {
                      phase: "idle",
                      duration: "",
                      usage: "",
                      first: true,
                    },
                  })
                  footer.append({
                    kind: "system",
                    text: `new session ${state.sessionID}`,
                    phase: "final",
                    source: "system",
                  })
                  await state.demo?.start()
                } catch (error) {
                  footer.event({
                    type: "stream.patch",
                    patch: {
                      phase: "idle",
                      status: "failed to start new session",
                    },
                  })
                  footer.append({
                    kind: "error",
                    text: error instanceof Error ? error.message : String(error),
                    phase: "start",
                    source: "system",
                  })
                }
              }
            : undefined,
          run: async (prompt, signal) => {
            if (state.demo && (await state.demo.prompt(prompt, signal))) {
              return
            }

            await state.switching?.catch(() => {})

            return withRunSpan(
              "RunInteractive.turn",
              {
                "opencode.agent.name": state.agent,
                "opencode.model.provider": state.model?.providerID,
                "opencode.model.id": state.model?.modelID,
                "opencode.model.variant": state.activeVariant,
                "opencode.prompt.chars": prompt.text.length,
                "opencode.prompt.parts": prompt.parts.length,
                "opencode.prompt.include_files": includeFiles,
                "opencode.prompt.file_parts": includeFiles ? input.files.length : 0,
                "session.id": state.sessionID || undefined,
              },
              async (span) => {
                try {
                  const next = await ensureStream()
                  setRunSpanAttributes(span, {
                    "opencode.agent.name": state.agent,
                    "opencode.model.provider": state.model?.providerID,
                    "opencode.model.id": state.model?.modelID,
                    "opencode.model.variant": state.activeVariant,
                    "session.id": state.sessionID || undefined,
                  })
                  await next.handle.runPromptTurn({
                    agent: state.agent,
                    model: state.model,
                    variant: state.activeVariant,
                    prompt,
                    files: input.files,
                    includeFiles,
                    signal,
                  })
                  includeFiles = false
                } catch (error) {
                  if (signal.aborted || footer.isClosed) {
                    return
                  }

                  recordRunSpanError(span, error)
                  const text =
                    (await state.stream?.then((item) => item.mod).catch(() => undefined))?.formatUnknownError(error) ??
                    (error instanceof Error ? error.message : String(error))
                  footer.append({ kind: "error", text, phase: "start", source: "system" })
                }
              },
            )
          },
        })
      }

      try {
        const eager = eagerStream(input, ctx)
        if (eager) {
          await ensureStream()
        }

        if (!eager && input.resolveSession) {
          queueMicrotask(() => {
            if (footer.isClosed) {
              return
            }

            void ensureStream().catch(() => {})
          })
        }

        try {
          await runQueue()
        } finally {
          await state.stream?.then((item) => item.handle.close()).catch(() => {})
        }
      } finally {
        const title = await resolveExitTitle(ctx, input, state)

        await shell.close({
          showExit: state.shown && hasSession(input, state),
          sessionTitle: title,
          sessionID: state.sessionID,
          history: state.history,
        })
      }
    },
  )
}

// Local in-process mode. Creates an SDK client backed by a direct fetch to
// the in-process server, so no external HTTP server is needed.
export async function runInteractiveLocalMode(input: RunLocalInput): Promise<void> {
  return withRunSpan(
    "RunInteractive.localMode",
    {
      "opencode.directory": input.directory,
      "opencode.initial_input": !!input.initialInput,
      "opencode.demo": input.demo,
    },
    async () => {
      const sdk = createOpencodeClient({
        baseUrl: "http://opencode.internal",
        fetch: input.fetch,
        directory: input.directory,
      })
      let session: Promise<ResolvedSession> | undefined

      return runInteractiveRuntime({
        files: input.files,
        initialInput: input.initialInput,
        thinking: input.thinking,
        demo: input.demo,
        resolveSession: () => {
          if (session) {
            return session
          }

          session = Promise.all([input.resolveAgent(), input.session(sdk)]).then(([agent, next]) => {
            if (!next?.id) {
              throw new Error("Session not found")
            }

            void input.share(sdk, next.id).catch(() => {})
            return {
              sessionID: next.id,
              sessionTitle: next.title,
              agent,
            }
          })
          return session
        },
        createSession: createSessionResolver(input.createSession),
        boot: async () => {
          return {
            sdk,
            directory: input.directory,
            sessionID: "",
            sessionTitle: undefined,
            resume: false,
            agent: input.agent,
            model: input.model,
            variant: input.variant,
          }
        },
      })
    },
  )
}

// Attach mode. Uses the caller-provided SDK client directly.
export async function runInteractiveMode(input: RunInput & { createSession?: CreateSession }): Promise<void> {
  return withRunSpan(
    "RunInteractive.attachMode",
    {
      "opencode.directory": input.directory,
      "opencode.initial_input": !!input.initialInput,
      "session.id": input.sessionID,
    },
    async () =>
      runInteractiveRuntime({
        files: input.files,
        initialInput: input.initialInput,
        thinking: input.thinking,
        demo: input.demo,
        boot: async () => ({
          sdk: input.sdk,
          directory: input.directory,
          sessionID: input.sessionID,
          sessionTitle: input.sessionTitle,
          resume: input.resume,
          agent: input.agent,
          model: input.model,
          variant: input.variant,
        }),
        createSession: createSessionResolver(input.createSession),
      }),
  )
}
