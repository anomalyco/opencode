// RunFooter -- the mutable control surface for direct interactive mode.
//
// In the split-footer architecture, scrollback is immutable (append-only)
// and the footer is the only region that can repaint. RunFooter owns both
// sides of that boundary:
//
//   Scrollback: append() queues StreamCommit entries and flush() drains them
//   through retained scrollback surfaces. Commits coalesce in a microtask
//   queue so direct-mode transcript updates still preserve ordering without
//   rebuilding the session model.
//
//   Footer: event() updates the SolidJS signal-backed FooterState, which
//   drives the reactive footer view (prompt, status, permission, question).
//   present() swaps the active footer view and resizes the footer region.
//
// Lifecycle:
//   - close() flushes pending commits and notifies listeners (the prompt
//     queue uses this to know when to stop).
//   - destroy() does the same plus tears down event listeners and clears
//     internal state.
//   - The renderer's DESTROY event triggers destroy() so the footer
//     doesn't outlive the renderer.
//
// Ctrl-c clears a live prompt draft first; otherwise interrupt and exit use a
// two-press pattern where the first press shows a hint and the second press
// within 5 seconds actually fires the action.
import { CliRenderEvents, type CliRenderer, type TreeSitterClient } from "@opentui/core"
import { render } from "@opentui/solid"
import { createComponent, createSignal, type Accessor, type Setter } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { withRunSpan } from "./otel"
import { RUN_COMMAND_PANEL_ROWS } from "./footer.command"
import { SUBAGENT_INSPECTOR_ROWS, SUBAGENT_TAB_ROWS } from "./footer.subagent"
import { PROMPT_MAX_ROWS, TEXTAREA_MIN_ROWS } from "./footer.prompt"
import { printableBinding } from "./prompt.shared"
import { RunFooterView } from "./footer.view"
import { RunScrollbackStream } from "./scrollback.surface"
import type { RunTheme } from "./theme"
import type {
  FooterApi,
  FooterEvent,
  FooterKeybinds,
  FooterPatch,
  FooterPromptRoute,
  FooterState,
  FooterSubagentState,
  FooterView,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunCommand,
  RunDiffStyle,
  RunInput,
  RunPrompt,
  RunProvider,
  RunResource,
  StreamCommit,
} from "./types"

type CycleResult = {
  modelLabel?: string
  status?: string
  variant?: string | undefined
  variants?: string[]
}

type RunFooterOptions = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: RunAgent[]
  resources: RunResource[]
  commands?: RunCommand[]
  wrote?: boolean
  sessionID: () => string | undefined
  agentLabel: string
  modelLabel: string
  model: RunInput["model"]
  variant: string | undefined
  first: boolean
  history?: RunPrompt[]
  theme: RunTheme
  keybinds: FooterKeybinds
  diffStyle: RunDiffStyle
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycleVariant?: () => CycleResult | void
  onModelSelect?: (model: NonNullable<RunInput["model"]>) => CycleResult | void | Promise<CycleResult | void>
  onVariantSelect?: (variant: string | undefined) => CycleResult | void | Promise<CycleResult | void>
  onInterrupt?: () => void
  onExit?: () => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  treeSitterClient?: TreeSitterClient
}

const PERMISSION_ROWS = 12
const QUESTION_ROWS = 14
const COMMAND_ROWS = RUN_COMMAND_PANEL_ROWS
const MODEL_ROWS = RUN_COMMAND_PANEL_ROWS
const VARIANT_ROWS = RUN_COMMAND_PANEL_ROWS
const AUTOCOMPLETE_COMPACT_ROWS = 2

function createEmptySubagentState(): FooterSubagentState {
  return {
    tabs: [],
    details: {},
    permissions: [],
    questions: [],
  }
}

function eventPatch(next: FooterEvent): FooterPatch | undefined {
  if (next.type === "queue") {
    return { queue: next.queue }
  }

  if (next.type === "first") {
    return { first: next.first }
  }

  if (next.type === "model") {
    return { model: next.model }
  }

  if (next.type === "turn.send") {
    return {
      phase: "running",
      status: "sending prompt",
      queue: next.queue,
    }
  }

  if (next.type === "turn.wait") {
    return {
      phase: "running",
      status: "waiting for assistant",
    }
  }

  if (next.type === "turn.idle") {
    return {
      phase: "idle",
      status: "",
      queue: next.queue,
    }
  }

  if (next.type === "turn.duration") {
    return { duration: next.duration }
  }

  if (next.type === "stream.patch") {
    return next.patch
  }

  return undefined
}

export class RunFooter implements FooterApi {
  private closed = false
  private destroyed = false
  private prompts = new Set<(input: RunPrompt) => void>()
  private closes = new Set<() => void>()
  // Microtask-coalesced commit queue. Flushed on next microtask or on close/destroy.
  private queue: StreamCommit[] = []
  private pending = false
  private flushing: Promise<void> = Promise.resolve()
  // Fixed portion of footer height above the textarea.
  private base: number
  private rows = TEXTAREA_MIN_ROWS
  private agents: Accessor<RunAgent[]>
  private setAgents: Setter<RunAgent[]>
  private resources: Accessor<RunResource[]>
  private setResources: Setter<RunResource[]>
  private commands: Accessor<RunCommand[] | undefined>
  private setCommands: Setter<RunCommand[] | undefined>
  private providers: Accessor<RunProvider[] | undefined>
  private setProviders: Setter<RunProvider[] | undefined>
  private currentModel: Accessor<RunInput["model"]>
  private setCurrentModel: Setter<RunInput["model"]>
  private variants: Accessor<string[]>
  private setVariants: Setter<string[]>
  private currentVariant: Accessor<string | undefined>
  private setCurrentVariant: Setter<string | undefined>
  private state: Accessor<FooterState>
  private setState: Setter<FooterState>
  private view: Accessor<FooterView>
  private setView: Setter<FooterView>
  private subagent: Accessor<FooterSubagentState>
  private setSubagent: (next: FooterSubagentState) => void
  private promptRoute: FooterPromptRoute = { type: "composer" }
  private tabsVisible = false
  private autocomplete = false
  private interruptTimeout: NodeJS.Timeout | undefined
  private exitTimeout: NodeJS.Timeout | undefined
  private interruptHint: string
  private requestExitHandler: (() => boolean) | undefined
  private scrollback: RunScrollbackStream

  constructor(
    private renderer: CliRenderer,
    private options: RunFooterOptions,
  ) {
    const [state, setState] = createSignal<FooterState>({
      phase: "idle",
      status: "",
      queue: 0,
      model: options.modelLabel,
      duration: "",
      usage: "",
      first: options.first,
      interrupt: 0,
      exit: 0,
    })
    this.state = state
    this.setState = setState
    const [view, setView] = createSignal<FooterView>({ type: "prompt" })
    this.view = view
    this.setView = setView
    const [agents, setAgents] = createSignal(options.agents)
    this.agents = agents
    this.setAgents = setAgents
    const [resources, setResources] = createSignal(options.resources)
    this.resources = resources
    this.setResources = setResources
    const [commands, setCommands] = createSignal<RunCommand[] | undefined>(options.commands)
    this.commands = commands
    this.setCommands = setCommands
    const [providers, setProviders] = createSignal<RunProvider[] | undefined>()
    this.providers = providers
    this.setProviders = setProviders
    const [currentModel, setCurrentModel] = createSignal<RunInput["model"]>(options.model)
    this.currentModel = currentModel
    this.setCurrentModel = setCurrentModel
    const [variants, setVariants] = createSignal<string[]>([])
    this.variants = variants
    this.setVariants = setVariants
    const [currentVariant, setCurrentVariant] = createSignal(options.variant)
    this.currentVariant = currentVariant
    this.setCurrentVariant = setCurrentVariant
    const [subagent, setSubagent] = createStore<FooterSubagentState>(createEmptySubagentState())
    this.subagent = () => subagent
    this.setSubagent = (next) => {
      setSubagent("tabs", reconcile(next.tabs, { key: "sessionID" }))
      setSubagent("details", reconcile(next.details))
      setSubagent("permissions", reconcile(next.permissions, { key: "id" }))
      setSubagent("questions", reconcile(next.questions, { key: "id" }))
    }
    this.base = Math.max(1, renderer.footerHeight - TEXTAREA_MIN_ROWS)
    this.interruptHint = printableBinding(options.keybinds.interrupt, options.keybinds.leader) || "esc"
    this.scrollback = new RunScrollbackStream(renderer, options.theme, {
      diffStyle: options.diffStyle,
      wrote: options.wrote,
      sessionID: options.sessionID,
      treeSitterClient: options.treeSitterClient,
    })

    this.renderer.on(CliRenderEvents.DESTROY, this.handleDestroy)

    void render(
      () =>
        createComponent(RunFooterView, {
          directory: options.directory,
          state: this.state,
          view: this.view,
          subagent: this.subagent,
          findFiles: options.findFiles,
          agents: this.agents,
          resources: this.resources,
          commands: this.commands,
          providers: this.providers,
          currentModel: this.currentModel,
          variants: this.variants,
          currentVariant: this.currentVariant,
          theme: options.theme,
          diffStyle: options.diffStyle,
          keybinds: options.keybinds,
          history: options.history,
          agent: options.agentLabel,
          onSubmit: this.handlePrompt,
          onPermissionReply: this.handlePermissionReply,
          onQuestionReply: this.handleQuestionReply,
          onQuestionReject: this.handleQuestionReject,
          onCycle: this.handleCycle,
          onInterrupt: this.handleInterrupt,
          onInputClear: this.handleInputClear,
          onExitRequest: this.handleExit,
          onRequestExit: this.setRequestExitHandler,
          onExit: () => this.close(),
          onModelSelect: this.handleModelSelect,
          onVariantSelect: this.handleVariantSelect,
          onRows: this.syncRows,
          onLayout: this.syncLayout,
          onStatus: this.setStatus,
          onSubagentSelect: options.onSubagentSelect,
        }),
      this.renderer,
    ).catch(() => {
      if (!this.isGone) {
        this.close()
      }
    })
  }

  public get isClosed(): boolean {
    return this.closed || this.isGone
  }

  private get isGone(): boolean {
    return this.destroyed || this.renderer.isDestroyed
  }

  public onPrompt(fn: (input: RunPrompt) => void): () => void {
    this.prompts.add(fn)
    return () => {
      this.prompts.delete(fn)
    }
  }

  public onClose(fn: () => void): () => void {
    if (this.isClosed) {
      fn()
      return () => {}
    }

    this.closes.add(fn)
    return () => {
      this.closes.delete(fn)
    }
  }

  public event(next: FooterEvent): void {
    if (next.type === "catalog") {
      if (this.isGone) {
        return
      }

      this.setAgents(next.agents)
      this.setResources(next.resources)
      if (next.commands !== undefined) {
        this.setCommands(next.commands)
      }
      return
    }

    if (next.type === "models") {
      if (this.isGone) {
        return
      }

      this.setProviders(next.providers)
      return
    }

    if (next.type === "variants") {
      if (this.isGone) {
        return
      }

      this.setVariants(next.variants)
      this.setCurrentVariant(next.current)
      return
    }

    const patch = eventPatch(next)
    if (patch) {
      this.patch(patch)
      return
    }

    if (next.type === "stream.subagent") {
      if (this.isGone) {
        return
      }

      this.setSubagent(next.state)
      this.applyHeight()
      return
    }

    if (next.type === "stream.view") {
      this.present(next.view)
    }
  }

  private patch(next: FooterPatch): void {
    if (this.isGone) {
      return
    }

    const prev = this.state()
    const state = {
      phase: next.phase ?? prev.phase,
      status: typeof next.status === "string" ? next.status : prev.status,
      queue: typeof next.queue === "number" ? Math.max(0, next.queue) : prev.queue,
      model: typeof next.model === "string" ? next.model : prev.model,
      duration: typeof next.duration === "string" ? next.duration : prev.duration,
      usage: typeof next.usage === "string" ? next.usage : prev.usage,
      first: typeof next.first === "boolean" ? next.first : prev.first,
      interrupt:
        typeof next.interrupt === "number" && Number.isFinite(next.interrupt)
          ? Math.max(0, Math.floor(next.interrupt))
          : prev.interrupt,
      exit:
        typeof next.exit === "number" && Number.isFinite(next.exit) ? Math.max(0, Math.floor(next.exit)) : prev.exit,
    }

    if (state.phase === "idle") {
      state.interrupt = 0
    }

    this.setState(state)

    if (prev.phase === "running" && state.phase === "idle") {
      this.flush()
      this.completeScrollback()
    }
  }

  private completeScrollback(): void {
    const phase = this.state().phase
    this.flushing = this.flushing
      .then(() =>
        withRunSpan(
          "RunFooter.completeScrollback",
          {
            "opencode.footer.phase": phase,
            "session.id": this.options.sessionID() || undefined,
          },
          async () => {
            await this.scrollback.complete()
          },
        ),
      )
      .catch(() => {})
  }

  private present(view: FooterView): void {
    if (this.isGone) {
      return
    }

    this.setView(view)
    this.applyHeight()
  }

  // Queues a scrollback commit. Consecutive progress chunks for the same
  // part coalesce by appending text, reducing the number of retained-surface
  // updates. Actual flush happens on the next microtask, so a burst of events
  // from one reducer pass becomes a single ordered drain.
  public append(commit: StreamCommit): void {
    if (this.isGone) {
      return
    }

    const last = this.queue.at(-1)
    if (
      last &&
      last.phase === "progress" &&
      commit.phase === "progress" &&
      last.kind === commit.kind &&
      last.source === commit.source &&
      last.partID === commit.partID &&
      last.tool === commit.tool
    ) {
      last.text += commit.text
    } else {
      this.queue.push(commit)
    }

    if (this.pending) {
      return
    }

    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      this.flush()
    })
  }

  public idle(): Promise<void> {
    if (this.isGone) {
      return Promise.resolve()
    }

    this.flush()
    if (this.state().phase === "idle") {
      this.completeScrollback()
    }

    return this.flushing.then(async () => {
      if (this.isGone) {
        return
      }

      if (this.queue.length > 0) {
        return this.idle()
      }

      await this.renderer.idle().catch(() => {})
    })
  }

  public close(): void {
    if (this.closed) {
      return
    }

    this.flush()
    this.notifyClose()
  }

  public requestExit(): boolean {
    return this.requestExitHandler?.() ?? this.handleExit()
  }

  public destroy(): void {
    this.handleDestroy()
  }

  private notifyClose(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    for (const fn of [...this.closes]) {
      fn()
    }
  }

  private setStatus = (status: string): void => {
    this.patch({ status })
  }

  private setRequestExitHandler = (fn?: () => boolean): void => {
    this.requestExitHandler = fn
  }

  private handleInputClear = (): void => {
    this.clearInterruptTimer()
    this.clearExitTimer()
    if (this.state().interrupt === 0 && this.state().exit === 0) {
      return
    }

    this.patch({ interrupt: 0, exit: 0 })
  }

  // Resizes the footer to fit the current view. Permission and question views
  // get fixed extra rows; the prompt view scales with textarea line count.
  private applyHeight(): void {
    const type = this.view().type
    const tabs = this.tabsVisible ? SUBAGENT_TAB_ROWS : 0
    const compact = this.promptRoute.type === "composer" && this.autocomplete ? AUTOCOMPLETE_COMPACT_ROWS : 0
    const base = this.base + tabs - compact
    const height =
      type === "permission"
        ? this.base + PERMISSION_ROWS
        : type === "question"
          ? this.base + QUESTION_ROWS
          : this.promptRoute.type === "command"
            ? 1 + tabs + COMMAND_ROWS
            : this.promptRoute.type === "model"
              ? 1 + tabs + MODEL_ROWS
              : this.promptRoute.type === "variant"
                ? 1 + tabs + VARIANT_ROWS
                : this.promptRoute.type === "subagent"
                  ? this.base + tabs + SUBAGENT_INSPECTOR_ROWS
                  : Math.max(base + TEXTAREA_MIN_ROWS, Math.min(base + PROMPT_MAX_ROWS, base + this.rows))

    if (height !== this.renderer.footerHeight) {
      this.renderer.footerHeight = height
    }
  }

  private syncRows = (value: number): void => {
    if (this.isGone) {
      return
    }

    const rows = Math.max(TEXTAREA_MIN_ROWS, Math.min(PROMPT_MAX_ROWS, value))
    if (rows === this.rows) {
      return
    }

    this.rows = rows
    if (this.view().type === "prompt") {
      this.applyHeight()
    }
  }

  private syncLayout = (next: { route: FooterPromptRoute; tabs: boolean; autocomplete: boolean }): void => {
    this.promptRoute = next.route
    this.tabsVisible = next.tabs
    this.autocomplete = next.autocomplete
    if (this.view().type === "prompt") {
      this.applyHeight()
    }
  }

  private handlePrompt = (input: RunPrompt): boolean => {
    if (this.isClosed) {
      return false
    }

    if (this.state().first) {
      this.patch({ first: false })
    }

    if (this.prompts.size === 0) {
      this.patch({ status: "input queue unavailable" })
      return false
    }

    for (const fn of [...this.prompts]) {
      fn(input)
    }

    return true
  }

  private handlePermissionReply = async (input: PermissionReply): Promise<void> => {
    if (this.isClosed) {
      return
    }

    await this.options.onPermissionReply(input)
  }

  private handleQuestionReply = async (input: QuestionReply): Promise<void> => {
    if (this.isClosed) {
      return
    }

    await this.options.onQuestionReply(input)
  }

  private handleQuestionReject = async (input: QuestionReject): Promise<void> => {
    if (this.isClosed) {
      return
    }

    await this.options.onQuestionReject(input)
  }

  private handleCycle = (): void => {
    const result = this.options.onCycleVariant?.()
    if (!result) {
      this.patch({ status: "no variants available" })
      return
    }

    const patch: FooterPatch = {
      status: result.status ?? "variant updated",
    }

    if ("variants" in result) {
      this.setVariants(result.variants ?? [])
    }

    if ("variant" in result) {
      this.setCurrentVariant(result.variant)
    }

    if (result.modelLabel) {
      patch.model = result.modelLabel
    }

    this.patch(patch)
  }

  private handleModelSelect = (model: NonNullable<RunInput["model"]>): void => {
    if (this.isClosed) {
      return
    }

    this.setCurrentModel(model)
    void Promise.resolve()
      .then(() => this.options.onModelSelect?.(model))
      .then((result) => {
        const current = this.currentModel()
        if (
          !result ||
          this.isClosed ||
          !current ||
          current.providerID !== model.providerID ||
          current.modelID !== model.modelID
        ) {
          return
        }

        if ("variants" in result) {
          this.setVariants(result.variants ?? [])
        }

        if ("variant" in result) {
          this.setCurrentVariant(result.variant)
        }

        const patch: FooterPatch = {}
        if (result.modelLabel) {
          patch.model = result.modelLabel
        }

        if (result.status) {
          patch.status = result.status
        }

        if (patch.model || patch.status) {
          this.patch(patch)
        }
      })
      .catch(() => {})
  }

  private handleVariantSelect = (variant: string | undefined): void => {
    if (this.isClosed) {
      return
    }

    const model = this.currentModel()
    void Promise.resolve()
      .then(() => this.options.onVariantSelect?.(variant))
      .then((result) => {
        const current = this.currentModel()
        if (
          !result ||
          this.isClosed ||
          (model && (!current || current.providerID !== model.providerID || current.modelID !== model.modelID))
        ) {
          return
        }

        if ("variants" in result) {
          this.setVariants(result.variants ?? [])
        }

        if ("variant" in result) {
          this.setCurrentVariant(result.variant)
        }

        const patch: FooterPatch = {}
        if (result.modelLabel) {
          patch.model = result.modelLabel
        }

        if (result.status) {
          patch.status = result.status
        }

        if (patch.model || patch.status) {
          this.patch(patch)
        }
      })
      .catch(() => {})
  }

  private clearInterruptTimer(): void {
    if (!this.interruptTimeout) {
      return
    }

    clearTimeout(this.interruptTimeout)
    this.interruptTimeout = undefined
  }

  private armInterruptTimer(): void {
    this.clearInterruptTimer()
    this.interruptTimeout = setTimeout(() => {
      this.interruptTimeout = undefined
      if (this.isGone || this.state().phase !== "running") {
        return
      }

      this.patch({ interrupt: 0 })
    }, 5000)
  }

  private clearExitTimer(): void {
    if (!this.exitTimeout) {
      return
    }

    clearTimeout(this.exitTimeout)
    this.exitTimeout = undefined
  }

  private armExitTimer(): void {
    this.clearExitTimer()
    this.exitTimeout = setTimeout(() => {
      this.exitTimeout = undefined
      if (this.isGone || this.isClosed) {
        return
      }

      this.patch({ exit: 0 })
    }, 5000)
  }

  // Two-press interrupt: first press shows a hint ("esc again to interrupt"),
  // second press within 5 seconds fires onInterrupt. The timer resets the
  // counter if the user doesn't follow through.
  private handleInterrupt = (): boolean => {
    if (this.isClosed || this.state().phase !== "running") {
      return false
    }

    const next = this.state().interrupt + 1
    this.patch({ interrupt: next })

    if (next < 2) {
      this.armInterruptTimer()
      this.patch({ status: `${this.interruptHint} again to interrupt` })
      return true
    }

    this.clearInterruptTimer()
    this.patch({ interrupt: 0, status: "interrupting" })
    this.options.onInterrupt?.()
    return true
  }

  private handleExit = (): boolean => {
    if (this.isClosed) {
      return true
    }

    this.clearInterruptTimer()
    const next = this.state().exit + 1
    this.patch({ exit: next, interrupt: 0 })

    if (next < 2) {
      this.armExitTimer()
      this.patch({ status: "Press Ctrl-c again to exit" })
      return true
    }

    this.clearExitTimer()
    this.patch({ exit: 0, status: "exiting" })
    this.close()
    this.options.onExit?.()
    return true
  }

  private handleDestroy = (): void => {
    if (this.destroyed) {
      return
    }

    this.flush()
    this.destroyed = true
    this.notifyClose()
    this.clearInterruptTimer()
    this.clearExitTimer()
    this.renderer.off(CliRenderEvents.DESTROY, this.handleDestroy)
    this.prompts.clear()
    this.closes.clear()
    this.scrollback.destroy()
  }

  // Drains the commit queue to scrollback. The surface manager owns grouping,
  // spacing, and progressive markdown/code settling so direct mode can append
  // immutable transcript rows without rewriting history.
  private flush(): void {
    if (this.isGone || this.queue.length === 0) {
      this.queue.length = 0
      return
    }

    const batch = this.queue.splice(0)
    const phase = this.state().phase
    this.flushing = this.flushing
      .then(() =>
        withRunSpan(
          "RunFooter.flush",
          {
            "opencode.batch.commits": batch.length,
            "opencode.footer.phase": phase,
            "session.id": this.options.sessionID() || undefined,
          },
          async () => {
            for (const item of batch) {
              await this.scrollback.append(item)
            }
          },
        ),
      )
      .catch(() => {})
  }
}
