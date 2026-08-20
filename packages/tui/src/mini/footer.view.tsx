// Footer layout
//
// Renders the footer region as a compact vertical stack:
//   1. Single-line composer or active footer body
//   2. Optional autocomplete/menu panels below the composer
//   3. A statusline-style footer row carrying state, hints, and model info
//
// All state comes from the parent RunFooter through SolidJS signals.
// The view itself is stateless except for derived memos.
/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { registerOpencodeSpinner } from "../component/register-spinner"
import { createColors, createFrames } from "../ui/spinner"
import {
  RUN_SUBAGENT_PANEL_ROWS,
  RunAgentSelectBody,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSettingsBody,
  RunSkillSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody } from "./footer.subagent"
import { RunPromptBody, createPromptState } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunFormBody } from "./footer.form"
import { createFormBodyState, type FormBodyState } from "./form.shared"
import { footerStatuslinePolicy } from "./footer.width"
import { Keymap } from "../context/keymap"
import { modelInfo } from "./variant.shared"
import { monoShortcut } from "./mono"
import { stringWidth } from "../util/string-width"
import { errorMessage } from "../util/error"
import { createSingleFlight } from "../util/single-flight"

import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
  FooterState,
  FooterSubagentState,
  FooterView,
  FormCancel,
  FormReply,
  MiniSettingChange,
  MiniSettings,
  PermissionReply,
  QueuedPromptAction,
  RunAgent,
  RunCommand,
  RunInput,
  RunPrompt,
  RunProvider,
  RunReference,
} from "./types"
import type { RunTheme } from "./theme"

registerOpencodeSpinner()

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
  directory: () => string
  findFiles: (query: string) => Promise<string[]>
  agents: () => RunAgent[]
  references: () => RunReference[]
  commands: () => RunCommand[] | undefined
  providers: () => RunProvider[] | undefined
  currentAgent: () => string
  currentAgentID: () => string | undefined
  currentAgentExplicit: () => boolean
  currentModel: () => RunInput["model"]
  variants: () => string[]
  currentVariant: () => string | undefined
  state: () => FooterState
  view?: () => FooterView
  subagent?: () => FooterSubagentState
  queuedPrompts?: () => FooterQueuedPrompt[]
  theme: () => RunTheme
  mono: boolean
  miniSettings: () => MiniSettings
  history?: () => RunPrompt[]
  onSubmit: (input: RunPrompt) => boolean | Promise<boolean>
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onFormReply: (input: FormReply) => void | Promise<void>
  onFormCancel: (input: FormCancel) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onBackground?: () => void
  onQueuedPromptAction?: (action: QueuedPromptAction, inboxID: string) => Promise<void>
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onAgentSelect: (agent: string) => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; subagentRows: number }) => void
  onStatus: (text: string) => void
  onMiniSettingChange: (change: MiniSettingChange) => void | Promise<void>
  onSubagentSelect?: (sessionID: string | undefined) => void
  onSubagentInterrupt?: (sessionID: string) => void
}

export function RunFooterView(props: RunFooterViewProps) {
  const term = useTerminalDimensions()
  const width = createMemo(() => term().width)
  const active = createMemo<FooterView>(() => props.view?.() ?? { type: "prompt" })
  const subagent = createMemo<FooterSubagentState>(() => {
    return (
      props.subagent?.() ?? {
        tabs: [],
        details: {},
        permissions: [],
        forms: [],
      }
    )
  })
  const [route, setRoute] = createSignal<FooterPromptRoute>({ type: "composer" })
  const [subagentMenuRows, setSubagentMenuRows] = createSignal(RUN_SUBAGENT_PANEL_ROWS)
  const queuedPrompts = createMemo(() => props.queuedPrompts?.() ?? [])
  const queue = createMemo(() => queuedPrompts().filter((item) => item.delivery === "queue"))
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  const prompt = createMemo(() => active().type === "prompt" && route().type === "composer")
  const selectingSubagent = createMemo(() => active().type === "prompt" && route().type === "subagent-menu")
  const selectingQueued = createMemo(() => active().type === "prompt" && route().type === "queued-menu")
  const inspecting = createMemo(() => active().type === "prompt" && route().type === "subagent")
  const commanding = createMemo(() => active().type === "prompt" && route().type === "command")
  const skilling = createMemo(() => active().type === "prompt" && route().type === "skill")
  const agenting = createMemo(() => active().type === "prompt" && route().type === "agent")
  const modeling = createMemo(() => active().type === "prompt" && route().type === "model")
  const varianting = createMemo(() => active().type === "prompt" && route().type === "variant")
  const setting = createMemo(() => active().type === "prompt" && route().type === "settings")
  const panel = createMemo(
    () =>
      active().type === "permission" ||
      active().type === "form" ||
      selectingQueued() ||
      selectingSubagent() ||
      commanding() ||
      skilling() ||
      agenting() ||
      modeling() ||
      varianting() ||
      setting(),
  )
  const selected = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? current.sessionID : undefined
  })
  const tabs = createMemo(() => subagent().tabs)
  const activeTabs = createMemo(() => tabs().filter((item) => item.status === "running"))
  const selectedTab = createMemo(() => tabs().find((item) => item.sessionID === selected()))
  const selectedIndex = createMemo(() => {
    const sessionID = selected()
    if (!sessionID) {
      return 0
    }

    return tabs().findIndex((item) => item.sessionID === sessionID) + 1
  })
  const foregroundSubagents = createMemo(() => activeTabs().some((item) => !item.background))
  const model = createMemo(() => {
    const current = props.currentModel()
    return current ? modelInfo(props.providers(), current).model : undefined
  })
  const detail = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? subagent().details[current.sessionID] : undefined
  })
  const shortcuts = Keymap.useShortcuts()
  const shortcut = (id: string) => monoShortcut(shortcuts.get(id) ?? "", props.mono)
  const command = () => shortcut("command.palette.show")
  const subagentShortcut = () => shortcut("session.child.first")
  const queuedShortcut = () => shortcut("session.queued_prompts")
  const backgroundShortcut = () => shortcut("session.background")
  const subagentInterruptShortcut = () => shortcut("composer.subagent.interrupt")
  const interrupt = () => shortcut("session.interrupt")
  const variantCycle = () => monoShortcut(shortcuts.all("variant.cycle") ?? "", props.mono)
  const clearShortcut = () => shortcut("prompt.clear")
  const busy = createMemo(() => props.state().phase === "running")
  const armed = createMemo(() => props.state().interrupt > 0)
  const exiting = createMemo(() => props.state().exit > 0)
  const usage = createMemo(() => props.state().usage)
  const footerDetails = createMemo(() => props.miniSettings().footer === "show")
  const interruptLabel = createMemo(() => {
    if (!interrupt()) {
      return
    }

    return interrupt() === "escape" ? "esc" : interrupt()
  })
  const runTheme = createMemo(() => props.theme())
  const theme = createMemo(() => runTheme().footer)
  const block = createMemo(() => runTheme().block)
  const spin = createMemo(() => {
    if (props.mono) {
      return {
        frames: ["-", "\\", "|", "/"],
        color: theme().text,
      }
    }
    const options = {
      color: theme().highlight,
      style: "blocks" as const,
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }
    return {
      frames: createFrames(options),
      color: createColors(options),
    }
  })
  const footerStatus = createMemo(() => {
    const current = model() ?? props.state().model.trim()
    const variant = props.currentVariant()
    const details = [busy() ? "running" : "idle", `agent ${props.currentAgent()}`]
    if (current) details.push(variant ? `${current} ${variant}` : current)
    if (usage()) details.push(props.mono ? usage().replaceAll(" · ", " - ") : usage())
    if (queue().length > 0) details.push(`${queue().length} queued`)
    if (activeTabs().length > 0) details.push(`${activeTabs().length} subagent${activeTabs().length === 1 ? "" : "s"}`)
    return details.join(props.mono ? " - " : " · ")
  })
  const permission = createMemo<Extract<FooterView, { type: "permission" }> | undefined>(() => {
    const view = active()
    return view.type === "permission" ? view : undefined
  })
  const form = createMemo<Extract<FooterView, { type: "form" }> | undefined>(() => {
    const view = active()
    return view.type === "form" ? view : undefined
  })
  const formStates = new Map<string, FormBodyState>()
  const settledForms = new Set<string>()
  let formsAbsent = true

  createEffect(() => {
    const view = active()
    if (view.type === "form") {
      formsAbsent = false
      return
    }
    if (view.type === "permission") return
    formsAbsent = true
    formStates.clear()
    settledForms.clear()
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

  const openAgent = () => {
    setRoute({ type: "agent" })
    props.onSubagentSelect?.(undefined)
  }

  const openSkillMenu = () => {
    if (props.commands() && skills().length === 0) {
      return
    }

    setRoute({ type: "skill" })
    props.onSubagentSelect?.(undefined)
  }

  const openVariant = () => {
    setRoute({ type: "variant" })
    props.onSubagentSelect?.(undefined)
  }

  const openSettings = () => {
    setRoute({ type: "settings" })
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
    if (queue().length === 0) return
    setRoute({ type: "queued-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const closePanel = () => {
    setRoute({ type: "composer" })
  }

  const runQueuedAction = createSingleFlight<string>()
  const queuedPromptAction = async (action: QueuedPromptAction, inboxID: string) => {
    const run = props.onQueuedPromptAction
    if (!run) return false
    const result = await runQueuedAction(inboxID, async () => {
      const error = await run(action, inboxID).then(
        () => undefined,
        (error) => error,
      )
      if (!error) return true
      props.onStatus(`failed to ${action === "cancel" ? "delete" : action} queued prompt: ${errorMessage(error)}`)
      return false
    })
    return result ?? false
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
    references: props.references,
    commands: props.commands,
    state: props.state,
    view: promptView,
    prompt,
    width,
    theme,
    mono: () => props.mono,
    history: props.history,
    queuedPrompts: queue,
    onQueuedPromptSteer: (inboxID) => queuedPromptAction("steer", inboxID),
    onSubmit: props.onSubmit,
    onCycle: props.onCycle,
    onInterrupt: props.onInterrupt,
    onEditorOpen: props.onEditorOpen,
    onInputClear: props.onInputClear,
    onExitRequest: props.onExitRequest,
    onExit: props.onExit,
    onSkillMenu: openSkillMenu,
    onSettings: openSettings,
    onRows: props.onRows,
    onStatus: props.onStatus,
  })
  const shell = createMemo(() => prompt() && composer.shell())
  const menu = createMemo(() => prompt() && composer.visible())
  const stateStatus = createMemo(() => props.state().status.trim())
  const notice = createMemo(() => props.state().notice.trim())
  const modeLabel = createMemo(() => {
    if (exiting()) {
      return "EXIT"
    }

    return shell() ? "SHELL" : undefined
  })
  const modeColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (shell()) {
      return theme().warning
    }

    return theme().highlight
  })
  const statusText = createMemo(() => {
    if (exiting()) {
      return `Press ${clearShortcut() || "ctrl+c"} again to exit`
    }

    if (busy() && armed()) return "again to interrupt"

    if (notice()) return notice()

    if (!footerDetails()) return shell() ? "Shell mode" : ""

    if (busy()) return "interrupt"

    if (stateStatus().length > 0) {
      return stateStatus()
    }

    return shell() ? "Shell mode" : ""
  })
  const activityMeta = createMemo(() => {
    if (!footerDetails()) return ""
    return props.mono ? usage().replaceAll(" · ", " - ") : usage()
  })
  const agentStatus = createMemo(() => {
    if (!footerDetails() || !prompt() || shell() || !props.currentAgentExplicit()) return undefined
    return props.currentAgent()
  })
  const modelStatus = createMemo(() => {
    const current = model() ?? props.state().model.trim()
    if (!footerDetails() || !prompt() || shell() || !current) return
    return {
      model: current,
      variant: props.currentVariant(),
    }
  })
  const statusColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (armed()) {
      return theme().highlight
    }

    if (busy() || notice().length > 0 || stateStatus().length > 0) {
      return theme().text
    }

    return theme().muted
  })
  const statuslineBackground = createMemo(() => theme().status)
  const contextHintCandidates = createMemo(() => {
    if (!footerDetails() || !prompt() || shell()) {
      return []
    }

    const items: Array<{ key: string; label: string }> = []
    if (foregroundSubagents() && backgroundShortcut()) {
      items.push({ key: backgroundShortcut(), label: "background" })
    }
    if (queue().length > 0 && queuedShortcut()) {
      items.push({ key: queuedShortcut(), label: `${queue().length} queued` })
    }
    if (activeTabs().length > 0 && subagentShortcut()) {
      items.push({ key: subagentShortcut(), label: "subagents" })
    }
    return items
  })
  const commandHint = createMemo(() => {
    if (!prompt()) return

    if (shell()) {
      return { key: "esc", label: "normal" }
    }

    if (command()) {
      return { key: command(), label: "cmd" }
    }
  })
  const commandHintWidth = createMemo(() => {
    const hint = commandHint()
    return hint ? stringWidth(`${hint.key} ${hint.label}`) : 0
  })
  const statuslineText = createMemo(() =>
    busy() && !exiting() && (footerDetails() || armed())
      ? `${interruptLabel() ? `${interruptLabel()} ` : ""}${statusText()}`
      : statusText(),
  )
  const statuslineMainWidth = createMemo(() => {
    const mode = modeLabel()
    const modeWidth = mode ? stringWidth(mode) + (props.mono ? 1 : 2) : 0
    const spinnerWidth = footerDetails() && busy() && !exiting() ? stringWidth(spin().frames[0] ?? "") + 1 : 0
    return modeWidth + Math.max(12, (props.mono ? 1 : 2) + spinnerWidth + stringWidth(statuslineText()))
  })
  const visibleModeLabel = createMemo(() => {
    const mode = modeLabel()
    if (!mode || width() - commandHintWidth() < stringWidth(mode) + (props.mono ? 1 : 2)) return undefined
    return mode
  })
  const statuslineMainAvailable = createMemo(() => {
    const mode = visibleModeLabel()
    return width() - commandHintWidth() - (mode ? stringWidth(mode) + (props.mono ? 1 : 2) : 0)
  })
  const statuslineLayout = createMemo(() => {
    const agent = agentStatus()
    const info = modelStatus()
    return footerStatuslinePolicy({
      width: width(),
      mainWidth: statuslineMainWidth(),
      commandWidth: commandHint() ? commandHintWidth() : undefined,
      agentWidth: agent ? stringWidth(agent) : undefined,
      contextWidths: contextHintCandidates().map((item) => stringWidth(`${item.key} ${item.label}`)),
      modelWidth: info ? stringWidth(info.model) : undefined,
      variantWidth: info?.variant ? stringWidth(` ${info.variant}`) : undefined,
      usageWidth: activityMeta() ? stringWidth(activityMeta()) : undefined,
    })
  })
  const contextHints = createMemo(() => contextHintCandidates().slice(0, statuslineLayout().contextCount))
  const hasStatuslineInfo = createMemo(() => {
    const layout = statuslineLayout()
    return layout.showUsage || layout.showAgent || layout.showModel
  })
  const sectionSeparator = () => <span style={{ fg: theme().muted }}>{props.mono ? "- " : "· "}</span>

  createEffect(() => {
    props.onRequestExit?.(composer.requestExit)
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  Keymap.createLayer(() => ({
    enabled: active().type === "prompt" && route().type === "composer" && !composer.visible(),
    commands: [
      {
        id: "command.palette.show",
        title: "Open command palette",
        group: "Prompt",
        run: openCommand,
      },
      {
        id: "variant.cycle",
        title: "Cycle model variant",
        group: "Model",
        run: props.onCycle,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: active().type === "prompt" && route().type === "composer" && foregroundSubagents() && !!props.onBackground,
    priority: 1,
    commands: [
      {
        id: "session.background",
        title: "Background subagents",
        group: "Session",
        run: () => props.onBackground?.(),
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: active().type === "prompt" && route().type === "composer" && tabs().length > 0,
    commands: [
      {
        id: "session.child.first",
        title: "View subagents",
        group: "Session",
        run: openSubagentMenu,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: active().type === "prompt" && route().type === "composer" && queue().length > 0,
    commands: [
      {
        id: "session.queued_prompts",
        title: "View queued prompts",
        group: "Prompt",
        run: openQueuedMenu,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled:
      active().type === "prompt" &&
      route().type === "subagent" &&
      selectedTab()?.status === "running" &&
      !!props.onSubagentInterrupt,
    priority: 1,
    commands: [
      {
        id: "composer.subagent.interrupt",
        title: "Interrupt subagent",
        group: "Session",
        run: () => {
          const current = selectedTab()
          if (current?.status !== "running") {
            return
          }

          props.onSubagentInterrupt?.(current.sessionID)
        },
      },
    ],
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
    if (route().type !== "queued-menu" || queue().length > 0) return
    closePanel()
  })

  createEffect(() => {
    if (active().type === "prompt") {
      return
    }

    const current = route()
    if (
      current.type !== "command" &&
      current.type !== "skill" &&
      current.type !== "agent" &&
      current.type !== "model" &&
      current.type !== "variant" &&
      current.type !== "settings" &&
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
      subagentRows: subagentMenuRows(),
    })
  })

  return (
    <box
      width="100%"
      height="100%"
      border={false}
      backgroundColor="transparent"
      flexDirection="column"
      gap={0}
      padding={0}
    >
      <Show when={panel() || inspecting()}>
        <box width="100%" height={1} flexShrink={0} backgroundColor="transparent" />
      </Show>

      <Show
        when={inspecting()}
        fallback={
          <box width="100%" flexDirection="column" gap={0}>
            <For each={[promptView()]}>
              {() => (
                <box
                  width="100%"
                  flexShrink={0}
                  border={panel() || prompt() ? false : ["left"]}
                  borderColor={panel() || prompt() ? undefined : theme().highlight}
                  customBorderChars={
                    panel() || prompt()
                      ? undefined
                      : {
                          ...EMPTY_BORDER,
                          vertical: props.mono ? "|" : "█",
                        }
                  }
                >
                  <box
                    width="100%"
                    flexGrow={1}
                    paddingLeft={0}
                    paddingRight={0}
                    paddingTop={0}
                    flexDirection="column"
                    backgroundColor={panel() || prompt() ? "transparent" : theme().surface}
                    gap={0}
                  >
                    <box width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
                      <Switch>
                        <Match when={active().type === "prompt" && route().type === "composer"}>
                          <RunPromptBody
                            theme={theme}
                            background={() => runTheme().background}
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
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={selectingQueued()}>
                          <RunQueuedPromptSelectBody
                            theme={theme}
                            prompts={queue}
                            onClose={closePanel}
                            onSteer={(item) => {
                              void queuedPromptAction("steer", item.messageID).then((steered) => {
                                if (steered) closePanel()
                              })
                            }}
                            onDelete={(item) => {
                              void queuedPromptAction("cancel", item.messageID)
                            }}
                            onRows={setSubagentMenuRows}
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={commanding()}>
                          <RunCommandMenuBody
                            theme={theme}
                            commands={props.commands}
                            subagents={tabs}
                            queued={queue}
                            variants={props.variants}
                            variantCycle={variantCycle()}
                            onClose={closePanel}
                            onAgent={openAgent}
                            onModel={openModel}
                            onEditor={() => {
                              closePanel()
                              void composer.openEditor()
                            }}
                            onSkill={openSkillMenu}
                            onSubagent={openSubagentMenu}
                            onQueued={openQueuedMenu}
                            onVariant={openVariant}
                            onSettings={openSettings}
                            onVariantCycle={() => {
                              props.onCycle()
                              closePanel()
                            }}
                            onStatus={() => {
                              props.onStatus(footerStatus())
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
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={skilling()}>
                          <RunSkillSelectBody
                            theme={theme}
                            commands={props.commands}
                            onClose={closePanel}
                            onSelect={(name) => {
                              composer.replacePrompt({
                                text: `/${name} `,
                                parts: [],
                                command: {
                                  name,
                                  arguments: "",
                                  source: "skill",
                                },
                              })
                              closePanel()
                            }}
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={agenting()}>
                          <RunAgentSelectBody
                            theme={theme}
                            agents={props.agents}
                            current={props.currentAgentID}
                            onClose={closePanel}
                            onSelect={(agent) => {
                              props.onAgentSelect(agent)
                              closePanel()
                            }}
                            mono={props.mono}
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
                            mono={props.mono}
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
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={setting()}>
                          <RunSettingsBody
                            theme={theme}
                            settings={props.miniSettings}
                            onClose={closePanel}
                            onChange={props.onMiniSettingChange}
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={active().type === "permission"}>
                          <RunPermissionBody
                            request={permission()!.request}
                            directory={props.directory}
                            theme={theme()}
                            block={block()}
                            onReply={props.onPermissionReply}
                            mono={props.mono}
                          />
                        </Match>
                        <Match when={active().type === "form"}>
                          <For each={form() ? [form()!] : []}>
                            {(value) => (
                              <RunFormBody
                                request={value.request}
                                theme={theme()}
                                state={formStates.get(value.request.id) ?? createFormBodyState(value.request)}
                                onState={(state) => {
                                  if (!formsAbsent && !settledForms.has(state.formID))
                                    formStates.set(state.formID, state)
                                }}
                                onReply={async (input) => {
                                  await props.onFormReply(input)
                                  settledForms.add(input.formID)
                                  formStates.delete(input.formID)
                                }}
                                onCancel={async (input) => {
                                  await props.onFormCancel(input)
                                  settledForms.add(input.formID)
                                  formStates.delete(input.formID)
                                }}
                                mono={props.mono}
                              />
                            )}
                          </For>
                        </Match>
                      </Switch>
                    </box>
                  </box>
                </box>
              )}
            </For>

            <Show when={!panel() && menu()}>
              <RunFooterMenu
                theme={theme}
                items={composer.options}
                selected={composer.selected}
                offset={composer.offset}
                rows={composer.rows}
                limit={FOOTER_MENU_ROWS}
                border={false}
                paddingLeft={0}
                mono={props.mono}
              />
            </Show>

            <Show when={!panel() && !menu()}>
              <box
                width="100%"
                height={1}
                flexDirection="row"
                gap={0}
                flexShrink={0}
                backgroundColor={statuslineBackground()}
              >
                <Show when={visibleModeLabel()}>
                  {(label) => (
                    <box
                      paddingLeft={props.mono ? 0 : 1}
                      paddingRight={1}
                      backgroundColor={theme().statusAccent}
                      flexShrink={0}
                    >
                      <text wrapMode="none" truncate>
                        <span style={{ fg: modeColor(), bold: true }}>{label()}</span>
                      </text>
                    </box>
                  )}
                </Show>

                <box
                  flexDirection="row"
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={0}
                  paddingLeft={statuslineMainAvailable() >= 2 && !props.mono ? 1 : 0}
                  paddingRight={statuslineMainAvailable() >= (props.mono ? 1 : 2) ? 1 : 0}
                  backgroundColor="transparent"
                  overflow="hidden"
                >
                  <Show
                    when={
                      footerDetails() &&
                      busy() &&
                      !exiting() &&
                      statuslineMainAvailable() >=
                        (props.mono ? 1 : 2) + stringWidth(spin().frames[0] ?? "") + 1 + stringWidth(statuslineText())
                    }
                  >
                    <box flexShrink={0}>
                      <spinner color={spin().color} frames={spin().frames} interval={40} />
                    </box>
                  </Show>

                  <text fg={statusColor()} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                    <Show when={busy() && !exiting() && (footerDetails() || armed())} fallback={statusText()}>
                      <Show when={interruptLabel()}>
                        {(label) => <span style={{ fg: armed() ? statusColor() : theme().muted }}>{label()} </span>}
                      </Show>
                      {statusText()}
                    </Show>
                  </text>
                </box>

                <Show when={statuslineLayout().showUsage && activityMeta()}>
                  {(usage) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().muted} wrapMode="none">
                        {usage()}
                      </text>
                    </box>
                  )}
                </Show>

                <Show when={statuslineLayout().showAgent && agentStatus()}>
                  {(agent) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        <Show when={statuslineLayout().showUsage}>{sectionSeparator()}</Show>
                        {agent()}
                      </text>
                    </box>
                  )}
                </Show>

                <Show when={statuslineLayout().showModel && modelStatus()}>
                  {(info) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        <Show when={statuslineLayout().showUsage || statuslineLayout().showAgent}>
                          {sectionSeparator()}
                        </Show>
                        {info().model}
                        <Show when={statuslineLayout().showVariant && info().variant}>
                          {(variant) => <span style={{ fg: theme().warning, bold: true }}> {variant()}</span>}
                        </Show>
                      </text>
                    </box>
                  )}
                </Show>

                <For each={contextHints()}>
                  {(hint, index) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        <Show when={index() > 0 || (hasStatuslineInfo() && index() === 0)}>{sectionSeparator()}</Show>
                        <span style={{ fg: theme().text }}>{hint.key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint.label}</span>
                      </text>
                    </box>
                  )}
                </For>
                <Show when={commandHint()}>
                  {(hint) => (
                    <box backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        <Show when={hasStatuslineInfo() || contextHints().length > 0}>{sectionSeparator()}</Show>
                        <span style={{ fg: theme().text }}>{hint().key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint().label}</span>
                      </text>
                    </box>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        }
      >
        <box
          width="100%"
          flexGrow={1}
          flexShrink={1}
          border={["left"]}
          borderColor={theme().highlight}
          customBorderChars={{
            ...EMPTY_BORDER,
            vertical: props.mono ? "|" : "┃",
          }}
        >
          <RunFooterSubagentBody
            active={inspecting}
            theme={runTheme}
            tab={selectedTab}
            index={selectedIndex}
            total={() => tabs().length}
            detail={detail}
            onCycle={cycleTab}
            onClose={closeTab}
            interrupt={() => subagentInterruptShortcut() || undefined}
            shellOutput={() => props.miniSettings().shell_output === "show"}
            mono={props.mono}
          />
        </box>
      </Show>
    </box>
  )
}
