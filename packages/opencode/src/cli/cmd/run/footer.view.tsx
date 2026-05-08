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
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import "opentui-spinner/solid"
import { createColors, createFrames } from "../tui/ui/spinner"
import { RunCommandMenuBody, RunModelSelectBody, RunVariantSelectBody } from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody, RunFooterSubagentTabs } from "./footer.subagent"
import { RunPromptBody, createPromptState, hintFlags } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunQuestionBody } from "./footer.question"
import { printableBinding, promptBindings, promptHit, promptInfo } from "./prompt.shared"
import type {
  FooterKeybinds,
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
} from "./types"
import { RUN_THEME_FALLBACK, type RunTheme } from "./theme"

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
  theme?: RunTheme
  diffStyle?: RunDiffStyle
  keybinds: FooterKeybinds
  history?: RunPrompt[]
  agent: string
  onSubmit: (input: RunPrompt) => boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; tabs: boolean; autocomplete: boolean }) => void
  onStatus: (text: string) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
}

function subagentShortcut(event: {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
}): number | undefined {
  if (!event.ctrl || event.meta || event.super) {
    return undefined
  }

  if (!/^[0-9]$/.test(event.name)) {
    return undefined
  }

  const slot = Number(event.name)
  return slot === 0 ? 9 : slot - 1
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
  const prompt = createMemo(() => active().type === "prompt" && route().type === "composer")
  const inspecting = createMemo(() => active().type === "prompt" && route().type === "subagent")
  const commanding = createMemo(() => active().type === "prompt" && route().type === "command")
  const modeling = createMemo(() => active().type === "prompt" && route().type === "model")
  const varianting = createMemo(() => active().type === "prompt" && route().type === "variant")
  const panel = createMemo(() => commanding() || modeling() || varianting())
  const selected = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? current.sessionID : undefined
  })
  const tabs = createMemo(() => subagent().tabs)
  const showTabs = createMemo(() => active().type === "prompt" && tabs().length > 0)
  const detail = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? subagent().details[current.sessionID] : undefined
  })
  const command = createMemo(() => printableBinding(props.keybinds.commandList, props.keybinds.leader))
  const interrupt = createMemo(() => printableBinding(props.keybinds.interrupt, props.keybinds.leader))
  const commandKeys = createMemo(() => promptBindings(props.keybinds.commandList, props.keybinds.leader))
  const hints = createMemo(() => hintFlags(term().width))
  const busy = createMemo(() => props.state().phase === "running")
  const armed = createMemo(() => props.state().interrupt > 0)
  const exiting = createMemo(() => props.state().exit > 0)
  const queue = createMemo(() => props.state().queue)
  const duration = createMemo(() => props.state().duration)
  const usage = createMemo(() => props.state().usage)
  const interruptKey = createMemo(() => interrupt() || "/exit")
  const runTheme = createMemo(() => props.theme ?? RUN_THEME_FALLBACK)
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

  const toggleTab = (sessionID: string) => {
    const current = route()
    if (current.type === "subagent" && current.sessionID === sessionID) {
      closeTab()
      return
    }

    openTab(sessionID)
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
    keybinds: props.keybinds,
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
  const menu = createMemo(() => prompt() && composer.visible())

  createEffect(() => {
    props.onRequestExit?.(composer.requestExit)
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    if (active().type !== "prompt") {
      return
    }

    if (route().type !== "composer") {
      return
    }

    if (composer.visible()) {
      return
    }

    if (!promptHit(commandKeys(), promptInfo(event))) {
      return
    }

    event.preventDefault()
    openCommand()
  })

  useKeyboard((event) => {
    if (active().type !== "prompt") {
      return
    }

    const slot = subagentShortcut(event)
    if (slot !== undefined) {
      const next = tabs()[slot]
      if (!next) {
        return
      }

      event.preventDefault()
      toggleTab(next.sessionID)
    }
  })

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
    if (active().type === "prompt") {
      return
    }

    const current = route()
    if (current.type !== "command" && current.type !== "model" && current.type !== "variant") {
      return
    }

    closePanel()
  })

  createEffect(() => {
    props.onLayout({
      route: route(),
      tabs: tabs().length > 0,
      autocomplete: menu(),
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

      <Show when={showTabs()}>
        <RunFooterSubagentTabs tabs={tabs()} selected={selected()} theme={theme()} width={term().width} />
      </Show>

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
                        bindings={composer.bindings}
                        onSubmit={composer.onSubmit}
                        onKeyDown={composer.onKeyDown}
                        onContentChange={composer.onContentChange}
                        bind={composer.bind}
                      />
                    </Match>
                    <Match when={commanding()}>
                      <RunCommandMenuBody
                        theme={theme}
                        commands={props.commands}
                        variants={props.variants}
                        keybinds={props.keybinds}
                        onClose={closePanel}
                        onModel={openModel}
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
                      {props.agent}
                    </text>
                    <text
                      id="run-direct-footer-model"
                      fg={theme().text}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                      flexShrink={1}
                    >
                      {props.state().model}
                    </text>
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
                    <Show when={busy() || exiting()}>
                      <box id="run-direct-footer-hint-left" flexDirection="row" gap={1} flexShrink={0}>
                        <Show when={exiting()}>
                          <text
                            id="run-direct-footer-hint-exit"
                            fg={theme().highlight}
                            wrapMode="none"
                            truncate
                            marginLeft={1}
                          >
                            Press Ctrl-c again to exit
                          </text>
                        </Show>

                        <Show when={busy() && !exiting()}>
                          <box id="run-direct-footer-status-spinner" marginLeft={1} flexShrink={0}>
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
                      </box>
                    </Show>

                    <Show when={!busy() && !exiting() && duration().length > 0}>
                      <box id="run-direct-footer-duration" flexDirection="row" gap={2} flexShrink={0} marginLeft={1}>
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

                    <box id="run-direct-footer-spacer" flexGrow={1} flexShrink={1} backgroundColor="transparent" />

                    <box
                      id="run-direct-footer-hint-group"
                      flexDirection="row"
                      gap={2}
                      flexShrink={0}
                      justifyContent="flex-end"
                    >
                      <Show when={queue() > 0}>
                        <text id="run-direct-footer-queue" fg={theme().muted} wrapMode="none" truncate>
                          {queue()} queued
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
