// Prompt textarea component and its state machine for direct interactive mode.
//
// createPromptState() wires keybinds, history navigation, leader-key sequences,
// and `@` autocomplete for files, subagents, and MCP resources.
// It produces a PromptState that RunPromptBody renders as an OpenTUI textarea,
// while the footer view renders the current menu state below it.
/** @jsxImportSource @opentui/solid */
import { pathToFileURL } from "bun"
import { StyledText, bg, fg, type KeyBinding, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import path from "path"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import * as Locale from "@/util/locale"
import {
  createPromptHistory,
  isExitCommand,
  isNewCommand,
  movePromptHistory,
  promptCycle,
  promptHit,
  promptInfo,
  promptKeys,
  pushPromptHistory,
} from "./prompt.shared"
import { FOOTER_MENU_ROWS, createFooterMenuState, type RunFooterMenuItem } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type { FooterKeybinds, FooterState, RunAgent, RunCommand, RunPrompt, RunPromptPart, RunResource } from "./types"

const AUTOCOMPLETE_ROWS = FOOTER_MENU_ROWS
const AUTOCOMPLETE_BOTTOM_ROWS = 1

export const TEXTAREA_MIN_ROWS = 1
export const TEXTAREA_MAX_ROWS = 6
export const PROMPT_MAX_ROWS = TEXTAREA_MAX_ROWS + AUTOCOMPLETE_ROWS - 1 + AUTOCOMPLETE_BOTTOM_ROWS

export const HINT_BREAKPOINTS = {
  send: 50,
  newline: 66,
  history: 80,
  command: 95,
}

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
}

type PromptOption = Auto | SlashOption

type MenuMode = false | "mention" | "slash"

type PromptInput = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: Accessor<RunAgent[]>
  resources: Accessor<RunResource[]>
  commands: Accessor<RunCommand[] | undefined>
  keybinds: FooterKeybinds
  state: Accessor<FooterState>
  view: Accessor<string>
  prompt: Accessor<boolean>
  width: Accessor<number>
  theme: Accessor<RunFooterTheme>
  history?: RunPrompt[]
  onSubmit: (input: RunPrompt) => boolean | Promise<boolean>
  onCycle: () => void
  onInterrupt: () => boolean
  onInputClear: () => void
  onExitRequest?: () => boolean
  onExit: () => void
  onRows: (rows: number) => void
  onStatus: (text: string) => void
}

export type PromptState = {
  placeholder: Accessor<StyledText | string>
  bindings: Accessor<KeyBinding[]>
  visible: Accessor<boolean>
  options: Accessor<PromptOption[]>
  selected: Accessor<number>
  offset: Accessor<number>
  rows: Accessor<number>
  requestExit: () => boolean
  onSubmit: () => void
  submitText: (text: string) => void
  onKeyDown: (event: KeyEvent) => void
  onContentChange: () => void
  replaceDraft: (text: string) => void
  bind: (area?: TextareaRenderable) => void
}

function clamp(rows: number): number {
  return Math.max(TEXTAREA_MIN_ROWS, Math.min(TEXTAREA_MAX_ROWS, rows))
}

function clonePrompt(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
  }
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

export function hintFlags(width: number) {
  return {
    send: width >= HINT_BREAKPOINTS.send,
    newline: width >= HINT_BREAKPOINTS.newline,
    history: width >= HINT_BREAKPOINTS.history,
    command: width >= HINT_BREAKPOINTS.command,
  }
}

export function RunPromptBody(props: {
  theme: () => RunFooterTheme
  placeholder: () => StyledText | string
  bindings: () => KeyBinding[]
  onSubmit: () => void
  onKeyDown: (event: KeyEvent) => void
  onContentChange: () => void
  bind: (area?: TextareaRenderable) => void
}) {
  let area: TextareaRenderable | undefined

  onMount(() => {
    props.bind(area)
  })

  onCleanup(() => {
    props.bind(undefined)
  })

  return (
    <box id="run-direct-footer-prompt" width="100%">
      <box id="run-direct-footer-input-shell" paddingTop={1} paddingLeft={2} paddingRight={2}>
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
          backgroundColor={props.theme().surface}
          focusedBackgroundColor={props.theme().surface}
          cursorColor={props.theme().text}
          keyBindings={props.bindings()}
          onSubmit={props.onSubmit}
          onKeyDown={props.onKeyDown}
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
  const keys = createMemo(() => promptKeys(input.keybinds))
  const bindings = createMemo(() => keys().bindings)
  const placeholder = createMemo(() => {
    if (!input.state().first) {
      return ""
    }

    return new StyledText([
      bg(input.theme().surface)(fg(input.theme().muted)('Ask anything... "Fix a TODO in the codebase"')),
    ])
  })

  let history = createPromptHistory(input.history)
  let draft: RunPrompt = { text: "", parts: [] }
  let stash: RunPrompt = { text: "", parts: [] }
  let area: TextareaRenderable | undefined
  let leader = false
  let timeout: NodeJS.Timeout | undefined
  let tick = false
  let prev = input.view()
  let type = 0
  let parts: Mention[] = []
  let marks = new Map<number, number>()

  const [mode, setMode] = createSignal<MenuMode>(false)
  const [at, setAt] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const visible = createMemo(() => mode() !== false)

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
      return list
        .sort((a, b) => {
          const dir = Number(b.endsWith("/")) - Number(a.endsWith("/"))
          if (dir !== 0) {
            return dir
          }

          const depth = a.split("/").length - b.split("/").length
          if (depth !== 0) {
            return depth
          }

          return a.localeCompare(b)
        })
        .map((item): Auto => {
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
  const slashOptions = createMemo<SlashOption[]>(() => {
    const builtins = [
      { kind: "slash", name: "new", display: "/new", description: "start a new session" } satisfies SlashOption,
      { kind: "slash", name: "exit", display: "/exit", description: "close direct mode" } satisfies SlashOption,
    ]
    const hidden = new Set(builtins.map((item) => item.name))
    return [
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

    return fuzzysort
      .go(removeLineRange(query()), mixed, {
        keys: [(item) => (item.kind === "mention" ? item.value : item.name).trimEnd(), "display", "description"],
      })
      .map((item) => item.obj)
  })
  const menu = createFooterMenuState({ count: () => options().length, limit: AUTOCOMPLETE_ROWS })
  const popup = createMemo(() => {
    return visible() ? menu.rows() - 1 + AUTOCOMPLETE_BOTTOM_ROWS : 0
  })

  const clear = () => {
    leader = false
    if (!timeout) {
      return
    }

    clearTimeout(timeout)
    timeout = undefined
  }

  const arm = () => {
    clear()
    leader = true
    timeout = setTimeout(() => {
      clear()
    }, input.keybinds.leaderTimeout)
  }

  const hide = () => {
    setMode(false)
    setQuery("")
    menu.reset()
  }

  const syncRows = () => {
    if (!area || area.isDestroyed) {
      return
    }

    input.onRows(clamp(area.virtualLineCount || 1) + popup())
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

  const restore = (value: RunPrompt, cursor = value.text.length) => {
    draft = clonePrompt(value)
    if (!area || area.isDestroyed) {
      return
    }

    hide()
    area.setText(value.text)
    restoreParts(value.parts)
    area.cursorOffset = Math.min(cursor, area.plainText.length)
    scheduleRows()
    area.focus()
  }

  const resetDraft = () => {
    if (area && !area.isDestroyed) {
      area.setText("")
    }

    clearParts()
    hide()
    draft = { text: "", parts: [] }
    if (!area || area.isDestroyed) {
      return
    }

    scheduleRows()
    area.focus()
  }

  const replaceDraft = (text: string) => {
    draft = { text, parts: [] }
    if (!area || area.isDestroyed) {
      return
    }

    hide()
    area.setText(text)
    clearParts()
    draft = { text: area.plainText, parts: [] }
    area.cursorOffset = Math.min(text.length, area.plainText.length)
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
      if (cursor <= at() || /\s/.test(text.slice(at(), cursor))) {
        hide()
        return
      }

      setQuery(text.slice(at() + 1, cursor))
      return
    }

    if (cursor === 0) {
      return
    }

    const head = text.slice(0, cursor)
    const idx = head.lastIndexOf("@")
    if (idx === -1) {
      return
    }

    const before = idx === 0 ? undefined : head[idx - 1]
    const tail = head.slice(idx)
    if ((before === undefined || /\s/.test(before)) && !/\s/.test(tail)) {
      setAt(idx)
      menu.reset()
      setMode("mention")
      setQuery(head.slice(idx + 1))
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
    draft = {
      text: area.plainText,
      parts: structuredClone(parts),
    }
  }

  const push = (value: RunPrompt) => {
    history = pushPromptHistory(history, value)
  }

  const move = (dir: -1 | 1, event: KeyEvent) => {
    if (!area || area.isDestroyed) {
      return
    }

    if (history.index === null && dir === -1) {
      stash = clonePrompt(draft)
    }

    const next = movePromptHistory(history, dir, area.plainText, area.cursorOffset)
    if (!next.apply || next.text === undefined || next.cursor === undefined) {
      return
    }

    history = next.state
    const value =
      next.state.index === null ? stash : (next.state.items[next.state.index] ?? { text: next.text, parts: [] })
    restore(value, next.cursor)
    event.preventDefault()
  }

  const cycle = (event: KeyEvent): boolean => {
    const next = promptCycle(leader, promptInfo(event), keys().leaders, keys().cycles)
    if (!next.consume) {
      return false
    }

    if (next.clear) {
      clear()
    }

    if (next.arm) {
      arm()
    }

    if (next.cycle) {
      input.onCycle()
    }

    event.preventDefault()
    return true
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

  const select = (item?: PromptOption) => {
    const next = item ?? options()[menu.selected()]
    if (!next || !area || area.isDestroyed) {
      return
    }

    if (next.kind === "slash") {
      const text = `/${next.name} `
      const cursor = area.cursorOffset

      area.cursorOffset = 0
      const start = area.logicalCursor
      area.cursorOffset = cursor
      const end = area.logicalCursor

      area.deleteRange(start.row, start.col, end.row, end.col)
      area.insertText(text)
      area.cursorOffset = Bun.stringWidth(text)
      hide()
      syncDraft()
      scheduleRows()
      area.focus()
      return
    }

    const cursor = area.cursorOffset
    const tail = area.plainText.at(cursor)
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

  const onKeyDown = (event: KeyEvent) => {
    const key = promptInfo(event)
    if (visible()) {
      const name = event.name.toLowerCase()
      const ctrl = event.ctrl && !event.meta && !event.shift
      if (name === "up" || (ctrl && name === "p")) {
        event.preventDefault()
        if (options().length > 0) {
          menu.move(-1)
        }
        return
      }

      if (name === "down" || (ctrl && name === "n")) {
        event.preventDefault()
        if (options().length > 0) {
          menu.move(1)
        }
        return
      }

      if (name === "escape") {
        event.preventDefault()
        cancelAutocomplete()
        return
      }

      if (name === "return") {
        if (mode() === "slash" && options().length === 0) {
          hide()
          return
        }

        event.preventDefault()
        select()
        return
      }

      if (name === "tab") {
        if (mode() === "slash" && options().length === 0) {
          hide()
          return
        }

        event.preventDefault()
        const item = options()[menu.selected()]
        if (item?.kind === "mention" && item.directory) {
          expand()
          return
        }

        select()
        return
      }
    }

    if (promptHit(keys().clear, key)) {
      const handled = requestExit()
      if (handled) {
        event.preventDefault()
      }
      return
    }

    if (promptHit(keys().interrupts, key)) {
      if (input.onInterrupt()) {
        event.preventDefault()
        return
      }
    }

    if (cycle(event)) {
      return
    }

    const up = promptHit(keys().previous, key)
    const down = promptHit(keys().next, key)
    if (!up && !down) {
      return
    }

    if (!area || area.isDestroyed) {
      return
    }

    const dir = up ? -1 : 1
    if ((dir === -1 && area.cursorOffset === 0) || (dir === 1 && area.cursorOffset === area.plainText.length)) {
      move(dir, event)
      return
    }

    if (dir === -1 && area.visualCursor.visualRow === 0) {
      area.cursorOffset = 0
    }

    const end =
      typeof area.height === "number" && Number.isFinite(area.height) && area.height > 0
        ? area.height - 1
        : Math.max(0, (area.virtualLineCount ?? 1) - 1)
    if (dir === 1 && area.visualCursor.visualRow === end) {
      area.cursorOffset = area.plainText.length
    }
  }

  useKeyboard((event) => {
    if (input.prompt()) {
      return
    }

    if (input.view() === "command" || input.view() === "model" || input.view() === "variant") {
      return
    }

    if (promptHit(keys().clear, promptInfo(event))) {
      const handled = requestExit()
      if (handled) {
        event.preventDefault()
      }
    }
  })

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

    if (isExitCommand(next.text)) {
      input.onExit()
      return
    }

    const parsed = isNewCommand(next.text) ? undefined : parseSlashCommand(next.text, input.commands())
    if (parsed?.type === "pending") {
      input.onStatus("loading commands")
      return
    }

    const submit = parsed?.type === "command" ? { ...next, command: parsed.command } : next

    resetDraft()
    queueMicrotask(async () => {
      if (await input.onSubmit(submit)) {
        push(next)
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
    clear()
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

    clear()
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
    bindings,
    visible,
    options,
    selected: menu.selected,
    offset: menu.offset,
    rows: menu.rows,
    requestExit,
    onSubmit,
    submitText,
    onKeyDown,
    onContentChange: () => {
      syncDraft()
      refresh()
      scheduleRows()
    },
    replaceDraft,
    bind,
  }
}
