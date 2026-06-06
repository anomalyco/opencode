// Top-level footer layout for direct interactive mode.
//
// Renders the footer region as a vertical stack:
//   1. Spacer row (visual separation from scrollback)
//   2. Composer frame with left-border accent -- swaps between prompt,
//      permission, and question bodies via Switch/Match
//   3. Meta row showing agent name and model label in the normal composer view
//   4. Bottom border + status row (spinner, interrupt hint, duration, usage)
//
// All state comes from the parent RunFooter through SolidJS signals.
// The view itself is stateless except for derived memos.
/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import "opentui-spinner/solid"
import { createColors, createFrames } from "../tui/ui/spinner"
import {
  RUN_SUBAGENT_PANEL_ROWS,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody } from "./footer.subagent"
import { RunPromptBody, createPromptState, hintFlags } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunQuestionBody } from "./footer.question"
import {
  OPENCODE_BASE_MODE,
  formatKeyBindings,
  useBindings,
  useKeymapSelector,
  type OpenTuiKeymap,
} from "@/cli/cmd/tui/keymap"
import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
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
  RunTuiConfig,
} from "./types"
import type { RunTheme } from "./theme"
import { modelInfo } from "./variant.shared"

const EMPTY_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

type RunFooterViewProps = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: () => RunAgent[]
  resources: () => RunResource[]
  commands: () => RunCommand[] | undefined
  providers: () => RunProvider[] | undefined
  currentModel: () => RunInput["model"]
  variants: () => string[]
  currentVariant: () => string | undefined
  state: () => FooterState
  view?: () => FooterView
  subagent?: () => FooterSubagentState
  queuedPrompts?: () => FooterQueuedPrompt[]
  theme: () => RunTheme
  diffStyle?: RunDiffStyle
  tuiConfig: RunTuiConfig
  backgroundSubagents: boolean
  history?: RunPrompt[]
  agent: string
  onSubmit: (input: RunPrompt) => boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onBackground?: () => void
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; autocomplete: boolean; subagentRows: number }) => void
  onStatus: (text: string) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  onQueuedRemove: (messageID: string) => Promise<boolean>
}

export { TEXTAREA_MIN_ROWS, TEXTAREA_MAX_ROWS } from "./footer.prompt"

export function RunFooterView(props: RunFooterViewProps) {
  const term = useTerminalDimensions()
  const active = createMemo<FooterView>(() => props.view?.() ?? { type: "prompt" })
  const subagent = createMemo<FooterSubagentState>(() => {
    return (
      props.subagent?.() ?? {
        tabs: [],
        details: {},
        permissions: [],
        questions: [],
      }
    )
  })
  const [route, setRoute] = createSignal<FooterPromptRoute>({ type: "composer" })
  const [subagentMenuRows, setSubagentMenuRows] = createSignal(RUN_SUBAGENT_PANEL_ROWS)
  const queuedPrompts = createMemo(() => props.queuedPrompts?.() ?? [])
  const prompt = createMemo(() => active().type === "prompt" && route().type === "composer")
  const selectingSubagent = createMemo(() => active().type === "prompt" && route().type === "subagent-menu")
  const selectingQueued = createMemo(() => active().type === "prompt" && route().type === "queued-menu")
  const inspecting = createMemo(() => active().type === "prompt" && route().type === "subagent")
  const commanding = createMemo(() => active().type === "prompt" && route().type === "command")
  const modeling = createMemo(() => active().type === "prompt" && route().type === "model")
  const varianting = createMemo(() => active().type === "prompt" && route().type === "variant")
  const panel = createMemo(() => selectingQueued() || selectingSubagent() || commanding() || modeling() || varianting())
  const selected = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? current.sessionID : undefined
  })
  const tabs = createMemo(() => subagent().tabs)
  const selectedTab = createMemo(() => tabs().find((item) => item.sessionID === selected()))
  const selectedIndex = createMemo(() => {
    const sessionID = selected()
    if (!sessionID) {
      return 0
    }

    return tabs().findIndex((item) => item.sessionID === sessionID) + 1
  })
  const subagentIndicator = createMemo(() => {
    const count = tabs().length
    if (count === 0) {
      return
    }

    return {
      count,
      label: count === 1 ? "agent" : "agents",
    }
  })
  const foregroundSubagents = createMemo(
    () => props.backgroundSubagents && tabs().some((item) => item.status === "running" && !item.background),
  )
  const queuedIndicator = createMemo(() => {
    const count = queuedPrompts().length
    if (count === 0) return
    return { count }
  })
  const model = createMemo(() => {
    const current = props.currentModel()
    return current ? modelInfo(props.providers(), current) : { model: props.state().model, provider: undefined }
  })
  const detail = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? subagent().details[current.sessionID] : undefined
  })
  const command = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["command.palette.show"] })
          .get("command.palette.show"),
        props.tuiConfig,
      ) ?? "",
  )
  const interrupt = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.interrupt"] })
          .get("session.interrupt"),
        props.tuiConfig,
      ) ?? "",
  )
  const variantCycle = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap.getCommandBindings({ visibility: "registered", commands: ["variant.cycle"] }).get("variant.cycle"),
        props.tuiConfig,
      ) ?? "",
  )
  const queuedShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.queued_prompts"] })
          .get("session.queued_prompts"),
        props.tuiConfig,
      ) ?? "",
  )
  const subagentShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.child.first"] })
          .get("session.child.first"),
        props.tuiConfig,
      ) ?? "",
  )
  const backgroundShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.background"] })
          .get("session.background"),
        props.tuiConfig,
      ) ?? "",
  )
  const hints = createMemo(() => hintFlags(term().width))
  const busy = createMemo(() => props.state().phase === "running")
  const armed = createMemo(() => props.state().interrupt > 0)
  const exiting = createMemo(() => props.state().exit > 0)
  const queue = createMemo(() => props.state().queue)
  const additionalQueue = createMemo(() => Math.max(0, queue() - queuedPrompts().length))
  const duration = createMemo(() => props.state().duration)
  const usage = createMemo(() => props.state().usage)
  const interruptKey = createMemo(() => interrupt() || "/exit")
  const runTheme = createMemo(() => props.theme())
  const theme = createMemo(() => runTheme().footer)
  const block = createMemo(() => runTheme().block)
  const spin = createMemo(() => {
    return {
      frames: createFrames({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
    }
  })
  const permission = createMemo<Extract<FooterView, { type: "permission" }> | undefined>(() => {
    const view = active()
    return view.type === "permission" ? view : undefined
  })
  const question = createMemo<Extract<FooterView, { type: "question" }> | undefined>(() => {
    const view = active()
    return view.type === "question" ? view : undefined
  })
  const promptView = createMemo(() => {
    if (active().type !== "prompt") {
      return active().type
    }

    const current = route()
    return current.type === "composer" ? "prompt" : current.type
  })

  const openCommand = () => {
    setRoute({ type: "command" })
    props.onSubagentSelect?.(undefined)
  }

  const openModel = () => {
    setRoute({ type: "model" })
    props.onSubagentSelect?.(undefined)
  }

  const openVariant = () => {
    setRoute({ type: "variant" })
    props.onSubagentSelect?.(undefined)
  }

  const openSubagentMenu = () => {
    if (tabs().length === 0) {
      return
    }

    setRoute({ type: "subagent-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const openQueuedMenu = () => {
    if (queuedPrompts().length === 0) return
    setRoute({ type: "queued-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const closePanel = () => {
    setRoute({ type: "composer" })
  }

  const openTab = (sessionID: string) => {
    setRoute({ type: "subagent", sessionID })
    props.onSubagentSelect?.(sessionID)
  }

  const closeTab = () => {
    setRoute({ type: "composer" })
    props.onSubagentSelect?.(undefined)
  }

  const cycleTab = (dir: -1 | 1) => {
    if (tabs().length === 0) {
      return
    }

    const routeState = route()
    const current =
      routeState.type === "subagent" ? tabs().findIndex((item) => item.sessionID === routeState.sessionID) : -1
    const index = current === -1 ? 0 : (current + dir + tabs().length) % tabs().length
    const next = tabs()[index]
    if (!next) {
      return
    }

    openTab(next.sessionID)
  }
  const composer = createPromptState({
    directory: props.directory,
    findFiles: props.findFiles,
    agents: props.agents,
    resources: props.resources,
    commands: props.commands,
    tuiConfig: props.tuiConfig,
    state: props.state,
    view: promptView,
    prompt,
    width: () => term().width,
    theme,
    history: props.history,
    onSubmit: props.onSubmit,
    onCycle: props.onCycle,
    onInterrupt: props.onInterrupt,
    onInputClear: props.onInputClear,
    onExitRequest: props.onExitRequest,
    onExit: props.onExit,
    onRows: props.onRows,
    onStatus: props.onStatus,
  })
  const shell = createMemo(() => prompt() && composer.shell())
  const menu = createMemo(() => prompt() && composer.visible())

  createEffect(() => {
    props.onRequestExit?.(composer.requestExit)
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && !composer.visible(),
    commands: [
      {
        name: "command.palette.show",
        title: "Open command palette",
        category: "Prompt",
        run: openCommand,
      },
      {
        name: "variant.cycle",
        title: "Cycle model variant",
        category: "Model",
        run: props.onCycle,
      },
    ],
    bindings: [
      ...props.tuiConfig.keybinds.get("command.palette.show"),
      ...props.tuiConfig.keybinds.get("variant.cycle"),
    ],
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && foregroundSubagents(),
    priority: 1,
    commands: [
      {
        name: "session.background",
        title: "Background subagents",
        category: "Session",
        run: () => props.onBackground?.(),
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.background"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && tabs().length > 0,
    commands: [
      {
        name: "session.child.first",
        title: "View subagents",
        category: "Session",
        run: openSubagentMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.child.first"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && queuedPrompts().length > 0,
    commands: [
      {
        name: "session.queued_prompts",
        title: "Manage queued prompts",
        category: "Session",
        run: openQueuedMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.queued_prompts"),
  }))

  createEffect(() => {
    const current = route()
    if (current.type !== "subagent") {
      return
    }

    if (tabs().some((item) => item.sessionID === current.sessionID)) {
      return
    }

    closeTab()
  })

  createEffect(() => {
    if (route().type !== "subagent-menu") {
      return
    }

    if (tabs().length > 0) {
      return
    }

    closePanel()
  })

  createEffect(() => {
    if (route().type !== "queued-menu" || queuedPrompts().length > 0) return
    closePanel()
  })

  createEffect(() => {
    if (active().type === "prompt") {
      return
    }

    const current = route()
    if (
      current.type !== "command" &&
      current.type !== "model" &&
      current.type !== "variant" &&
      current.type !== "queued-menu" &&
      current.type !== "subagent-menu"
    ) {
      return
    }

    closePanel()
  })

  createEffect(() => {
    props.onLayout({
      route: route(),
      autocomplete: menu(),
      subagentRows: subagentMenuRows(),
    })
  })

  return (
    <box
      id="run-direct-footer-shell"
      width="100%"
      height="100%"
      border={false}
      backgroundColor="transparent"
      flexDirection="column"
      gap={0}
      padding={0}
    >
      <box id="run-direct-footer-top-spacer" width="100%" height={1} flexShrink={0} backgroundColor="transparent" />

      <Show
        when={inspecting()}
        fallback={
          <box width="100%" flexDirection="column" gap={0}>
            <box
              id="run-direct-footer-composer-frame"
              width="100%"
              flexShrink={0}
              border={panel() ? false : ["left"]}
              borderColor={theme().highlight}
              customBorderChars={{
                ...EMPTY_BORDER,
                vertical: "┃",
                bottomLeft: "╹",
              }}
            >
              <box
                id="run-direct-footer-composer-area"
                width="100%"
                flexGrow={1}
                paddingLeft={0}
                paddingRight={0}
                paddingTop={0}
                flexDirection="column"
                backgroundColor={panel() ? "transparent" : theme().surface}
                gap={0}
              >
                <box id="run-direct-footer-body" width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
                  <Switch>
                    <Match when={active().type === "prompt" && route().type === "composer"}>
                      <RunPromptBody
                        theme={theme}
                        placeholder={composer.placeholder}
                        onSubmit={composer.onSubmit}
                        onKeyDown={composer.onKeyDown}
                        onContentChange={composer.onContentChange}
                        bind={composer.bind}
                      />
                    </Match>
                    <Match when={selectingSubagent()}>
                      <RunSubagentSelectBody
                        theme={theme}
                        tabs={tabs}
                        current={selected}
                        onClose={closePanel}
                        onSelect={openTab}
                        onRows={setSubagentMenuRows}
                      />
                    </Match>
                    <Match when={selectingQueued()}>
                      <RunQueuedPromptSelectBody
                        theme={theme}
                        prompts={queuedPrompts}
                        onClose={closePanel}
                        onDelete={(item) => void props.onQueuedRemove(item.messageID)}
                        onEdit={async (item) => {
                          if (!(await props.onQueuedRemove(item.messageID))) return
                          closePanel()
                          queueMicrotask(() => composer.replacePrompt(item.prompt))
                        }}
                        onRows={setSubagentMenuRows}
                      />
                    </Match>
                    <Match when={commanding()}>
                      <RunCommandMenuBody
                        theme={theme}
                        commands={props.commands}
                        subagents={tabs}
                        queued={queuedPrompts}
                        variants={props.variants}
                        variantCycle={variantCycle()}
                        onClose={closePanel}
                        onModel={openModel}
                        onSubagent={openSubagentMenu}
                        onQueued={openQueuedMenu}
                        onVariant={openVariant}
                        onVariantCycle={() => {
                          props.onCycle()
                          closePanel()
                        }}
                        onCommand={(name) => {
                          composer.submitText(`/${name}`)
                          closePanel()
                        }}
                        onNew={() => {
                          composer.submitText("/new")
                          closePanel()
                        }}
                        onExit={props.onExit}
                      />
                    </Match>
                    <Match when={modeling()}>
                      <RunModelSelectBody
                        theme={theme}
                        providers={props.providers}
                        current={props.currentModel}
                        onClose={closePanel}
                        onSelect={(model) => {
                          props.onModelSelect(model)
                          closePanel()
                        }}
                      />
                    </Match>
                    <Match when={varianting()}>
                      <RunVariantSelectBody
                        theme={theme}
                        variants={props.variants}
                        current={props.currentVariant}
                        onClose={closePanel}
                        onSelect={(variant) => {
                          props.onVariantSelect(variant)
                          closePanel()
                        }}
                      />
                    </Match>
                    <Match when={active().type === "permission"}>
                      <RunPermissionBody
                        request={permission()!.request}
                        theme={theme()}
                        block={block()}
                        diffStyle={props.diffStyle}
                        onReply={props.onPermissionReply}
                      />
                    </Match>
                    <Match when={active().type === "question"}>
                      <RunQuestionBody
                        request={question()!.request}
                        theme={theme()}
                        onReply={props.onQuestionReply}
                        onReject={props.onQuestionReject}
                      />
                    </Match>
                  </Switch>
                </box>

                <Show when={!menu() && !panel()}>
                  <box
                    id="run-direct-footer-meta-row"
                    width="100%"
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    flexShrink={0}
                    paddingTop={1}
                  >
                    <text id="run-direct-footer-agent" fg={theme().highlight} wrapMode="none" truncate flexShrink={0}>
                      {shell() ? "Shell" : props.agent}
                    </text>
                    <Show when={!shell()}>
                      <box id="run-direct-footer-model" flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
                        <text fg={theme().muted} wrapMode="none" flexShrink={0}>
                          ·
                        </text>
                        <text fg={theme().text} wrapMode="none" truncate flexShrink={1}>
                          {model().model}
                        </text>
                        <Show when={model().provider}>
                          {(provider) => (
                            <text fg={theme().muted} wrapMode="none" truncate flexShrink={1}>
                              {provider()}
                            </text>
                          )}
                        </Show>
                        <Show when={props.currentVariant()}>
                          {(variant) => (
                            <>
                              <text fg={theme().muted} wrapMode="none" flexShrink={0}>
                                ·
                              </text>
                              <text wrapMode="none" truncate flexShrink={1}>
                                <span style={{ fg: theme().warning, bold: true }}>{variant()}</span>
                              </text>
                            </>
                          )}
                        </Show>
                      </box>
                    </Show>
                  </box>
                </Show>
              </box>
            </box>

            <Show when={!panel()}>
              <Show
                when={menu()}
                fallback={
                  <box
                    id="run-direct-footer-line-6"
                    width="100%"
                    height={1}
                    border={["left"]}
                    borderColor={theme().highlight}
                    backgroundColor="transparent"
                    customBorderChars={{
                      ...EMPTY_BORDER,
                      vertical: "╹",
                    }}
                    flexShrink={0}
                  >
                    <box
                      id="run-direct-footer-line-6-fill"
                      width="100%"
                      height={1}
                      border={["bottom"]}
                      borderColor={theme().surface}
                      backgroundColor="transparent"
                      customBorderChars={{
                        ...EMPTY_BORDER,
                        horizontal: "▀",
                      }}
                    />
                  </box>
                }
              >
                <box
                  id="run-direct-footer-menu-transition"
                  width="100%"
                  height={1}
                  border={["left"]}
                  borderColor={theme().highlight}
                  backgroundColor="transparent"
                  customBorderChars={{
                    ...EMPTY_BORDER,
                    vertical: "┃",
                  }}
                  flexShrink={0}
                >
                  <box
                    id="run-direct-footer-menu-transition-fill"
                    width="100%"
                    height={1}
                    backgroundColor={theme().surface}
                  />
                </box>
              </Show>

              <Show
                when={menu()}
                fallback={
                  <box
                    id="run-direct-footer-row"
                    width="100%"
                    height={1}
                    flexDirection="row"
                    justifyContent="space-between"
                    gap={1}
                    flexShrink={0}
                  >
                    <Show
                      when={busy() || exiting() || duration().length > 0 || queuedIndicator() || subagentIndicator()}
                    >
                      <box id="run-direct-footer-hint-left" flexDirection="row" gap={1} flexShrink={0} marginLeft={1}>
                        <Show when={exiting()}>
                          <text id="run-direct-footer-hint-exit" fg={theme().highlight} wrapMode="none" truncate>
                            Press Ctrl-c again to exit
                          </text>
                        </Show>

                        <Show when={busy() && !exiting()}>
                          <box id="run-direct-footer-status-spinner" flexShrink={0}>
                            <spinner color={spin().color} frames={spin().frames} interval={40} />
                          </box>

                          <text
                            id="run-direct-footer-hint-interrupt"
                            fg={armed() ? theme().highlight : theme().text}
                            wrapMode="none"
                            truncate
                          >
                            {interruptKey()}{" "}
                            <span style={{ fg: armed() ? theme().highlight : theme().muted }}>
                              {armed() ? "again to interrupt" : "interrupt"}
                            </span>
                          </text>
                        </Show>

                        <Show when={!busy() && !exiting() && duration().length > 0}>
                          <box id="run-direct-footer-duration" flexDirection="row" gap={2} flexShrink={0}>
                            <text id="run-direct-footer-duration-mark" fg={theme().muted} wrapMode="none" truncate>
                              ▣
                            </text>
                            <box id="run-direct-footer-duration-tail" flexDirection="row" gap={1} flexShrink={0}>
                              <text id="run-direct-footer-duration-dot" fg={theme().muted} wrapMode="none" truncate>
                                ·
                              </text>
                              <text id="run-direct-footer-duration-value" fg={theme().muted} wrapMode="none" truncate>
                                {duration()}
                              </text>
                            </box>
                          </box>
                        </Show>

                        <Show when={subagentIndicator()}>
                          {(info) => (
                            <text id="run-direct-footer-subagents-label" fg={theme().text} wrapMode="none" truncate>
                              <span style={{ fg: theme().highlight }}>• </span>
                              {info().count} <span style={{ fg: theme().muted }}>{info().label} </span>
                              <span style={{ fg: theme().highlight }}>{subagentShortcut() || "leader+down"}</span>
                            </text>
                          )}
                        </Show>
                        <Show when={foregroundSubagents() && backgroundShortcut()}>
                          <text id="run-direct-footer-background-label" fg={theme().text} wrapMode="none" truncate>
                            <span style={{ fg: theme().highlight }}>• </span>
                            <span style={{ fg: theme().highlight }}>{backgroundShortcut()}</span>{" "}
                            <span style={{ fg: theme().muted }}>background</span>
                          </text>
                        </Show>
                        <Show when={queuedIndicator()}>
                          {(info) => (
                            <text id="run-direct-footer-queued-label" fg={theme().text} wrapMode="none" truncate>
                              <span style={{ fg: theme().warning }}>• </span>
                              {info().count} <span style={{ fg: theme().muted }}>queued </span>
                              <span style={{ fg: theme().highlight }}>{queuedShortcut() || "leader+q"}</span>
                            </text>
                          )}
                        </Show>
                      </box>
                    </Show>

                    <box id="run-direct-footer-spacer" flexGrow={1} flexShrink={1} backgroundColor="transparent" />

                    <box
                      id="run-direct-footer-hint-group"
                      flexDirection="row"
                      gap={2}
                      flexShrink={0}
                      justifyContent="flex-end"
                    >
                      <Show
                        when={shell()}
                        fallback={
                          <>
                            <Show when={additionalQueue() > 0}>
                              <text id="run-direct-footer-queue" fg={theme().muted} wrapMode="none" truncate>
                                {additionalQueue()} queued
                              </text>
                            </Show>
                            <Show when={usage().length > 0}>
                              <text id="run-direct-footer-usage" fg={theme().muted} wrapMode="none" truncate>
                                {usage()}
                              </text>
                            </Show>
                            <Show when={command().length > 0 && hints().command}>
                              <text id="run-direct-footer-hint-command" fg={theme().text} wrapMode="none" truncate>
                                {command()} <span style={{ fg: theme().muted }}>commands</span>
                              </text>
                            </Show>
                          </>
                        }
                      >
                        <text id="run-direct-footer-hint-shell" fg={theme().text} wrapMode="none" truncate>
                          esc <span style={{ fg: theme().muted }}>exit shell mode</span>
                        </text>
                      </Show>
                    </box>
                  </box>
                }
              >
                <box id="run-direct-footer-complete-shell" width="100%" flexDirection="column" flexShrink={0}>
                  <RunFooterMenu
                    id="run-direct-footer-complete"
                    theme={theme}
                    items={composer.options}
                    selected={composer.selected}
                    offset={composer.offset}
                    rows={composer.rows}
                    limit={FOOTER_MENU_ROWS}
                    paddingLeft={2}
                  />
                  <box
                    id="run-direct-footer-complete-bottom"
                    width="100%"
                    height={1}
                    border={["left"]}
                    borderColor={theme().border}
                    backgroundColor="transparent"
                    customBorderChars={{
                      ...EMPTY_BORDER,
                      vertical: "╹",
                    }}
                    flexShrink={0}
                  >
                    <box
                      id="run-direct-footer-complete-bottom-fill"
                      width="100%"
                      height={1}
                      border={["bottom"]}
                      borderColor={theme().surface}
                      backgroundColor="transparent"
                      customBorderChars={{
                        ...EMPTY_BORDER,
                        horizontal: "▀",
                      }}
                    />
                  </box>
                </box>
              </Show>
            </Show>
          </box>
        }
      >
        <box
          id="run-direct-footer-subagent-frame"
          width="100%"
          flexGrow={1}
          flexShrink={1}
          border={["left"]}
          borderColor={theme().highlight}
          customBorderChars={{
            ...EMPTY_BORDER,
            vertical: "┃",
          }}
        >
          <RunFooterSubagentBody
            active={inspecting}
            theme={runTheme}
            tab={selectedTab}
            index={selectedIndex}
            total={() => tabs().length}
            detail={detail}
            width={() => term().width}
            diffStyle={props.diffStyle}
            onCycle={cycleTab}
            onClose={closeTab}
          />
        </box>
      </Show>
    </box>
  )
}
