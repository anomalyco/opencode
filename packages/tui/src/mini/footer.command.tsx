/** @jsxImportSource @opentui/solid */
import { TextAttributes, type InputRenderable, type KeyEvent } from "@opentui/core"
import { useKeyboard, type JSX } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { RunFooterMenu, createFooterMenuState, type RunFooterMenuItem } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type {
  FooterQueuedPrompt,
  FooterSubagentTab,
  MiniSettingChange,
  MiniSettings,
  RunCommand,
  RunInput,
  RunProvider,
} from "./types"

type PanelEntry = RunFooterMenuItem & {
  category: string
  keywords?: string
}

type CommandEntry =
  | (PanelEntry & { action: "model" })
  | (PanelEntry & { action: "editor" })
  | (PanelEntry & { action: "skill" })
  | (PanelEntry & { action: "queued" })
  | (PanelEntry & { action: "subagent" })
  | (PanelEntry & { action: "status" })
  | (PanelEntry & { action: "variant.cycle" })
  | (PanelEntry & { action: "variant.list" })
  | (PanelEntry & { action: "settings" })
  | (PanelEntry & { action: "slash"; name: string })
  | (PanelEntry & { action: "exit" })

type ModelEntry = PanelEntry & {
  providerID: string
  modelID: string
  providerName: string
  current: boolean
}

type VariantEntry = PanelEntry & {
  variant: string | undefined
  current: boolean
}

type SkillEntry = PanelEntry & {
  name: string
}

type SubagentEntry = PanelEntry & {
  sessionID: string
  current: boolean
}

type QueuedEntry = PanelEntry & {
  prompt: FooterQueuedPrompt
}

type SettingEntry = PanelEntry & {
  key: keyof MiniSettings
}

const PANEL_PAD = 2
const panelPad = (mono?: boolean) => (mono ? 1 : PANEL_PAD)
const PANEL_LIST_ROWS = 10
const PANEL_FRAME_ROWS = 6
export const RUN_COMMAND_PANEL_ROWS = PANEL_LIST_ROWS + PANEL_FRAME_ROWS
const SUBAGENT_LIST_ROWS = 12
export const RUN_SUBAGENT_PANEL_ROWS = SUBAGENT_LIST_ROWS + PANEL_FRAME_ROWS
const PANEL_PAGE = PANEL_LIST_ROWS - 1
const HALF_BLOCK_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: "▀",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

function countLabel(count: number, total: number, query: string) {
  if (!query.trim()) {
    return `${total}`
  }

  return `${count}/${total}`
}

function categoryRank(category: string) {
  if (category === "Project Commands") {
    return 0
  }

  if (category === "MCP Commands") {
    return 1
  }

  return 2
}

function subagentStatusLabel(status: FooterSubagentTab["status"]) {
  if (status === "completed") {
    return "done"
  }

  if (status === "cancelled") {
    return "cancelled"
  }

  if (status === "error") {
    return "error"
  }

  return "running"
}

function match<T extends PanelEntry>(query: string, entries: T[]) {
  const text = query.trim()
  if (!text) {
    return entries
  }

  return fuzzysort
    .go(text, entries, { keys: ["display", "category", "description", "keywords"] })
    .map((item) => item.obj)
}

function createSearchablePanelController<T extends PanelEntry>(input: {
  entries: Accessor<T[]>
  limit: number
  onClose: () => void
  onSelect: (item: T) => void
  isCurrent?: (item: T) => boolean
  closeOnFirstUp?: boolean
  onKey?: (event: KeyEvent, item: T | undefined) => boolean
  onRows?: (rows: number) => void
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
  const items = createMemo<T[]>(() => match(query(), input.entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: input.limit })
  const selected = () => items()[menu.selected()]

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    if (!input.isCurrent || query().trim()) {
      return
    }

    const index = items().findIndex(input.isCurrent)
    if (index !== -1) {
      menu.reveal(index)
    }
  })

  createEffect(() => {
    input.onRows?.(menu.rows() + PANEL_FRAME_ROWS)
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    if (input.onKey?.(event, selected())) {
      return
    }

    const name = event.name.toLowerCase()
    if (input.closeOnFirstUp && name === "up" && menu.selected() === 0) {
      event.preventDefault()
      input.onClose()
      return
    }

    const ctrl = event.ctrl && !event.meta && !event.shift && !event.super
    if (name === "escape" || (ctrl && name === "c")) {
      event.preventDefault()
      input.onClose()
      return
    }

    if (name === "up" || (ctrl && name === "p")) {
      event.preventDefault()
      menu.move(-1)
      return
    }

    if (name === "down" || (ctrl && name === "n")) {
      event.preventDefault()
      menu.move(1)
      return
    }

    if (name === "pageup") {
      event.preventDefault()
      menu.reveal(menu.selected() - PANEL_PAGE)
      return
    }

    if (name === "pagedown") {
      event.preventDefault()
      menu.reveal(menu.selected() + PANEL_PAGE)
      return
    }

    if (name === "home") {
      event.preventDefault()
      menu.reveal(0)
      return
    }

    if (name === "end") {
      event.preventDefault()
      menu.reveal(Number.POSITIVE_INFINITY)
      return
    }

    if (name === "return") {
      event.preventDefault()
      const item = selected()
      if (item) {
        input.onSelect(item)
      }
      return
    }

    if (ctrl && name === "u") {
      event.preventDefault()
      setQuery("")
      field?.setText("")
    }
  })

  return {
    query,
    setQuery,
    items,
    menu,
    inputRef(input: InputRenderable) {
      field = input
    },
  }
}

function PanelShell(props: {
  title: string
  countVisible?: boolean
  query: string
  count: number
  total: number
  placeholder: string
  theme: Accessor<RunFooterTheme>
  inputRef: (input: InputRenderable) => void
  onQuery: (query: string) => void
  children: JSX.Element
  hint?: string
  mono?: boolean
}) {
  const background = () => props.theme().shade
  const content = (
    <>
      <box height={1} flexShrink={0} backgroundColor={background()} />
      <box
        width="100%"
        height={1}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        flexDirection="row"
        gap={1}
        flexShrink={0}
        backgroundColor={background()}
      >
        <text fg={props.theme().text} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
          {props.title}
        </text>
        {props.countVisible !== false ? (
          <text fg={props.theme().muted} wrapMode="none" flexShrink={0}>
            {countLabel(props.count, props.total, props.query)}
          </text>
        ) : null}
        <box flexGrow={1} flexShrink={1} backgroundColor="transparent" />
        <text fg={props.theme().muted} wrapMode="none" truncate flexShrink={0}>
          {props.hint ? `${props.hint} ${props.mono ? "-" : "·"} ` : ""}esc
        </text>
      </box>
      <box height={1} flexShrink={0} backgroundColor={background()} />
      <box
        width="100%"
        height={1}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        flexShrink={0}
        backgroundColor={background()}
      >
        <input
          width="100%"
          focusedBackgroundColor={background()}
          focusedTextColor={props.theme().text}
          placeholder={props.placeholder}
          placeholderColor={props.theme().muted}
          cursorColor={props.theme().highlight}
          onInput={props.onQuery}
          ref={(input) => {
            props.inputRef(input)
            input.traits = { status: "FILTER" }
            queueMicrotask(() => {
              if (!input.isDestroyed) {
                input.focus()
              }
            })
          }}
        />
      </box>
      <box height={1} flexShrink={0} backgroundColor={background()} />
      <box width="100%" flexDirection="column" flexShrink={0} backgroundColor={background()}>
        {props.children}
      </box>
    </>
  )
  return (
    <box width="100%" flexDirection="column" border={false} backgroundColor="transparent" flexShrink={0}>
      <box width="100%" flexDirection="column" border={false} backgroundColor="transparent" flexShrink={0}>
        {content}
      </box>
      <box width="100%" height={1} border={false} backgroundColor="transparent" flexShrink={0}>
        {props.mono ? null : (
          <box
            width="100%"
            height={1}
            border={["bottom"]}
            borderColor={background()}
            backgroundColor="transparent"
            customBorderChars={HALF_BLOCK_BORDER}
          />
        )}
      </box>
    </box>
  )
}

export function RunCommandMenuBody(props: {
  theme: Accessor<RunFooterTheme>
  commands: Accessor<RunCommand[] | undefined>
  subagents: Accessor<FooterSubagentTab[]>
  queued: Accessor<FooterQueuedPrompt[]>
  variants: Accessor<string[]>
  variantCycle: string
  onClose: () => void
  onModel: () => void
  onEditor: () => void
  onSkill: () => void
  onSubagent: () => void
  onQueued: () => void
  onVariant: () => void
  onVariantCycle: () => void
  onStatus: () => void
  onSettings: () => void
  onCommand: (name: string) => void
  onNew: () => void
  onExit: () => void
  mono?: boolean
}) {
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  const activeSubagentCount = createMemo(() => props.subagents().filter((item) => item.status === "running").length)
  const entries = createMemo<CommandEntry[]>(() => {
    const builtins = ["editor", "new", "settings"]
    const session: CommandEntry[] = [
      {
        action: "editor",
        category: "Session",
        display: "Open editor",
        footer: "/editor",
        keywords: "editor compose draft external editor",
      },
      {
        action: "status",
        category: "Session",
        display: "Show status",
        keywords: "status activity model context usage footer",
      },
      ...(props.subagents().length > 0
        ? [
          {
            action: "subagent" as const,
            category: "Session",
            display: "View subagents",
            footer:
              activeSubagentCount() > 0 ? `${activeSubagentCount()} active` : `${props.subagents().length} recent`,
            keywords: props
              .subagents()
              .map((item) => `${item.label} ${item.description} ${item.title ?? ""}`)
              .join(" "),
          },
        ]
        : []),
      {
        action: "slash",
        category: "Session",
        name: "new",
        display: "New session",
        footer: "/new",
        keywords: "new session clear",
      },
    ]
    const prompt: CommandEntry[] =
      props.commands() === undefined || skills().length > 0
        ? [
          {
            action: "skill" as const,
            category: "Prompt",
            display: "Skills",
            footer: "/skills",
            keywords: `skill skills ${skills()
              .map((item) => `${item.name} ${item.description ?? ""}`)
              .join(" ")}`.trim(),
          },
        ]
        : []
    const agent: CommandEntry[] = [
      {
        action: "model",
        category: "Agent",
        display: "Switch model",
      },
      ...(props.queued().length > 0
        ? [
          {
            action: "queued" as const,
            category: "Agent",
            display: "View pending work",
            footer: `${props.queued().length} pending`,
            keywords: props
              .queued()
              .map((item) => item.prompt.text)
              .join(" "),
          },
        ]
        : []),
      {
        action: "variant.cycle",
        category: "Agent",
        display: "Variant cycle",
        footer: props.variantCycle,
        keywords: "variant cycle",
      },
      ...(props.variants().length > 0
        ? [
          {
            action: "variant.list" as const,
            category: "Agent",
            display: "Switch model variant",
            keywords: `variant variants ${props.variants().join(" ")}`,
          },
        ]
        : []),
    ]
    const commands = (props.commands() ?? [])
      .filter((item) => item.source !== "skill" && !builtins.includes(item.name))
      .map(
        (item) =>
          ({
            action: "slash",
            category: item.source === "mcp" ? "MCP Commands" : "Project Commands",
            name: item.name,
            display: item.name,
            footer: `/${item.name}`,
            keywords:
              item.source === "mcp"
                ? `/${item.name} ${item.name} mcp ${item.description ?? ""}`
                : `/${item.name} ${item.name} ${item.description ?? ""}`,
          }) satisfies CommandEntry,
      )
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.display.localeCompare(b.display))

    return [
      ...session,
      ...prompt,
      ...agent,
      ...commands,
      {
        action: "settings",
        category: "System",
        display: "Settings",
        footer: "/settings",
        keywords: "/settings settings preferences configuration",
      },
      { action: "exit", category: "System", display: "Exit", footer: "/exit", keywords: "/exit exit" },
    ]
  })
  const pick = (item: CommandEntry) => {
    if (item.action === "model") {
      props.onModel()
      return
    }

    if (item.action === "editor") {
      props.onEditor()
      return
    }

    if (item.action === "skill") {
      props.onSkill()
      return
    }

    if (item.action === "subagent") {
      props.onSubagent()
      return
    }

    if (item.action === "queued") {
      props.onQueued()
      return
    }

    if (item.action === "variant.cycle") {
      props.onVariantCycle()
      return
    }

    if (item.action === "variant.list") {
      props.onVariant()
      return
    }

    if (item.action === "status") {
      props.onStatus()
      return
    }

    if (item.action === "settings") {
      props.onSettings()
      return
    }

    if (item.action === "exit") {
      props.onExit()
      return
    }

    if (item.name === "new") {
      props.onNew()
      return
    }

    props.onCommand(item.name)
  }
  const controller = createSearchablePanelController({
    entries,
    limit: PANEL_LIST_ROWS,
    onClose: props.onClose,
    onSelect: pick,
  })

  return (
    <PanelShell
      title="Commands"
      countVisible={false}
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty="No results found"
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={!controller.query().trim()}
        background
        headerColor={props.theme().muted}
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunSettingsBody(props: {
  theme: Accessor<RunFooterTheme>
  settings: Accessor<MiniSettings>
  onClose: () => void
  onChange: (change: MiniSettingChange) => void | Promise<void>
  mono?: boolean
}) {
  const [saving, setSaving] = createSignal<keyof MiniSettings>()
  const entries = createMemo<SettingEntry[]>(() => [
    {
      category: "Transcript",
      display: "Thinking",
      footer: saving() === "thinking" ? "saving" : props.settings().thinking,
      keywords: `thinking reasoning ${props.settings().thinking}`,
      key: "thinking",
    },
    {
      category: "Transcript",
      display: "Shell",
      footer: saving() === "shell_output" ? "saving" : props.settings().shell_output,
      keywords: `shell tool command output ${props.settings().shell_output}`,
      key: "shell_output",
    },
    {
      category: "Transcript",
      display: "Turn summary",
      footer: saving() === "turn_summary" ? "saving" : props.settings().turn_summary,
      keywords: `turn summary agent model duration ${props.settings().turn_summary}`,
      key: "turn_summary",
    },
    {
      category: "Terminal",
      display: "Footer details",
      footer: saving() === "footer" ? "saving" : props.settings().footer,
      keywords: `footer status activity model context usage ${props.settings().footer}`,
      key: "footer",
    },
    {
      category: "Terminal",
      display: "Monochrome UI",
      footer: saving() === "mono" ? "saving" : props.settings().mono ? "on" : "off",
      keywords: `mono monochrome ascii legacy compat terminal ${props.settings().mono ? "on" : "off"}`,
      key: "mono",
    },
  ])
  const change = (item: SettingEntry) => {
    if (saving()) return
    const next: MiniSettingChange =
      item.key === "mono"
        ? { key: "mono", value: !props.settings().mono }
        : { key: item.key, value: props.settings()[item.key] === "show" ? "hide" : "show" }
    setSaving(item.key)
    void Promise.resolve(props.onChange(next))
      .catch(() => { })
      .finally(() => setSaving())
  }
  const controller = createSearchablePanelController({
    entries,
    limit: PANEL_LIST_ROWS,
    onClose: props.onClose,
    onSelect: change,
    onKey(event, item) {
      const name = event.name.toLowerCase()
      if (name !== "left" && name !== "right") return false
      event.preventDefault()
      if (item) change(item)
      return true
    },
  })

  return (
    <PanelShell
      title="Settings"
      countVisible={false}
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      hint="left/right change"
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty="No settings found"
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={!controller.query().trim()}
        background
        headerColor={props.theme().muted}
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunSubagentSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  tabs: Accessor<FooterSubagentTab[]>
  current: Accessor<string | undefined>
  onClose: () => void
  onSelect: (sessionID: string) => void
  onRows?: (rows: number) => void
  mono?: boolean
}) {
  const entries = createMemo<SubagentEntry[]>(() =>
    props.tabs().map((item) => {
      const title = item.description || item.title || item.label
      return {
        category: "",
        display: title,
        description: title === item.label ? undefined : item.label,
        footer: subagentStatusLabel(item.status),
        keywords: `${item.label} ${item.description} ${item.title ?? ""} ${item.status}`,
        sessionID: item.sessionID,
        current: props.current() === item.sessionID,
      }
    }),
  )
  const controller = createSearchablePanelController({
    entries,
    limit: SUBAGENT_LIST_ROWS,
    onClose: props.onClose,
    onSelect: (item) => props.onSelect(item.sessionID),
    isCurrent: (item) => item.current,
    closeOnFirstUp: true,
    onRows: props.onRows,
  })

  return (
    <PanelShell
      title="Select subagent"
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={controller.menu.rows}
        limit={SUBAGENT_LIST_ROWS}
        empty="No subagents found"
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={false}
        background
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunQueuedPromptSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  prompts: Accessor<FooterQueuedPrompt[]>
  onClose: () => void
  onRows?: (rows: number) => void
  mono?: boolean
}) {
  const entries = createMemo<QueuedEntry[]>(() =>
    props.prompts().map((prompt) => ({
      category: "",
      display: prompt.prompt.text.replaceAll("\n", " "),
      footer: prompt.delivery,
      keywords: prompt.prompt.text,
      prompt,
    })),
  )
  const controller = createSearchablePanelController({
    entries,
    limit: SUBAGENT_LIST_ROWS,
    onClose: props.onClose,
    onSelect: props.onClose,
    onRows: props.onRows,
  })

  return (
    <PanelShell
      title="Pending work"
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={controller.menu.rows}
        limit={SUBAGENT_LIST_ROWS}
        empty="No pending work"
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={false}
        background
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunSkillSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  commands: Accessor<RunCommand[] | undefined>
  onClose: () => void
  onSelect: (name: string) => void
  mono?: boolean
}) {
  const entries = createMemo<SkillEntry[]>(() =>
    (props.commands() ?? [])
      .filter((item) => item.source === "skill")
      .map((item) => ({
        category: "",
        display: item.name,
        description: item.description?.replace(/\s+/g, " ").trim() || undefined,
        keywords: `skill ${item.name} ${item.description ?? ""}`,
        name: item.name,
      }))
      .sort((a, b) => a.display.localeCompare(b.display)),
  )
  const controller = createSearchablePanelController({
    entries,
    limit: PANEL_LIST_ROWS,
    onClose: props.onClose,
    onSelect: (item) => props.onSelect(item.name),
  })

  return (
    <PanelShell
      title="Skills"
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty={props.commands() ? "No skills found" : "Skills loading"}
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={false}
        background
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunVariantSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  variants: Accessor<string[]>
  current: Accessor<string | undefined>
  onClose: () => void
  onSelect: (variant: string | undefined) => void
  mono?: boolean
}) {
  const entries = createMemo<VariantEntry[]>(() => [
    {
      category: "",
      display: "Default",
      description: props.current() === undefined ? "current" : undefined,
      keywords: "default",
      variant: undefined,
      current: props.current() === undefined,
    },
    ...props.variants().map((variant) => ({
      category: "",
      display: variant,
      description: props.current() === variant ? "current" : undefined,
      keywords: variant,
      variant,
      current: props.current() === variant,
    })),
  ])
  const controller = createSearchablePanelController({
    entries,
    limit: PANEL_LIST_ROWS,
    onClose: props.onClose,
    onSelect: (item) => props.onSelect(item.variant),
    isCurrent: (item) => item.current,
  })

  return (
    <PanelShell
      title="Select variant"
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty="No results found"
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={false}
        background
        mono={props.mono}
      />
    </PanelShell>
  )
}

export function RunModelSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  providers: Accessor<RunProvider[] | undefined>
  current: Accessor<RunInput["model"]>
  onClose: () => void
  onSelect: (model: NonNullable<RunInput["model"]>) => void
  mono?: boolean
}) {
  const entries = createMemo<ModelEntry[]>(() =>
    (props.providers() ?? [])
      .flatMap((provider) =>
        Object.entries(provider.models)
          .filter(([, model]) => model.status !== "deprecated")
          .map(([modelID, model]) => {
            const title = model.name ?? modelID
            const current = props.current()?.providerID === provider.id && props.current()?.modelID === modelID
            const footer = current
              ? "current"
              : model.cost?.input === 0 && provider.id === "opencode"
                ? "Free"
                : title !== modelID
                  ? modelID
                  : undefined
            return {
              providerID: provider.id,
              modelID,
              providerName: provider.name,
              category: provider.name,
              display: title,
              footer,
              keywords: `${provider.id} ${provider.name} ${modelID} ${title} ${footer ?? ""}`,
              current,
            }
          }),
      )
      .sort((a, b) => {
        const provider = Number(a.providerID !== "opencode") - Number(b.providerID !== "opencode")
        if (provider !== 0) {
          return provider
        }

        const name = a.providerName.localeCompare(b.providerName)
        if (name !== 0) {
          return name
        }

        return a.display.localeCompare(b.display)
      }),
  )
  const controller = createSearchablePanelController({
    entries,
    limit: PANEL_LIST_ROWS,
    onClose: props.onClose,
    onSelect: (item) => props.onSelect({ providerID: item.providerID, modelID: item.modelID }),
    isCurrent: (item) => item.current,
  })

  return (
    <PanelShell
      title="Select model"
      query={controller.query()}
      count={controller.items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={controller.inputRef}
      onQuery={controller.setQuery}
      mono={props.mono}
    >
      <RunFooterMenu
        theme={props.theme}
        items={controller.items}
        selected={controller.menu.selected}
        offset={controller.menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty={props.providers() ? "No results found" : "Models loading"}
        border={false}
        paddingLeft={panelPad(props.mono)}
        paddingRight={panelPad(props.mono)}
        grouped={!controller.query().trim()}
        background
        headerColor={props.theme().muted}
        mono={props.mono}
      />
    </PanelShell>
  )
}
