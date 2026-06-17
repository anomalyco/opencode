/** @jsxImportSource @opentui/solid */
import { TextAttributes, type InputRenderable, type KeyEvent } from "@opentui/core"
import { useKeyboard, type JSX } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { RunFooterMenu, createFooterMenuState, type RunFooterMenuItem } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type { FooterQueuedPrompt, FooterSubagentTab, RunCommand, RunInput, RunProvider } from "./types"

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
  | (PanelEntry & { action: "variant.cycle" })
  | (PanelEntry & { action: "variant.list" })
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

type MenuState = ReturnType<typeof createFooterMenuState>

const PANEL_PAD = 2
const PANEL_LIST_ROWS = 10
const PANEL_FRAME_ROWS = 6
export const RUN_COMMAND_PANEL_ROWS = PANEL_LIST_ROWS + PANEL_FRAME_ROWS
const SUBAGENT_LIST_ROWS = 12
export const RUN_SUBAGENT_PANEL_ROWS = SUBAGENT_LIST_ROWS + PANEL_FRAME_ROWS
const PANEL_PAGE = PANEL_LIST_ROWS - 1
const PANEL_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "┃",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}
const PANEL_BOTTOM_BORDER = {
  ...PANEL_BORDER,
  vertical: "╹",
}
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

function handleKey(input: {
  event: KeyEvent
  menu: MenuState
  field: () => InputRenderable | undefined
  setQuery: (value: string) => void
  select: () => void
  close: () => void
}) {
  const name = input.event.name.toLowerCase()
  const ctrl = input.event.ctrl && !input.event.meta && !input.event.shift && !input.event.super

  if (name === "escape" || (ctrl && name === "c")) {
    input.event.preventDefault()
    input.close()
    return
  }

  if (name === "up" || (ctrl && name === "p")) {
    input.event.preventDefault()
    input.menu.move(-1)
    return
  }

  if (name === "down" || (ctrl && name === "n")) {
    input.event.preventDefault()
    input.menu.move(1)
    return
  }

  if (name === "pageup") {
    input.event.preventDefault()
    input.menu.reveal(input.menu.selected() - PANEL_PAGE)
    return
  }

  if (name === "pagedown") {
    input.event.preventDefault()
    input.menu.reveal(input.menu.selected() + PANEL_PAGE)
    return
  }

  if (name === "home") {
    input.event.preventDefault()
    input.menu.reveal(0)
    return
  }

  if (name === "end") {
    input.event.preventDefault()
    input.menu.reveal(Number.POSITIVE_INFINITY)
    return
  }

  if (name === "return") {
    input.event.preventDefault()
    input.select()
    return
  }

  if (ctrl && name === "u") {
    input.event.preventDefault()
    input.setQuery("")
    input.field()?.setText("")
  }
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
  dark?: boolean
  chrome?: "default" | "minimal"
}) {
  const background = () => (props.dark ? props.theme().shade : props.theme().surface)
  const minimal = () => props.chrome === "minimal"
  const content = (
    <>
      <box height={1} flexShrink={0} backgroundColor={background()} />
      <box
        width="100%"
        height={1}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
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
          esc
        </text>
      </box>
      <box height={1} flexShrink={0} backgroundColor={background()} />
      <box
        width="100%"
        height={1}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
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
      {minimal() ? (
        <box width="100%" flexDirection="column" border={false} backgroundColor="transparent" flexShrink={0}>
          {content}
        </box>
      ) : (
        <box
          width="100%"
          flexDirection="column"
          border={["left"]}
          borderColor={props.theme().highlight}
          backgroundColor="transparent"
          customBorderChars={PANEL_BORDER}
          flexShrink={0}
        >
          {content}
        </box>
      )}
      {minimal() ? (
        <box width="100%" height={1} border={false} backgroundColor="transparent" flexShrink={0}>
          <box
            width="100%"
            height={1}
            border={["bottom"]}
            borderColor={background()}
            backgroundColor="transparent"
            customBorderChars={HALF_BLOCK_BORDER}
          />
        </box>
      ) : (
        <box
          width="100%"
          height={1}
          border={["left"]}
          borderColor={props.theme().highlight}
          backgroundColor="transparent"
          customBorderChars={PANEL_BOTTOM_BORDER}
          flexShrink={0}
        >
          <box
            width="100%"
            height={1}
            border={["bottom"]}
            borderColor={background()}
            backgroundColor="transparent"
            customBorderChars={HALF_BLOCK_BORDER}
          />
        </box>
      )}
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
  onCommand: (name: string) => void
  onNew: () => void
  onExit: () => void
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  const activeSubagentCount = createMemo(() => props.subagents().filter((item) => item.status === "running").length)
  const entries = createMemo<CommandEntry[]>(() => {
    const builtins = ["editor", "new"]
    const session: CommandEntry[] = [
      {
        action: "editor",
        category: "Session",
        display: "Open editor",
        footer: "/editor",
        keywords: "editor compose draft external editor",
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
              display: "Manage queued prompts",
              footer: `${props.queued().length} queued`,
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
      { action: "exit", category: "System", display: "Exit", footer: "/exit", keywords: "/exit exit" },
    ]
  })
  const items = createMemo<CommandEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: PANEL_LIST_ROWS })
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
  const select = () => {
    const item = items()[menu.selected()]
    if (!item) {
      return
    }

    pick(item)
  }

  createEffect(() => {
    query()
    menu.reset()
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    handleKey({ event, menu, field: () => field, setQuery, select, close: props.onClose })
  })

  return (
    <PanelShell
      title="Commands"
      countVisible={false}
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty="No results found"
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={!query().trim()}
        background
        headerColor={props.theme().muted}
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
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
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
  const items = createMemo<SubagentEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: SUBAGENT_LIST_ROWS })
  const select = () => {
    const item = items()[menu.selected()]
    if (!item) {
      return
    }

    props.onSelect(item.sessionID)
  }

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    if (query().trim()) {
      return
    }

    const index = items().findIndex((item) => item.current)
    if (index !== -1) {
      menu.reveal(index)
    }
  })

  createEffect(() => {
    props.onRows?.(menu.rows() + PANEL_FRAME_ROWS)
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    handleKey({ event, menu, field: () => field, setQuery, select, close: props.onClose })
  })

  return (
    <PanelShell
      title="Select subagent"
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={menu.rows}
        limit={SUBAGENT_LIST_ROWS}
        empty="No subagents found"
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={false}
        background
      />
    </PanelShell>
  )
}

export function RunQueuedPromptSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  prompts: Accessor<FooterQueuedPrompt[]>
  onClose: () => void
  onEdit: (prompt: FooterQueuedPrompt) => void | Promise<void>
  onDelete: (prompt: FooterQueuedPrompt) => void | Promise<void>
  onRows?: (rows: number) => void
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
  const entries = createMemo<QueuedEntry[]>(() =>
    props.prompts().map((prompt) => ({
      category: "",
      display: prompt.prompt.text.replaceAll("\n", " "),
      footer: "queued · ctrl+e edit · ctrl+d remove",
      keywords: prompt.prompt.text,
      prompt,
    })),
  )
  const items = createMemo<QueuedEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: SUBAGENT_LIST_ROWS })
  const selected = () => items()[menu.selected()]

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    props.onRows?.(menu.rows() + PANEL_FRAME_ROWS)
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    const item = selected()
    const ctrl = event.ctrl && !event.meta && !event.shift && !event.super
    if (item && (event.name === "delete" || (ctrl && event.name === "d"))) {
      event.preventDefault()
      props.onDelete(item.prompt)
      return
    }

    if (item && ctrl && event.name === "e") {
      event.preventDefault()
      props.onEdit(item.prompt)
      return
    }

    handleKey({
      event,
      menu,
      field: () => field,
      setQuery,
      select: () => {
        const item = selected()
        if (item) props.onEdit(item.prompt)
      },
      close: props.onClose,
    })
  })

  return (
    <PanelShell
      title="Queued prompts"
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={menu.rows}
        limit={SUBAGENT_LIST_ROWS}
        empty="No queued prompts"
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={false}
        background
      />
    </PanelShell>
  )
}

export function RunSkillSelectBody(props: {
  theme: Accessor<RunFooterTheme>
  commands: Accessor<RunCommand[] | undefined>
  onClose: () => void
  onSelect: (name: string) => void
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
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
  const items = createMemo<SkillEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: PANEL_LIST_ROWS })
  const select = () => {
    const item = items()[menu.selected()]
    if (!item) {
      return
    }

    props.onSelect(item.name)
  }

  createEffect(() => {
    query()
    menu.reset()
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    handleKey({ event, menu, field: () => field, setQuery, select, close: props.onClose })
  })

  return (
    <PanelShell
      title="Skills"
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty={props.commands() ? "No skills found" : "Skills loading"}
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={false}
        background
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
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
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
  const items = createMemo<VariantEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: PANEL_LIST_ROWS })
  const pick = (item: VariantEntry) => {
    props.onSelect(item.variant)
  }
  const select = () => {
    const item = items()[menu.selected()]
    if (!item) {
      return
    }

    pick(item)
  }

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    if (query().trim()) {
      return
    }

    const index = items().findIndex((item) => item.current)
    if (index !== -1) {
      menu.reveal(index)
    }
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    handleKey({ event, menu, field: () => field, setQuery, select, close: props.onClose })
  })

  return (
    <PanelShell
      title="Select variant"
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty="No results found"
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={false}
        background
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
}) {
  let field: InputRenderable | undefined
  const [query, setQuery] = createSignal("")
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
  const items = createMemo<ModelEntry[]>(() => match(query(), entries()))
  const menu = createFooterMenuState({ count: () => items().length, limit: PANEL_LIST_ROWS })
  const pick = (item: ModelEntry) => {
    props.onSelect({ providerID: item.providerID, modelID: item.modelID })
  }
  const select = () => {
    const item = items()[menu.selected()]
    if (!item) {
      return
    }

    pick(item)
  }

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    if (query().trim()) {
      return
    }

    const index = items().findIndex((item) => item.current)
    if (index !== -1) {
      menu.reveal(index)
    }
  })

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      return
    }

    handleKey({ event, menu, field: () => field, setQuery, select, close: props.onClose })
  })

  return (
    <PanelShell
      title="Select model"
      query={query()}
      count={items().length}
      total={entries().length}
      placeholder="Search"
      theme={props.theme}
      inputRef={(input) => {
        field = input
      }}
      onQuery={setQuery}
      dark
      chrome="minimal"
    >
      <RunFooterMenu
        theme={props.theme}
        items={items}
        selected={menu.selected}
        offset={menu.offset}
        rows={() => PANEL_LIST_ROWS}
        limit={PANEL_LIST_ROWS}
        empty={props.providers() ? "No results found" : "Models loading"}
        border={false}
        paddingLeft={PANEL_PAD}
        paddingRight={PANEL_PAD}
        grouped={!query().trim()}
        background
        headerColor={props.theme().muted}
      />
    </PanelShell>
  )
}
