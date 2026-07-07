// Top-level orchestrator for `opencode mini`.
//
// Wires the boot sequence, lifecycle (renderer + footer), stream transport,
// and prompt queue together into a single session loop. Two entry points:
//
//   runInteractiveMode     -- used when an SDK client already exists (attach mode)
//   runInteractiveDeferredMode -- paints before resolving its session
//
// Both delegate to runInteractiveRuntime, which:
//   1. resolves TUI config, model info, and session history,
//   2. creates the split-footer lifecycle (renderer + RunFooter),
//   3. starts the stream transport (SDK event subscription), lazily for fresh
//      local sessions,
//   4. runs the prompt queue until the footer closes.
import { Flag } from "@opencode-ai/core/flag/flag"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { loadRunAgents, loadRunCommands, loadRunReferences, waitForDefaultModel } from "./catalog.shared"
import { resolveModelInfo, resolveModelInfoStrict, resolveRunTuiConfig, resolveSessionInfo } from "./runtime.boot"
import { createRuntimeLifecycle } from "./runtime.lifecycle"
import { trace } from "./trace"
import { cycleVariant, formatModelLabel, resolveSavedVariant, resolveVariant, saveVariant } from "./variant.shared"
import type {
  LocalReplayAnchor,
  LocalReplayRow,
  RunInput,
  RunPrompt,
  RunProvider,
  RunTuiConfig,
  StreamCommit,
} from "./types"

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

type CreateSession = (sdk: RunInput["sdk"], input: CreateSessionInput) => Promise<{ id: string; title?: string }>

type RunRuntimeInput = {
  boot: () => Promise<BootContext>
  afterPaint?: (ctx: BootContext) => Promise<void> | void
  resolveSession?: (ctx: BootContext) => Promise<ResolvedSession>
  createSession?: (ctx: BootContext, input: CreateSessionInput) => Promise<ResolvedSession>
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
  tuiConfig?: RunTuiConfig | Promise<RunTuiConfig>
}

type RunDeferredInput = {
  sdk: RunInput["sdk"]
  directory: string
  resolveAgent: () => Promise<string | undefined>
  session: (sdk: RunInput["sdk"]) => Promise<{ id: string; title?: string; resume?: boolean } | undefined>
  createSession?: CreateSession
  agent: RunInput["agent"]
  model: RunInput["model"]
  variant: RunInput["variant"]
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
  tuiConfig?: RunTuiConfig | Promise<RunTuiConfig>
}

type StreamTransportModule = Pick<
  Awaited<typeof import("./stream-v2.transport")>,
  "createSessionTransport" | "formatUnknownError"
>

export type RunRuntimeDeps = {
  createRuntimeLifecycle?: typeof createRuntimeLifecycle
  streamTransport?: Promise<StreamTransportModule>
}

type StreamState = {
  mod: StreamTransportModule
  handle: Awaited<ReturnType<StreamTransportModule["createSessionTransport"]>>
}

type RunDemo = ReturnType<(typeof import("./demo"))["createRunDemo"]>

type ResolvedSession = {
  sessionID: string
  sessionTitle?: string
  agent?: string | undefined
  resume?: boolean
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
  localRows: LocalReplayRow[]
  sessionTitle?: string
  agent: string | undefined
  switching?: Promise<void>
  demo?: RunDemo
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

const RESIZE_DELAY = 250
const LOCAL_REPLAY_ROW_LIMIT = 100

async function resolveExitTitle(
  ctx: BootContext,
  input: RunRuntimeInput,
  state: RuntimeState,
): Promise<string | undefined> {
  if (!state.shown || !hasSession(input, state)) {
    return undefined
  }

  return ctx.sdk.session
    .get({ sessionID: state.sessionID })
    .then((session) => session.title)
    .catch(() => undefined)
}

// Core runtime loop. Boot resolves the SDK context, then we set up the
// lifecycle (renderer + footer), wire the stream transport for SDK events,
// and feed prompts through the queue until the user exits.
//
// Files only attach on the first prompt turn -- after that, includeFiles
// flips to false so subsequent turns don't re-send attachments.
async function runInteractiveRuntime(input: RunRuntimeInput, deps: RunRuntimeDeps = {}): Promise<void> {
  const start = performance.now()
  const log = trace()
  const tuiConfigTask = resolveRunTuiConfig(input.tuiConfig)
  const ctx = await input.boot()
  const sessionTask =
    ctx.resume === true
      ? resolveSessionInfo(ctx.sdk, ctx.sessionID, ctx.model)
      : Promise.resolve({
          first: true,
          history: [],
          model: undefined,
          variant: undefined,
        })
  const savedTask = resolveSavedVariant(ctx.model)
  const [session, savedVariant] = await Promise.all([sessionTask, savedTask])
  const state: RuntimeState = {
    shown: !session.first,
    aborting: false,
    model: ctx.model ?? session.model,
    providers: [],
    variants: [],
    limits: {},
    activeVariant: resolveVariant(ctx.variant, session.variant, savedVariant, []),
    sessionID: ctx.sessionID,
    history: [...session.history],
    localRows: [],
    sessionTitle: ctx.sessionTitle,
    agent: ctx.agent,
  }
  const loadModel = async () => {
    if (state.model) {
      return {
        model: state.model,
        savedVariant,
        boot: true,
        info: await resolveModelInfo(ctx.sdk, ctx.directory, state.model),
      }
    }

    const model = await waitForDefaultModel({
      sdk: ctx.sdk,
      directory: ctx.directory,
      active: () => !footer.isClosed,
    })
    if (footer.isClosed) return
    const [fallbackSavedVariant, info] = await Promise.all([
      resolveSavedVariant(model),
      resolveModelInfo(ctx.sdk, ctx.directory, model),
    ])
    if (!model || state.model) {
      return {
        model: state.model,
        savedVariant: undefined,
        boot: false,
        info,
      }
    }

    state.model = model
    return {
      model,
      savedVariant: fallbackSavedVariant,
      boot: true,
      info,
    }
  }
  const shell = await (deps.createRuntimeLifecycle ?? createRuntimeLifecycle)({
    directory: ctx.directory,
    findFiles: (query) =>
      ctx.sdk.file
        .find({ query, type: "file", location: { directory: ctx.directory } })
        .then((result) => result.data.map((file) => file.path))
        .catch(() => []),
    agents: [],
    references: [],
    sessionID: state.sessionID,
    sessionTitle: state.sessionTitle,
    getSessionID: () => state.sessionID,
    first: session.first,
    history: state.history,
    agent: state.agent,
    model: state.model,
    variant: state.activeVariant,
    tuiConfig: tuiConfigTask,
    onPermissionReply: async (next) => {
      if (state.demo?.permission(next)) {
        return
      }

      log?.write("send.permission.reply", next)
      await ctx.sdk.permission.reply({ sessionID: state.sessionID, ...next })
    },
    onQuestionReply: async (next) => {
      if (state.demo?.questionReply(next)) {
        return
      }

      await ctx.sdk.question.reply({
        sessionID: state.sessionID,
        requestID: next.requestID,
        answers: next.answers ?? [],
      })
    },
    onQuestionReject: async (next) => {
      if (state.demo?.questionReject(next)) {
        return
      }

      await ctx.sdk.question.reject({ sessionID: state.sessionID, ...next })
    },
    onCycleVariant: () => {
      if (!state.model || state.variants.length === 0) {
        return {
          status: "no variants available",
        }
      }

      state.activeVariant = cycleVariant(state.activeVariant, state.variants)
      saveVariant(state.model, state.activeVariant)
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
      return {
        status: state.activeVariant ? `variant ${state.activeVariant}` : "variant default",
        modelLabel: formatModelLabel(state.model, state.activeVariant, state.providers),
        variant: state.activeVariant,
        variants: state.variants,
      }
    },
    onInterrupt: () => {
      if (!hasSession(input, state) || state.aborting) {
        return false
      }

      state.aborting = true
      void (
        state.stream
          ? state.stream.then((item) => item.handle.interruptActiveTurn())
          : ctx.sdk.session.interrupt({ sessionID: state.sessionID })
      )
        .catch(() => {})
        .finally(() => {
          state.aborting = false
        })
      return true
    },
    onBackground: () => {
      if (!hasSession(input, state)) {
        return
      }

      log?.write("send.background", { sessionID: state.sessionID })
      void ctx.sdk.session.background({ sessionID: state.sessionID }).catch(() => {})
    },
    onSubagentInterrupt: (sessionID) => {
      log?.write("send.subagent.interrupt", { sessionID })
      void ctx.sdk.session.interrupt({ sessionID }).catch(() => {})
    },
    onSubagentSelect: (sessionID) => {
      state.selectSubagent?.(sessionID)
      log?.write("subagent.select", {
        sessionID,
      })
    },
  })
  const footer = shell.footer
  const firstPaint = footer.idle().catch(() => {})
  const ensureSession = () => {
    if (!input.resolveSession || state.sessionID) {
      return Promise.resolve()
    }

    if (state.session) {
      return state.session
    }

    state.session = input.resolveSession(ctx).then(async (next) => {
      state.sessionID = next.sessionID
      state.sessionTitle = next.sessionTitle ?? state.sessionTitle
      state.agent = next.agent
      if (!next.resume) return
      const resumed = await resolveSessionInfo(ctx.sdk, next.sessionID, ctx.model)
      session.first = resumed.first
      session.history = resumed.history
      session.model = resumed.model
      session.variant = resumed.variant
      state.shown = !resumed.first
      state.history = [...resumed.history]
      state.model = ctx.model ?? resumed.model
      const resumedSavedVariant = state.model ? await resolveSavedVariant(state.model) : undefined
      state.activeVariant = resolveVariant(ctx.variant, resumed.variant, resumedSavedVariant, [])
      session.variant = state.activeVariant
      footer.event({ type: "history", history: resumed.history })
      footer.event({ type: "first", first: resumed.first })
    })
    return state.session
  }
  const modelTask = firstPaint.then(async () => {
    if (footer.isClosed) return
    await ensureSession()
    if (footer.isClosed) return
    return loadModel()
  })
  const rememberLocal = (commit: StreamCommit, after?: LocalReplayAnchor) => {
    state.localRows = [...state.localRows, { commit, after }].slice(-LOCAL_REPLAY_ROW_LIMIT)
  }

  const applyCatalog = (catalog: {
    agents: Awaited<ReturnType<typeof loadRunAgents>>
    references: Awaited<ReturnType<typeof loadRunReferences>>
    commands: Awaited<ReturnType<typeof loadRunCommands>>
  }) => {
    if (footer.isClosed) {
      return
    }
    footer.event({
      type: "catalog",
      agents: catalog.agents,
      references: catalog.references,
      commands: catalog.commands,
    })
  }

  const fetchCatalog = async () => {
    const [agents, references, commands] = await Promise.all([
      loadRunAgents(ctx.sdk, ctx.directory),
      loadRunReferences(ctx.sdk, ctx.directory),
      loadRunCommands(ctx.sdk, ctx.directory),
    ])
    return { agents, references, commands }
  }

  const loadCatalog = async () => {
    applyCatalog(
      await Promise.all([
        loadRunAgents(ctx.sdk, ctx.directory).catch(() => []),
        loadRunReferences(ctx.sdk, ctx.directory).catch(() => []),
        loadRunCommands(ctx.sdk, ctx.directory).catch(() => []),
      ]).then(([agents, references, commands]) => ({ agents, references, commands })),
    )
  }

  const applyModelInfo = (
    info: Awaited<ReturnType<typeof resolveModelInfo>>,
    current: string | undefined,
    boot = false,
    saved = savedVariant,
  ) => {
    state.providers = info.providers
    state.variants = variantsFor(state.providers, state.model)
    state.limits = info.limits
    state.activeVariant = boot
      ? resolveVariant(ctx.variant, current, saved, state.variants)
      : current && !state.variants.includes(current)
        ? undefined
        : current
    if (footer.isClosed) return
    footer.event({ type: "models", providers: info.providers })
    footer.event({ type: "variants", variants: state.variants, current: state.activeVariant })
    if (state.model)
      footer.event({
        type: "model",
        model: formatModelLabel(state.model, state.activeVariant, state.providers),
        selection: state.model,
      })
  }

  let catalogRefresh: Promise<void> | undefined
  let catalogRefreshQueued = false
  const requestCatalogRefresh = () => {
    catalogRefreshQueued = true
    if (catalogRefresh || footer.isClosed) return
    catalogRefresh = (async () => {
      await Promise.all([modelTask, initialCatalog])
      while (catalogRefreshQueued && !footer.isClosed) {
        catalogRefreshQueued = false
        const [catalog, info] = await Promise.allSettled([
          fetchCatalog(),
          resolveModelInfoStrict(ctx.sdk, ctx.directory, state.model),
        ])
        if (catalog.status === "fulfilled") applyCatalog(catalog.value)
        if (info.status === "fulfilled") applyModelInfo(info.value, state.activeVariant)
      }
    })().finally(() => {
      catalogRefresh = undefined
      if (catalogRefreshQueued) requestCatalogRefresh()
    })
    void catalogRefresh.catch(() => {})
  }

  const initialCatalog = firstPaint.then(() => (footer.isClosed ? undefined : loadCatalog())).catch(() => {})
  void initialCatalog

  if (Flag.OPENCODE_SHOW_TTFD) {
    void firstPaint.then(() => {
      if (footer.isClosed) return
      footer.append({
        kind: "system",
        text: `startup ${Math.max(0, Math.round(performance.now() - start))}ms`,
        phase: "final",
        source: "system",
      })
    })
  }

  const createDemo = async () => {
    const { createRunDemo } = await import("./demo")
    return createRunDemo({
      footer,
      sessionID: state.sessionID,
      thinking: input.thinking,
      limits: () => state.limits,
    })
  }

  if (input.demo) {
    await firstPaint
    if (!footer.isClosed) {
      await ensureSession()
      state.demo = await createDemo()
    }
  }

  if (input.afterPaint) {
    void firstPaint.then(() => (footer.isClosed ? undefined : input.afterPaint?.(ctx))).catch(() => {})
  }

  void modelTask.then((result) => {
    if (!result) return
    const current = state.model
    const boot =
      result.boot &&
      !!current &&
      current.providerID === result.model?.providerID &&
      current.modelID === result.model.modelID
    applyModelInfo(result.info, boot ? session.variant : state.activeVariant, boot, result.savedVariant)
  })

  let streamTask = deps.streamTransport
  const loadStreamTransport = () => {
    if (streamTask) return streamTask
    streamTask = import("./stream-v2.transport")
    return streamTask
  }
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

      const mod = await loadStreamTransport()
      if (footer.isClosed) {
        throw new Error("runtime closed")
      }

      const handle = await mod.createSessionTransport({
        sdk: ctx.sdk,
        directory: ctx.directory,
        sessionID: state.sessionID,
        thinking: input.thinking,
        replay: input.replay,
        replayLimit: input.replayLimit,
        limits: () => state.limits,
        providers: () => state.providers,
        footer,
        trace: log,
        onCatalogRefresh: requestCatalogRefresh,
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

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const offResize = shell.onResize(() => {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }

    resizeTimer = setTimeout(() => {
      resizeTimer = undefined
      if (footer.isClosed) {
        return
      }

      shell.refreshTheme()
      if (!input.replay || !state.stream) {
        return
      }

      void state.stream
        .then((item) =>
          item.handle.replayOnResize({
            localRows: () => state.localRows,
            reset: () =>
              shell.resetForReplay({
                sessionTitle: state.sessionTitle,
                sessionID: state.sessionID,
                history: state.history,
              }),
          }),
        )
        .catch(() => {})
    }, RESIZE_DELAY)
  })

  const runQueue = async () => {
    await firstPaint
    if (footer.isClosed) return
    await ensureSession()
    if (footer.isClosed) return
    await modelTask
    if (footer.isClosed) return
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
        if (prompt.mode !== "shell") {
          rememberLocal({
            kind: "user",
            text: prompt.text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          })
        }
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
              state.localRows = []
              includeFiles = true
              state.demo = input.demo ? await createDemo() : undefined
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
              const commit = {
                kind: "error",
                text: error instanceof Error ? error.message : String(error),
                phase: "start",
                source: "system",
                messageID: SessionMessage.ID.create(),
              } as const
              rememberLocal(commit)
              footer.append(commit)
            }
          }
        : undefined,
      run: async (prompt, signal) => {
        if (state.demo && (await state.demo.prompt(prompt, signal))) {
          return
        }

        await state.switching?.catch(() => {})

        let outputAnchor: LocalReplayAnchor | undefined
        try {
          const next = await ensureStream()
          await next.handle.runPromptTurn({
            agent: state.agent,
            model: state.model,
            variant: state.activeVariant,
            prompt,
            files: input.files,
            includeFiles,
            onVisibleOutput: (anchor) => {
              outputAnchor = anchor
            },
            signal,
          })
          if (prompt.messageID) {
            state.localRows = state.localRows.filter(
              (row) => row.commit.kind !== "user" || row.commit.messageID !== prompt.messageID,
            )
          }
          // Shell and skill turns never send CLI file attachments; keep them
          // pending for the next prompt-shaped turn.
          if (prompt.mode !== "shell" && prompt.command?.source !== "skill") includeFiles = false
        } catch (error) {
          if (signal.aborted || footer.isClosed) {
            return
          }

          const text =
            (await state.stream?.then((item) => item.mod).catch(() => undefined))?.formatUnknownError(error) ??
            (error instanceof Error ? error.message : String(error))
          const commit = {
            kind: "error",
            text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          } as const
          rememberLocal(commit, outputAnchor)
          footer.append(commit)
        }
      },
    })
  }

  try {
    const eager = eagerStream(input, ctx)
    if (eager) {
      await firstPaint
      if (footer.isClosed) return
      if (input.replay && state.shown) {
        // Replay commits immutable scrollback rows, so wait for provider names
        // before bootstrapping existing session history.
        await modelTask
      }

      await ensureStream()
    }

    if (!eager && input.resolveSession) {
      void firstPaint
        .then(() => {
          if (footer.isClosed) {
            return
          }

          return ensureStream()
        })
        .catch(() => {})
    }

    try {
      await runQueue()
    } finally {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      offResize()
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
}

// Deferred mode paints before session resolution. The caller may back the
// generated client with a transport that is still acquiring a daemon.
export async function runInteractiveDeferredMode(input: RunDeferredInput, deps?: RunRuntimeDeps): Promise<void> {
  const sdk = input.sdk
  let session: Promise<ResolvedSession> | undefined

  return runInteractiveRuntime(
    {
      files: input.files,
      initialInput: input.initialInput,
      thinking: input.thinking,
      replay: input.replay,
      replayLimit: input.replayLimit,
      demo: input.demo,
      tuiConfig: input.tuiConfig,
      resolveSession: () => {
        if (session) {
          return session
        }

        session = Promise.all([input.resolveAgent(), input.session(sdk)]).then(([agent, next]) => {
          if (!next?.id) {
            throw new Error("Session not found")
          }

          return {
            sessionID: next.id,
            sessionTitle: next.title,
            agent,
            resume: next.resume,
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
    },
    deps,
  )
}

// Attach mode. Uses the caller-provided SDK client directly.
export async function runInteractiveMode(
  input: RunInput & { createSession?: CreateSession; tuiConfig?: RunTuiConfig | Promise<RunTuiConfig> },
  deps?: RunRuntimeDeps,
): Promise<void> {
  return runInteractiveRuntime(
    {
      files: input.files,
      initialInput: input.initialInput,
      thinking: input.thinking,
      replay: input.replay,
      replayLimit: input.replayLimit,
      demo: input.demo,
      tuiConfig: input.tuiConfig,
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
    },
    deps,
  )
}
