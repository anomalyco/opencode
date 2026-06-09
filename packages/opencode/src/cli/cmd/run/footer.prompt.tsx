// Prompt composer and its state machine for direct interactive mode.
//
// createPromptState() wires keymap command layers, history navigation, and
// `@` autocomplete for files, subagents, and MCP resources.
// It produces a PromptState that RunPromptBody renders as a slim single-line
// composer while the footer view renders any active menus below it.
/** @jsxImportSource @opentui/solid */
import { pathToFileURL } from "bun"
import { StyledText, fg, type ColorInput, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { normalizePromptContent } from "@opencode-ai/tui/editor"
import fuzzysort from "fuzzysort"
import path from "path"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import * as Locale from "@/util/locale"
import {
  createPromptHistory,
  displayCharAt,
  displaySlice,
  isExitCommand,
  mentionTriggerIndex,
  isNewCommand,
  movePromptHistory,
  pushPromptHistory,
} from "./prompt.shared"
import { OPENCODE_BASE_MODE, useBindings } from "@opencode-ai/tui/keymap"
import { realignEditorPromptParts, resolveEditorSlashValue } from "./prompt.editor"
import { FOOTER_MENU_ROWS, createFooterMenuState, type RunFooterMenuItem } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type { FooterState, RunAgent, RunCommand, RunPrompt, RunPromptPart, RunResource, RunTuiConfig } from "./types"

const AUTOCOMPLETE_ROWS = FOOTER_MENU_ROWS
const AUTOCOMPLETE_BOTTOM_ROWS = 1

export const TEXTAREA_MIN_ROWS = 1
export const TEXTAREA_MAX_ROWS = 6
export const PROMPT_MAX_ROWS = TEXTAREA_MAX_ROWS + AUTOCOMPLETE_ROWS - 1 + AUTOCOMPLETE_BOTTOM_ROWS

type Mention = Extract<RunPromptPart, { type: "file" | "agent" }>

type Auto = RunFooterMenuItem & {
  kind: "mention"
  value: string
  part: Mention
  directory?: boolean
}

type SlashOption = RunFooterMenuItem & {
  kind: "slash"
  name: string
  action?: "skill-menu" | "editor"
}

type PromptOption = Auto | SlashOption

type MenuMode = false | "mention" | "slash"

type PromptInput = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: Accessor<RunAgent[]>
  resources: Accessor<RunResource[]>
  commands: Accessor<RunCommand[] | undefined>
  tuiConfig: RunTuiConfig
  state: Accessor<FooterState>
  view: Accessor<string>
  prompt: Accessor<boolean>
  width: Accessor<number>
  theme: Accessor<RunFooterTheme>
  history?: RunPrompt[]
  onSubmit: (input: RunPrompt) => boolean | Promise<boolean>
  onCycle: () => void
  onInterrupt: () => boolean
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onExit: () => void
  onSkillMenu: () => void
  onRows: (rows: number) => void
  onStatus: (text: string) => void
}

export type PromptState = {
  placeholder: Accessor<StyledText | string>
  shell: Accessor<boolean>
  visible: Accessor<boolean>
  options: Accessor<PromptOption[]>
  selected: Accessor<number>
  offset: Accessor<number>
  rows: Accessor<number>
  requestExit: () => boolean
  onSubmit: () => void
  submitText: (text: string) => void
  openEditor: (input?: { value?: string }) => Promise<void>
  onKeyDown: (event: KeyEvent) => void
  onContentChange: () => void
  replaceDraft: (text: string) => void
  replacePrompt: (prompt: RunPrompt) => void
  bind: (area?: TextareaRenderable) => void
}

function clamp(rows: number): number {
  return Math.max(TEXTAREA_MIN_ROWS, Math.min(TEXTAREA_MAX_ROWS, rows))
}

function clonePrompt(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
    ...(prompt.mode ? { mode: prompt.mode } : {}),
    ...(prompt.command ? { command: prompt.command } : {}),
  }
}

function emptyPrompt(shell: boolean): RunPrompt {
  return shell ? { text: "", parts: [], mode: "shell" } : { text: "", parts: [] }
}

function removeLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  return hash === -1 ? input : input.slice(0, hash)
}

function extractLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  if (hash === -1) {
    return { base: input }
  }

  const base = input.slice(0, hash)
  const line = input.slice(hash + 1)
  const match = line.match(/^(\d+)(?:-(\d*))?$/)
  if (!match) {
    return { base }
  }

  const start = Number(match[1])
  const end = match[2] && start < Number(match[2]) ? Number(match[2]) : undefined
  return { base, line: { start, end } }
}

function slashHead(text: string) {
  if (!text.startsWith("/")) {
    return
  }

  for (let i = 1; i < text.length; i++) {
    switch (text[i]) {
      case " ":
      case "\t":
      case "\n":
        return { name: text.slice(1, i), arguments: text.slice(i + 1), end: i }
    }
  }

  return { name: text.slice(1), arguments: "", end: text.length }
}

function slashQuery(text: string, cursor: number) {
  const head = slashHead(text.slice(0, cursor))
  if (!head || head.end !== cursor) {
    return
  }

  return head.name
}

function parseSlashCommand(text: string, commands: RunCommand[] | undefined) {
  const head = slashHead(text)
  if (!head || head.name.length === 0) {
    return { type: "none" as const }
  }

  if (!commands) {
    return { type: "pending" as const }
  }

  if (!commands.some((item) => item.name === head.name)) {
    return { type: "none" as const }
  }

  return { type: "command" as const, command: { name: head.name, arguments: head.arguments } }
}

function selectedCommand(text: string, command: RunPrompt["command"]) {
  if (!command) {
    return
  }

  const head = slashHead(text)
  if (!head || head.name !== command.name) {
    return
  }

  return {
    name: command.name,
    arguments: head.arguments,
  }
}

export function RunPromptBody(props: {
  theme: () => RunFooterTheme
  background: () => ColorInput
  placeholder: () => StyledText | string
  onSubmit: () => void
  onKeyDown: (event: KeyEvent) => void
  onContentChange: () => void
  bind: (area?: TextareaRenderable) => void
}) {
  const renderer = useRenderer()
  let area: TextareaRenderable | undefined
  let pasteTick: ReturnType<typeof setTimeout> | undefined

  const refreshPasteLayout = () => {
    if (pasteTick) {
      clearTimeout(pasteTick)
    }

    pasteTick = setTimeout(() => {
      pasteTick = undefined
      if (!area || area.isDestroyed) {
        return
      }

      // Paste can leave the textarea layout stale until the next edit.
      area.getLayoutNode().markDirty()
      renderer.requestRender()
      void renderer
        .idle()
        .then(() => {
          if (!area || area.isDestroyed) {
            return
          }

          props.onContentChange()
        })
        .catch(() => {})
    }, 0)
  }

  onMount(() => {
    props.bind(area)
  })

  onCleanup(() => {
    if (pasteTick) {
      clearTimeout(pasteTick)
    }
    props.bind(undefined)
  })

  return (
    <box id="run-direct-footer-prompt" width="100%">
      <box id="run-direct-footer-input-shell" paddingTop={1} paddingBottom={1} paddingRight={2}>
        <textarea
          id="run-direct-footer-composer"
          width="100%"
          minHeight={TEXTAREA_MIN_ROWS}
          maxHeight={TEXTAREA_MAX_ROWS}
          wrapMode="word"
          placeholder={props.placeholder()}
          placeholderColor={props.theme().muted}
          textColor={props.theme().text}
          focusedTextColor={props.theme().text}
          backgroundColor={props.background()}
          focusedBackgroundColor={props.background()}
          cursorColor={props.theme().text}
          onSubmit={props.onSubmit}
          onKeyDown={props.onKeyDown}
          onPaste={() => {
            refreshPasteLayout()
          }}
          onContentChange={props.onContentChange}
          ref={(next) => {
            area = next
          }}
        />
      </box>
    </box>
  )
}

export function createPromptState(input: PromptInput): PromptState {
  const [shell, setShell] = createSignal(false)
  const placeholder = createMemo(() => {
    if (shell()) {
      return new StyledText([fg(input.theme().muted)('Run a command... "git status"')])
    }

    if (!input.state().first) {
      return ""
    }

    return new StyledText([fg(input.theme().muted)('Ask anything... "Fix a TODO in the codebase"')])
  })

  let history = createPromptHistory(input.history)
  let draft: RunPrompt = { text: "", parts: [] }
  let stash: RunPrompt = { text: "", parts: [] }
  let area: TextareaRenderable | undefined
  let tick = false
  let prev = input.view()
  let type = 0
  let parts: Mention[] = []
  let marks = new Map<number, number>()

  const [mode, setMode] = createSignal<MenuMode>(false)
  const [at, setAt] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const visible = createMemo(() => mode() !== false)

  const setShellMode = (value: boolean) => {
    setShell(value)
    draft = value ? { ...draft, mode: "shell" } : { text: draft.text, parts: structuredClone(draft.parts) }
  }

  const width = createMemo(() => Math.max(20, input.width() - 8))
  const agents = createMemo<Auto[]>(() => {
    return input
      .agents()
      .filter((item) => !item.hidden && item.mode !== "primary")
      .map((item) => ({
        kind: "mention",
        display: "@" + item.name,
        value: item.name,
        part: {
          type: "agent",
          name: item.name,
          source: {
            start: 0,
            end: 0,
            value: "",
          },
        },
      }))
  })
  const resources = createMemo<Auto[]>(() => {
    return input.resources().map((item) => ({
      kind: "mention",
      display: Locale.truncateMiddle(`@${item.name} (${item.uri})`, width()),
      value: item.name,
      description: item.description,
      part: {
        type: "file",
        mime: item.mimeType ?? "text/plain",
        filename: item.name,
        url: item.uri,
        source: {
          type: "resource",
          clientName: item.client,
          uri: item.uri,
          text: {
            start: 0,
            end: 0,
            value: "",
          },
        },
      },
    }))
  })
  const [files] = createResource(
    query,
    async (value) => {
      if (!visible() || mode() !== "mention") {
        return []
      }

      const next = extractLineRange(value)
      const list = await input.findFiles(next.base)
      return list.map((item): Auto => {
        const url = pathToFileURL(path.resolve(input.directory, item))
        let filename = item
        if (next.line && !item.endsWith("/")) {
          filename = `${item}#${next.line.start}${next.line.end ? `-${next.line.end}` : ""}`
          url.searchParams.set("start", String(next.line.start))
          if (next.line.end !== undefined) {
            url.searchParams.set("end", String(next.line.end))
          }
        }

        return {
          kind: "mention",
          display: Locale.truncateMiddle("@" + filename, width()),
          value: filename,
          directory: item.endsWith("/"),
          part: {
            type: "file",
            mime: item.endsWith("/") ? "application/x-directory" : "text/plain",
            filename,
            url: url.href,
            source: {
              type: "file",
              path: item,
              text: {
                start: 0,
                end: 0,
                value: "",
              },
            },
          },
        }
      })
    },
    { initialValue: [] as Auto[] },
  )
  const mentionOptions = createMemo(() => [...agents(), ...files(), ...resources()])
  const skillCommands = createMemo(() => (input.commands() ?? []).filter((item) => item.source === "skill"))
  const hasSkillsCommand = createMemo(() =>
    (input.commands() ?? []).some((item) => item.source !== "skill" && item.name === "skills"),
  )
  const slashOptions = createMemo<SlashOption[]>(() => {
    const builtins = [
      {
        kind: "slash",
        action: "editor" as const,
        name: "editor",
        display: "/editor",
        description: "compose in your external editor",
      } satisfies SlashOption,
      { kind: "slash", name: "new", display: "/new", description: "start a new session" } satisfies SlashOption,
      { kind: "slash", name: "exit", display: "/exit", description: "close OpenCode" } satisfies SlashOption,
    ]
    const hidden = new Set(builtins.map((item) => item.name))
    const showSkillMenu = !shell() && skillCommands().length > 0 && !hasSkillsCommand()
    if (showSkillMenu) {
      hidden.add("skills")
    }

    return [
      ...(showSkillMenu
        ? [
            {
              kind: "slash",
              action: "skill-menu" as const,
              name: "skills",
              display: "/skills",
              description: "browse available skills",
            } satisfies SlashOption,
          ]
        : []),
      ...(input.commands() ?? [])
        .filter((item) => item.source !== "skill" && !hidden.has(item.name))
        .map(
          (item) =>
            ({
              kind: "slash",
              name: item.name,
              display: `/${item.name}${item.source === "mcp" ? ":mcp" : ""}`,
              description: item.description,
            }) satisfies SlashOption,
        ),
      ...builtins,
    ].sort((a, b) => a.display.localeCompare(b.display))
  })
  const options = createMemo<PromptOption[]>(() => {
    const mixed: PromptOption[] = mode() === "slash" ? slashOptions() : mentionOptions()
    if (!query()) {
      return mixed
    }

    const next = removeLineRange(query())
    if (mode() === "mention") {
      return [
        ...fuzzysort.go(next, agents(), { keys: ["value", "display", "description"] }).map((item) => item.obj),
        ...files(),
        ...fuzzysort.go(next, resources(), { keys: ["value", "display", "description"] }).map((item) => item.obj),
      ]
    }

    return fuzzysort
      .go(next, mixed, {
        keys: [(item) => (item.kind === "mention" ? item.value : item.name).trimEnd(), "display", "description"],
      })
      .map((item) => item.obj)
  })
  const menu = createFooterMenuState({ count: () => options().length, limit: AUTOCOMPLETE_ROWS })
  const popup = createMemo(() => {
    return visible() ? menu.rows() - 1 + AUTOCOMPLETE_BOTTOM_ROWS : 0
  })

  const hide = () => {
    setMode(false)
    setQuery("")
    menu.reset()
  }

  const syncRows = () => {
    if (!area || area.isDestroyed) {
      return
    }

    input.onRows(clamp(Math.max(area.lineCount, area.virtualLineCount)) + popup())
  }

  const scheduleRows = () => {
    if (tick) {
      return
    }

    tick = true
    queueMicrotask(() => {
      tick = false
      syncRows()
    })
  }

  const syncParts = () => {
    if (!area || area.isDestroyed || type === 0) {
      return
    }

    const next: Mention[] = []
    const map = new Map<number, number>()
    for (const item of area.extmarks.getAllForTypeId(type)) {
      const idx = marks.get(item.id)
      if (idx === undefined) {
        continue
      }

      const part = parts[idx]
      if (!part) {
        continue
      }

      const text = area.plainText.slice(item.start, item.end)
      const prev =
        part.type === "agent"
          ? (part.source?.value ?? "@" + part.name)
          : (part.source?.text.value ?? "@" + (part.filename ?? ""))
      if (text !== prev) {
        continue
      }

      const copy = structuredClone(part)
      if (copy.type === "agent") {
        copy.source = {
          start: item.start,
          end: item.end,
          value: text,
        }
      }
      if (copy.type === "file" && copy.source?.text) {
        copy.source.text.start = item.start
        copy.source.text.end = item.end
        copy.source.text.value = text
      }

      map.set(item.id, next.length)
      next.push(copy)
    }

    const stale = map.size !== marks.size
    parts = next
    marks = map
    if (stale) {
      restoreParts(next)
    }
  }

  const clearParts = () => {
    if (area && !area.isDestroyed) {
      area.extmarks.clear()
    }
    parts = []
    marks = new Map()
  }

  const restoreParts = (value: RunPromptPart[]) => {
    clearParts()
    parts = value
      .filter((item): item is Mention => item.type === "file" || item.type === "agent")
      .map((item) => structuredClone(item))
    if (!area || area.isDestroyed || type === 0) {
      return
    }

    const box = area
    parts.forEach((item, idx) => {
      const start = item.type === "agent" ? item.source?.start : item.source?.text.start
      const end = item.type === "agent" ? item.source?.end : item.source?.text.end
      if (start === undefined || end === undefined) {
        return
      }

      const id = box.extmarks.create({
        start,
        end,
        virtual: true,
        typeId: type,
      })
      marks.set(id, idx)
    })
  }

  const restore = (value: RunPrompt, cursor = Bun.stringWidth(value.text)) => {
    draft = clonePrompt(value)
    setShell(value.mode === "shell")
    if (!area || area.isDestroyed) {
      return
    }

    hide()
    area.setText(value.text)
    restoreParts(value.parts)
    area.cursorOffset = Math.min(cursor, Bun.stringWidth(area.plainText))
    scheduleRows()
    area.focus()
  }

  const resetDraft = () => {
    if (area && !area.isDestroyed) {
      area.setText("")
    }

    clearParts()
    hide()
    draft = emptyPrompt(shell())
    if (!area || area.isDestroyed) {
      return
    }

    scheduleRows()
    area.focus()
  }

  const replaceDraft = (text: string) => {
    draft = shell() ? { text, parts: [], mode: "shell" } : { text, parts: [] }
    if (!area || area.isDestroyed) {
      return
    }

    hide()
    area.setText(text)
    clearParts()
    draft = shell() ? { text: area.plainText, parts: [], mode: "shell" } : { text: area.plainText, parts: [] }
    area.cursorOffset = Math.min(Bun.stringWidth(text), Bun.stringWidth(area.plainText))
    scheduleRows()
    area.focus()
  }

  const refresh = () => {
    if (!area || area.isDestroyed) {
      return
    }

    const cursor = area.cursorOffset
    const text = area.plainText
    const slash = slashQuery(text, cursor)
    if (mode() === "slash") {
      if (slash === undefined) {
        hide()
        return
      }

      setAt(0)
      setQuery(slash)
      return
    }

    if (slash !== undefined) {
      setAt(0)
      menu.reset()
      setMode("slash")
      setQuery(slash)
      return
    }

    if (visible() && mode() === "mention") {
      const query = displaySlice(text, at(), cursor)
      if (cursor <= at() || /\s/.test(query)) {
        hide()
        return
      }

      setQuery(displaySlice(text, at() + 1, cursor))
      return
    }

    if (cursor === 0) {
      return
    }

    const idx = mentionTriggerIndex(text, cursor)
    if (idx !== undefined) {
      setAt(idx)
      menu.reset()
      setMode("mention")
      setQuery(displaySlice(text, idx + 1, cursor))
    }
  }

  const bind = (next?: TextareaRenderable) => {
    if (area === next) {
      return
    }

    if (area && !area.isDestroyed) {
      area.off("line-info-change", scheduleRows)
    }

    area = next
    if (!area || area.isDestroyed) {
      return
    }

    if (type === 0) {
      type = area.extmarks.registerType("run-direct-prompt-part")
    }
    area.on("line-info-change", scheduleRows)
    queueMicrotask(() => {
      if (!area || area.isDestroyed || !input.prompt()) {
        return
      }

      restore(draft)
      refresh()
    })
  }

  const syncDraft = () => {
    if (!area || area.isDestroyed) {
      return
    }

    syncParts()
    const command = shell() ? undefined : selectedCommand(area.plainText, draft.command)
    draft = shell()
      ? {
          text: area.plainText,
          parts: structuredClone(parts),
          mode: "shell",
        }
      : {
          text: area.plainText,
          parts: structuredClone(parts),
          ...(command ? { command } : {}),
        }
  }

  const push = (value: RunPrompt) => {
    history = pushPromptHistory(history, value)
  }

  const move = (dir: -1 | 1, event: KeyEvent) => {
    if (!area || area.isDestroyed) {
      return false
    }

    if (history.index === null && dir === -1) {
      stash = clonePrompt(draft)
    }

    const next = movePromptHistory(history, dir, area.plainText, area.cursorOffset)
    if (!next.apply || next.text === undefined || next.cursor === undefined) {
      return false
    }

    history = next.state
    const value =
      next.state.index === null ? stash : (next.state.items[next.state.index] ?? { text: next.text, parts: [] })
    restore(value, next.cursor)
    event.preventDefault()
    return true
  }

  const historyCommand = (dir: -1 | 1, event: KeyEvent) => {
    if (move(dir, event)) return
    if (!area || area.isDestroyed) return false

    const endOffset = Bun.stringWidth(area.plainText)
    if (dir === -1 && area.visualCursor.visualRow === 0) {
      area.cursorOffset = 0
    }

    const end =
      typeof area.height === "number" && Number.isFinite(area.height) && area.height > 0
        ? area.height - 1
        : Math.max(0, (area.virtualLineCount ?? 1) - 1)
    if (dir === 1 && area.visualCursor.visualRow === end) {
      area.cursorOffset = endOffset
    }

    return false
  }

  const requestExit = () => {
    const text = area && !area.isDestroyed ? area.plainText : draft.text
    if (input.prompt() && text.length > 0) {
      input.onInputClear()
      resetDraft()
      return true
    }

    return input.onExitRequest ? input.onExitRequest() : (input.onExit(), true)
  }

  const cancelAutocomplete = () => {
    if (!area || area.isDestroyed) {
      return
    }

    const cursor = area.cursorOffset
    const startOffset = mode() === "slash" ? 0 : at()
    area.cursorOffset = startOffset
    const start = area.logicalCursor
    area.cursorOffset = cursor
    const end = area.logicalCursor
    area.deleteRange(start.row, start.col, end.row, end.col)
    area.cursorOffset = startOffset
    hide()
    syncDraft()
    scheduleRows()
    area.focus()
  }

  const openEditor = async (inputValue?: { value?: string }) => {
    input.onInputClear()
    syncDraft()
    hide()

    const current = clonePrompt(draft)
    try {
      const content = await input.onEditorOpen({
        value: inputValue?.value ?? current.text,
      })
      if (content === undefined) {
        return
      }
      const normalized = normalizePromptContent(content)

      restore({
        text: normalized,
        parts: realignEditorPromptParts(normalized, current.parts),
        ...(current.mode ? { mode: current.mode } : {}),
        ...(current.command ? { command: current.command } : {}),
      })
    } catch {
      restore(current)
      input.onStatus("failed to open editor")
    }
  }

  const select = (item?: PromptOption) => {
    const next = item ?? options()[menu.selected()]
    if (!next || !area || area.isDestroyed) {
      return
    }

    if (next.kind === "slash") {
      if (next.action === "editor") {
        void openEditor({
          value: resolveEditorSlashValue(area.plainText),
        })
        return
      }

      if (next.action === "skill-menu") {
        cancelAutocomplete()
        input.onSkillMenu()
        return
      }

      const cursor = area.cursorOffset
      const head = slashHead(area.plainText)
      const local = !shell() && (next.name === "new" || next.name === "exit")
      const separator = !shell() && !local && head && /\s/.test(area.plainText[head.end] ?? "") ? "" : " "
      const text = `/${next.name}${separator}`

      area.cursorOffset = 0
      const start = area.logicalCursor
      area.cursorOffset =
        shell() || !head
          ? cursor
          : local
            ? Bun.stringWidth(area.plainText)
            : Bun.stringWidth(area.plainText.slice(0, head.end))
      const end = area.logicalCursor

      area.deleteRange(start.row, start.col, end.row, end.col)
      area.insertText(text)
      area.cursorOffset = Bun.stringWidth(text)
      hide()
      syncDraft()
      if (!shell()) {
        submitPrompt(clonePrompt(draft))
        return
      }

      scheduleRows()
      area.focus()
      return
    }

    const cursor = area.cursorOffset
    const tail = displayCharAt(area.plainText, cursor)
    const append = "@" + next.value + (tail === " " ? "" : " ")
    area.cursorOffset = at()
    const start = area.logicalCursor
    area.cursorOffset = cursor
    const end = area.logicalCursor
    area.deleteRange(start.row, start.col, end.row, end.col)
    area.insertText(append)

    const text = "@" + next.value
    const startOffset = at()
    const endOffset = startOffset + Bun.stringWidth(text)
    const part = structuredClone(next.part)
    if (part.type === "agent") {
      part.source = {
        start: startOffset,
        end: endOffset,
        value: text,
      }
    }
    if (part.type === "file" && part.source?.text) {
      part.source.text.start = startOffset
      part.source.text.end = endOffset
      part.source.text.value = text
    }

    if (part.type === "file") {
      const prev = parts.findIndex((item) => item.type === "file" && item.url === part.url)
      if (prev !== -1) {
        const mark = [...marks.entries()].find((item) => item[1] === prev)?.[0]
        if (mark !== undefined) {
          area.extmarks.delete(mark)
        }
        parts = parts.filter((_, idx) => idx !== prev)
        marks = new Map(
          [...marks.entries()]
            .filter((item) => item[0] !== mark)
            .map((item) => [item[0], item[1] > prev ? item[1] - 1 : item[1]]),
        )
      }
    }

    const id = area.extmarks.create({
      start: startOffset,
      end: endOffset,
      virtual: true,
      typeId: type,
    })
    marks.set(id, parts.length)
    parts.push(part)
    hide()
    syncDraft()
    scheduleRows()
    area.focus()
  }

  const expand = () => {
    const next = options()[menu.selected()]
    if (!next || next.kind !== "mention" || !next.directory || !area || area.isDestroyed) {
      return
    }

    const cursor = area.cursorOffset
    area.cursorOffset = at()
    const start = area.logicalCursor
    area.cursorOffset = cursor
    const end = area.logicalCursor
    area.deleteRange(start.row, start.col, end.row, end.col)
    area.insertText("@" + next.value)
    syncDraft()
    refresh()
  }

  const baseBindingsEnabled = () => {
    const current = input.view()
    if (current === "command") return false
    if (current === "skill") return false
    if (current === "model") return false
    if (current === "variant") return false
    if (current === "queued-menu") return false
    if (current === "subagent-menu") return false
    return true
  }

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: baseBindingsEnabled(),
    commands: [
      {
        name: "prompt.clear",
        title: "Clear prompt or exit",
        category: "Prompt",
        run() {
          if (requestExit()) return
          return false
        },
      },
    ],
    bindings: input.tuiConfig.keybinds.get("prompt.clear"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt(),
    commands: [
      {
        name: "session.interrupt",
        title: "Interrupt session",
        category: "Session",
        run() {
          if (input.onInterrupt()) return
          return false
        },
      },
    ],
    bindings: input.tuiConfig.keybinds.get("session.interrupt"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt() && !visible(),
    commands: [
      {
        name: "prompt.editor",
        title: "Open editor",
        category: "Prompt",
        run() {
          void openEditor()
        },
      },
    ],
    bindings: input.tuiConfig.keybinds.get("prompt.editor"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt() && !visible(),
    commands: [
      {
        name: "prompt.history.previous",
        title: "Previous prompt history",
        category: "Prompt",
        run(ctx: { event: KeyEvent }) {
          return historyCommand(-1, ctx.event)
        },
      },
      {
        name: "prompt.history.next",
        title: "Next prompt history",
        category: "Prompt",
        run(ctx: { event: KeyEvent }) {
          return historyCommand(1, ctx.event)
        },
      },
    ],
    bindings: [
      ...input.tuiConfig.keybinds.get("prompt.history.previous"),
      ...input.tuiConfig.keybinds.get("prompt.history.next"),
    ],
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt() && !visible(),
    bindings: [
      {
        key: "!",
        desc: "Shell mode",
        group: "Prompt",
        cmd() {
          if (shell()) return false
          if (!area || area.isDestroyed) return false
          if (area.cursorOffset !== 0) return false
          setShellMode(true)
        },
      },
    ],
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt() && shell() && !visible(),
    bindings: [
      {
        key: "escape",
        desc: "Exit shell mode",
        group: "Prompt",
        cmd: () => setShellMode(false),
      },
      {
        key: "backspace",
        desc: "Exit shell mode",
        group: "Prompt",
        cmd() {
          if (!area || area.isDestroyed) return false
          if (area.cursorOffset !== 0) return false
          setShellMode(false)
        },
      },
    ],
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: input.prompt() && visible(),
    commands: [
      {
        name: "prompt.autocomplete.prev",
        title: "Previous autocomplete item",
        category: "Autocomplete",
        run: () => menu.move(-1),
      },
      {
        name: "prompt.autocomplete.next",
        title: "Next autocomplete item",
        category: "Autocomplete",
        run: () => menu.move(1),
      },
      {
        name: "prompt.autocomplete.hide",
        title: "Hide autocomplete",
        category: "Autocomplete",
        run: cancelAutocomplete,
      },
      {
        name: "prompt.autocomplete.select",
        title: "Select autocomplete item",
        category: "Autocomplete",
        run() {
          if (mode() === "slash" && options().length === 0) {
            hide()
            return
          }
          select()
        },
      },
      {
        name: "prompt.autocomplete.complete",
        title: "Complete autocomplete item",
        category: "Autocomplete",
        run() {
          if (mode() === "slash" && options().length === 0) {
            hide()
            return
          }
          const item = options()[menu.selected()]
          if (item?.kind === "mention" && item.directory) {
            expand()
            return
          }
          select()
        },
      },
    ],
    bindings: input.tuiConfig.keybinds.gather("run.prompt.autocomplete", [
      "prompt.autocomplete.prev",
      "prompt.autocomplete.next",
      "prompt.autocomplete.hide",
      "prompt.autocomplete.select",
      "prompt.autocomplete.complete",
    ]),
  }))

  const onKeyDown = (event: KeyEvent) => {
    if (input.state().phase === "idle" && event.name.toLowerCase() === "escape") {
      input.onInputClear()
    }
  }

  const submitPrompt = (next: RunPrompt) => {
    if (!area || area.isDestroyed) {
      draft = clonePrompt(next)
    }

    if (visible()) {
      if (mode() !== "slash" || options().length > 0) {
        select()
        return
      }

      hide()
    }

    if (!next.text.trim()) {
      input.onStatus(input.state().phase === "running" ? "waiting for current response" : "empty prompt ignored")
      return
    }

    const command = next.mode === "shell" ? undefined : selectedCommand(next.text, next.command)
    if (!command && next.mode !== "shell" && isExitCommand(next.text)) {
      input.onExit()
      return
    }

    const parsed =
      command || next.mode === "shell" || isNewCommand(next.text)
        ? undefined
        : parseSlashCommand(next.text, input.commands())
    if (parsed?.type === "pending") {
      input.onStatus("loading commands")
      return
    }

    const submit = command
      ? { ...next, command }
      : parsed?.type === "command"
        ? { ...next, command: parsed.command }
        : next
    const shellMode = next.mode === "shell"

    resetDraft()
    queueMicrotask(async () => {
      if (await input.onSubmit(submit)) {
        push(next)
        if (shellMode) {
          setShellMode(false)
          draft = emptyPrompt(false)
        }
        return
      }

      restore(next)
    })
  }

  const onSubmit = () => {
    syncDraft()
    submitPrompt(clonePrompt(draft))
  }

  const submitText = (text: string) => {
    submitPrompt({ text, parts: [] })
  }

  onCleanup(() => {
    if (area && !area.isDestroyed) {
      area.off("line-info-change", scheduleRows)
    }
  })

  createEffect(() => {
    input.width()
    popup()
    if (input.prompt()) {
      scheduleRows()
    }
  })

  createEffect(() => {
    query()
    menu.reset()
  })

  createEffect(() => {
    input.state().phase
    if (!input.prompt() || !area || area.isDestroyed || input.state().phase !== "idle") {
      return
    }

    queueMicrotask(() => {
      if (!area || area.isDestroyed) {
        return
      }

      area.focus()
    })
  })

  createEffect(() => {
    const kind = input.view()
    if (kind === prev) {
      return
    }

    if (prev === "prompt") {
      syncDraft()
    }

    hide()
    prev = kind
    if (kind !== "prompt") {
      return
    }

    queueMicrotask(() => {
      restore(draft)
    })
  })

  return {
    placeholder,
    shell,
    visible,
    options,
    selected: menu.selected,
    offset: menu.offset,
    rows: menu.rows,
    requestExit,
    onSubmit,
    submitText,
    openEditor,
    onKeyDown,
    onContentChange: () => {
      input.onInputClear()
      syncDraft()
      refresh()
      scheduleRows()
    },
    replaceDraft,
    replacePrompt: restore,
    bind,
  }
}
