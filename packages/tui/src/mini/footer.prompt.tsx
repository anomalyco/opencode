// Prompt composer and its state machine for direct interactive mode.
//
// createPromptState() wires keymap command layers, history navigation, and
// `@` autocomplete for files, subagents, and project references.
// It produces a PromptState that RunPromptBody renders as a slim single-line
// composer while the footer view renders any active menus below it.
/** @jsxImportSource @opentui/solid */
import {
  StyledText,
  decodePasteBytes,
  fg,
  stripAnsiSequences,
  type ColorInput,
  type KeyEvent,
  type PasteEvent,
  type TextareaRenderable,
} from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { normalizePromptContent } from "../prompt/content"
import { deduplicatePromptImages, promptAttachmentLabel } from "../prompt/attachment"
import { resolvePastedAttachments } from "../component/prompt/local-attachment"
import { createTuiClipboard, type OwnedClipboardService } from "../clipboard"
import type { ClipboardService } from "../context/clipboard"
import fuzzysort from "fuzzysort"
import path from "path"
import { pathToFileURL } from "node:url"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js"
import { stringWidth } from "../util/string-width"
import { errorMessage } from "../util/error"
import {
  createPromptHistory,
  displayCharAt,
  displaySlice,
  isExitCommand,
  isCompactCommand,
  mentionTriggerIndex,
  slashTriggerIndex,
  isNewCommand,
  movePromptHistory,
  promptCopy,
  pushPromptHistory,
} from "./prompt.shared"
import { parseFileLineRange, parseSlashHead, stripFileLineRange } from "../prompt/parse"
import { Keymap } from "../context/keymap"
import { realignEditorPromptParts, resolveEditorSlashValue } from "./prompt.editor"
import { FOOTER_COMPACT_WIDTH, FOOTER_MENU_ROWS, createFooterMenuState, type RunFooterMenuItem } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type {
  FooterQueuedPrompt,
  FooterState,
  RunAgent,
  RunCommand,
  RunDelivery,
  RunPrompt,
  RunPromptPart,
  RunReference,
  RunTuiConfig,
} from "./types"
import { EmptyBorder } from "../ui/border"

const AUTOCOMPLETE_ROWS = FOOTER_MENU_ROWS

export const TEXTAREA_MIN_ROWS = 1
const TEXTAREA_MAX_ROWS = 6
export const PROMPT_MAX_ROWS = TEXTAREA_MAX_ROWS + AUTOCOMPLETE_ROWS

export function footerPromptLayout(
  height: number,
  lines = TEXTAREA_MIN_ROWS,
  options = 0,
  statusRows = 1,
  images = false,
) {
  const padding = height >= PROMPT_MAX_ROWS + 4 ? 1 : 0
  // Reserve status and, where possible, one transcript row.
  const available = Math.max(1, height - 1 - statusRows - padding * 2)
  const preview = images && options === 0 ? Math.min(4, available - Math.min(TEXTAREA_MAX_ROWS, Math.max(1, lines))) : 0
  const imageRows = preview >= 3 ? preview : 0
  const textarea = Math.max(1, Math.min(TEXTAREA_MAX_ROWS, available - imageRows - (options > 0 ? 1 : 0)))
  const rows = Math.min(textarea, Math.max(1, lines))
  const menu = options > 0 ? Math.max(1, Math.min(AUTOCOMPLETE_ROWS, options, available - rows)) : 0
  return { padding, textarea, menu, images: imageRows, rows: rows + menu + imageRows }
}

type Mention = Extract<RunPromptPart, { type: "file" | "agent" | "skill" }>

type Auto = RunFooterMenuItem & {
  kind: "mention"
  value: string
  part: Mention
  directory?: boolean
}

type SlashOption = RunFooterMenuItem & {
  kind: "slash"
  name: string
  action?: "skill-menu" | "editor" | "settings"
}

type SkillOption = RunFooterMenuItem & {
  kind: "skill"
  id: string
}

type PromptOption = Auto | SlashOption | SkillOption

type MenuMode = false | "mention" | "slash"

type PromptInput = {
  directory: Accessor<string>
  findFiles: (query: string) => Promise<string[]>
  agents: Accessor<RunAgent[]>
  references: Accessor<RunReference[]>
  commands: Accessor<RunCommand[] | undefined>
  state: Accessor<FooterState>
  view: Accessor<string>
  prompt: Accessor<boolean>
  width: Accessor<number>
  statusRows: Accessor<number>
  theme: Accessor<RunFooterTheme>
  mono: Accessor<boolean>
  imagePreview?: boolean
  clipboard?: Pick<ClipboardService, "read">
  history?: Accessor<RunPrompt[]>
  queuedPrompts: Accessor<FooterQueuedPrompt[]>
  onQueuedPromptSteer: (inboxID: string) => Promise<boolean>
  onSubmit: (input: RunPrompt) => boolean | Promise<boolean>
  onCycle: () => void
  onInterrupt: () => boolean
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onExit: () => void
  onSkillMenu: () => void
  onSettings: () => void
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
  images: Accessor<ReadonlyArray<{ uri: string }>>
  layout: Accessor<ReturnType<typeof footerPromptLayout>>
  requestExit: () => boolean
  onSubmit: () => void
  submitText: (text: string) => void
  openEditor: (input?: { value?: string }) => Promise<void>
  onKeyDown: (event: KeyEvent) => void
  onPaste: (event: PasteEvent) => Promise<void>
  onContentChange: () => void
  onSizeChange: () => void
  replacePrompt: (prompt: RunPrompt) => void
  bind: (area?: TextareaRenderable) => void
}

function emptyPrompt(shell: boolean): RunPrompt {
  return shell ? { text: "", parts: [], mode: "shell" } : { text: "", parts: [] }
}

function slashQuery(text: string, cursor: number) {
  const at = slashTriggerIndex(text, cursor)
  if (at === undefined) return
  return { at, value: displaySlice(text, at + 1, cursor) }
}

function parseSlashCommand(text: string, commands: RunCommand[] | undefined) {
  const head = parseSlashHead(text)
  if (!head || head.name.length === 0) {
    return { type: "none" as const }
  }

  if (!commands) {
    return { type: "pending" as const }
  }

  const item = commands.find((entry) => entry.name === head.name)
  if (!item) {
    return { type: "none" as const }
  }

  return {
    type: "command" as const,
    command: { name: head.name, arguments: head.arguments, ...(item.source ? { source: item.source } : {}) },
  }
}

export function selectedCommand(text: string, command: RunPrompt["command"]) {
  if (!command) {
    return
  }

  const head = parseSlashHead(text)
  if (!head || head.name !== command.name) {
    return
  }

  return {
    name: command.name,
    arguments: head.arguments,
    ...(command.source ? { source: command.source } : {}),
  }
}

export function RunPromptBody(props: {
  theme: () => RunFooterTheme
  background: () => ColorInput
  rail: () => ColorInput
  mono: boolean
  cursorStyle: RunTuiConfig["cursor"]
  placeholder: () => StyledText | string
  onSubmit: () => void
  onKeyDown: (event: KeyEvent) => void
  onPaste: (event: PasteEvent) => Promise<void>
  images: Accessor<ReadonlyArray<{ uri: string }>>
  layout: Accessor<ReturnType<typeof footerPromptLayout>>
  onContentChange: () => void
  onSizeChange: () => void
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
    <box width="100%" paddingTop={props.layout().padding} paddingBottom={props.layout().padding}>
      <box
        border={["left"]}
        borderColor={props.rail()}
        customBorderChars={{ ...EmptyBorder, vertical: props.mono ? "|" : "┃" }}
        paddingLeft={1}
        paddingRight={2}
        onSizeChange={props.onSizeChange}
      >
        <Show when={props.layout().images > 0}>
          <box width="100%" height={props.layout().images} flexDirection="row" gap={1}>
            <For
              each={props
                .images()
                .slice(0, 3)
                .map((image) => image.uri)}
            >
              {(image, index) => {
                const [failed, setFailed] = createSignal(false)
                return (
                  <box width={props.layout().images * 2} height="100%" flexShrink={1}>
                    <Show when={!failed()} fallback={<text fg={props.theme().muted}>No preview</text>}>
                      <image
                        id={`mini-prompt-image-${index()}`}
                        source={image}
                        fit="fit"
                        protocol="auto"
                        width="100%"
                        height="100%"
                        onError={() => setFailed(true)}
                      />
                    </Show>
                  </box>
                )
              }}
            </For>
            <Show when={props.images().length > 3}>
              <text fg={props.theme().muted} wrapMode="none" truncate>
                +{props.images().length - 3} more
              </text>
            </Show>
          </box>
        </Show>
        <textarea
          width="100%"
          minHeight={TEXTAREA_MIN_ROWS}
          maxHeight={props.layout().textarea}
          wrapMode="word"
          placeholder={props.placeholder()}
          placeholderColor={props.theme().muted}
          textColor={props.theme().text}
          focusedTextColor={props.theme().text}
          backgroundColor={props.background()}
          focusedBackgroundColor={props.background()}
          cursorColor={props.theme().text}
          cursorStyle={props.cursorStyle}
          onSubmit={props.onSubmit}
          onKeyDown={props.onKeyDown}
          onPaste={(event) => {
            void props.onPaste(event).finally(refreshPasteLayout)
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
  const renderer = useRenderer()
  const term = useTerminalDimensions()
  const [lines, setLines] = createSignal(TEXTAREA_MIN_ROWS)
  const [statusRows, setStatusRows] = createSignal(1)
  const [shell, setShell] = createSignal(false)
  const placeholder = createMemo(() => {
    if (shell()) {
      return new StyledText([fg(input.theme().muted)('Run a command… "git status"')])
    }

    if (!input.state().first) {
      return ""
    }

    return new StyledText([
      fg(input.theme().muted)(`Ask anything, / for commands, @ for context${input.mono() ? "..." : "…"}`),
    ])
  })

  let history = createPromptHistory(input.history?.())
  createEffect(() => {
    history = createPromptHistory(input.history?.())
  })
  let draft: RunPrompt = { text: "", parts: [] }
  let stash: RunPrompt = { text: "", parts: [] }
  let area: TextareaRenderable | undefined
  let tick = false
  let prev = input.view()
  let type = 0
  let parts: Mention[] = []
  let marks = new Map<number, number>()
  const [draftParts, setDraftParts] = createSignal<RunPromptPart[]>([])
  const attachments = createMemo(() =>
    draftParts().flatMap((part) =>
      part.type === "file"
        ? [
            {
              uri: part.url,
              name: part.filename,
              description: part.description,
              mention: part.source?.text
                ? { start: part.source.text.start, end: part.source.text.end, text: part.source.text.value }
                : undefined,
            },
          ]
        : [],
    ),
  )
  const images = createMemo(() =>
    (deduplicatePromptImages(attachments()) ?? []).filter((file) => file.uri.startsWith("data:image/")),
  )
  let clipboard: OwnedClipboardService | undefined
  let pasteQueue: Promise<void> | undefined
  let applyingPaste = false
  let disposed = false
  let revision = 0

  const [mode, setMode] = createSignal<MenuMode>(false)
  const [at, setAt] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const visible = createMemo(() => mode() !== false)

  const setShellMode = (value: boolean) => {
    revision += 1
    setShell(value)
    draft = value ? { ...draft, mode: "shell" } : { text: draft.text, parts: structuredClone(draft.parts) }
  }

  const width = createMemo(() => Math.max(0, input.width() - (input.width() < FOOTER_COMPACT_WIDTH ? 2 : 4)))
  const agents = createMemo<Auto[]>(() => {
    return input
      .agents()
      .filter((item) => !item.hidden && item.mode !== "primary")
      .map((item) => ({
        kind: "mention",
        display: "@" + item.name,
        value: item.id,
        part: {
          type: "agent",
          name: item.id,
          source: {
            start: 0,
            end: 0,
            value: "",
          },
        },
      }))
  })
  const references = createMemo<Auto[]>(() => {
    return input.references().map((item) => ({
      kind: "mention",
      display: "@" + item.name,
      value: item.name,
      description: item.description ?? (item.source.type === "git" ? item.source.repository : item.source.path),
      part: {
        type: "file",
        mime: "application/x-directory",
        filename: item.name,
        url: pathToFileURL(item.path).href,
        source: {
          type: "file",
          path: item.name,
          text: {
            start: 0,
            end: 0,
            value: "",
          },
        },
      },
    }))
  })
  const [fileResults] = createResource(
    query,
    async (value) => {
      if (!visible() || mode() !== "mention") {
        return []
      }

      const next = parseFileLineRange(value)
      const list = await input.findFiles(next.base)
      return list.map((item): Auto => {
        const url = pathToFileURL(path.resolve(input.directory(), item))
        let filename = item
        if (next.lineRange && !item.endsWith("/")) {
          filename = `${item}#${next.lineRange.startLine}${next.lineRange.endLine ? `-${next.lineRange.endLine}` : ""}`
          url.searchParams.set("start", String(next.lineRange.startLine))
          if (next.lineRange.endLine !== undefined) {
            url.searchParams.set("end", String(next.lineRange.endLine))
          }
        }

        return {
          kind: "mention",
          display: "@" + filename,
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
  const files = createMemo(() =>
    fileResults().map((item) => {
      const parts = item.value.split("/")
      const paths = parts
        .slice(0, item.directory ? -1 : undefined)
        .map((_, index) => "@" + parts.slice(index).join("/"))
      return { ...item, display: paths.find((value) => stringWidth(value) <= width()) ?? paths.at(-1) ?? item.display }
    }),
  )
  const mentionOptions = createMemo(() => [...agents(), ...files(), ...references()])
  const skillCommands = createMemo(() => (input.commands() ?? []).filter((item) => item.source === "skill"))
  const skillOptions = createMemo<SkillOption[]>(() =>
    skillCommands().map((item) => ({
      kind: "skill",
      id: item.name,
      display: `/${item.name}`,
      description: item.description,
    })),
  )
  const hasSkillsCommand = createMemo(() =>
    (input.commands() ?? []).some((item) => item.source !== "skill" && item.name === "skills"),
  )
  const slashOptions = createMemo<Array<SlashOption | SkillOption>>(() => {
    const builtins = [
      {
        kind: "slash",
        action: "editor" as const,
        name: "editor",
        display: "/editor",
        description: "compose in your external editor",
      } satisfies SlashOption,
      {
        kind: "slash",
        action: "settings" as const,
        name: "settings",
        display: "/settings",
        description: "configure Mini transcript output",
      } satisfies SlashOption,
      { kind: "slash", name: "new", display: "/new", description: "start a new session" } satisfies SlashOption,
      {
        kind: "slash",
        name: "compact",
        display: "/compact",
        description: "compact older session context to free space",
      } satisfies SlashOption,
      { kind: "slash", name: "exit", display: "/exit", description: "close OpenCode" } satisfies SlashOption,
    ]
    const hidden = new Set(builtins.map((item) => item.name))
    const showSkillMenu = !shell() && skillCommands().length > 0 && !hasSkillsCommand()
    if (showSkillMenu) {
      hidden.add("skills")
    }

    return [
      ...skillOptions(),
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
    const mixed: PromptOption[] = mode() === "slash" ? (at() === 0 ? slashOptions() : skillOptions()) : mentionOptions()
    if (!query()) {
      return mixed
    }

    const next = stripFileLineRange(query())
    if (mode() === "mention") {
      return [
        ...fuzzysort.go(next, agents(), { keys: ["value", "display", "description"] }).map((item) => item.obj),
        ...files(),
        ...fuzzysort.go(next, references(), { keys: ["value", "display", "description"] }).map((item) => item.obj),
      ]
    }

    return fuzzysort
      .go(next, mixed, {
        keys: [
          (item) => (item.kind === "mention" ? item.value : item.kind === "skill" ? item.id : item.name).trimEnd(),
          "display",
          "description",
        ],
      })
      .map((item) => item.obj)
  })
  const layout = createMemo(() => {
    term()
    return footerPromptLayout(
      renderer.terminalHeight,
      lines(),
      visible() ? Math.max(1, options().length) : 0,
      statusRows(),
      input.imagePreview === true && !input.mono() && !shell() && images().length > 0,
    )
  })
  const menu = createFooterMenuState({ count: () => options().length, limit: () => Math.max(1, layout().menu) })

  const hide = () => {
    setMode(false)
    setQuery("")
    menu.reset()
  }

  const syncRows = () => {
    if (!area || area.isDestroyed) {
      return
    }

    setLines(Math.max(area.lineCount, area.virtualLineCount))
    input.onRows(layout().rows)
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

    const next = parts.map<Mention | undefined>((part) =>
      part.type === "file" && !part.source?.text ? part : undefined,
    )
    let tracked = 0
    for (const item of area.extmarks.getAllForTypeId(type)) {
      const idx = marks.get(item.id)
      if (idx === undefined) {
        continue
      }

      const part = parts[idx]
      if (!part) {
        continue
      }

      const text = displaySlice(area.plainText, item.start, item.end)
      const prev =
        part.type === "agent"
          ? (part.source?.value ?? "@" + part.name)
          : part.type === "skill"
            ? (part.source?.value ?? "/" + part.id)
            : (part.source?.text.value ?? "@" + (part.filename ?? ""))
      if (text !== prev) {
        continue
      }

      const copy = structuredClone(part)
      if (copy.type === "agent" || copy.type === "skill") {
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

      tracked += 1
      next[idx] = copy
    }

    const retained = next.filter((part): part is Mention => part !== undefined)
    const stale = tracked !== marks.size || retained.length !== parts.length
    parts = retained
    if (stale) {
      restoreParts(retained)
    }
  }

  const clearParts = () => {
    if (area && !area.isDestroyed) {
      area.extmarks.clear()
    }
    parts = []
    marks = new Map()
    setDraftParts([])
  }

  const restoreParts = (value: RunPromptPart[]) => {
    clearParts()
    parts = value
      .filter((item): item is Mention => item.type === "file" || item.type === "agent" || item.type === "skill")
      .map((item) => structuredClone(item))
    setDraftParts(parts)
    if (!area || area.isDestroyed || type === 0) {
      return
    }

    const box = area
    parts.forEach((item, idx) => {
      const start = item.type === "file" ? item.source?.text.start : item.source?.start
      const end = item.type === "file" ? item.source?.text.end : item.source?.end
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

  const restore = (value: RunPrompt, cursor = stringWidth(value.text)) => {
    revision += 1
    draft = promptCopy(value)
    setShell(value.mode === "shell")
    if (!area || area.isDestroyed) {
      return
    }

    hide()
    area.setText(value.text)
    restoreParts(value.parts)
    area.cursorOffset = Math.min(cursor, stringWidth(area.plainText))
    scheduleRows()
    area.focus()
  }

  const resetDraft = () => {
    revision += 1
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

      setAt(slash.at)
      setQuery(slash.value)
      return
    }

    if (slash !== undefined) {
      setAt(slash.at)
      menu.reset()
      setMode("slash")
      setQuery(slash.value)
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
    setDraftParts(parts)
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

  const pasteAttachment = (file: { uri: string; filename?: string }) => {
    if (!area || area.isDestroyed) return
    syncDraft()
    const value = promptAttachmentLabel(attachments(), { uri: file.uri, name: file.filename })
    area.insertText(value + " ")
    const end = area.cursorOffset - 1
    const start = end - stringWidth(value)
    const id = area.extmarks.create({ start, end, virtual: true, typeId: type })
    marks.set(id, parts.length)
    parts.push({
      type: "file",
      url: file.uri,
      filename: file.filename,
      mime: file.uri.slice(5, file.uri.indexOf(";")),
      source: { type: "file", text: { start, end, value } },
    })
    syncDraft()
  }

  const paste = (text?: string) => {
    const next = (pasteQueue ?? Promise.resolve())
      .then(async () => {
        const target = area
        if (disposed || !target || target.isDestroyed || !input.prompt()) return
        const before = revision
        const changed = () =>
          disposed || area !== target || target.isDestroyed || revision !== before || !input.prompt()
        const content =
          text === undefined
            ? await (input.clipboard ?? (clipboard ??= createTuiClipboard(renderer))).read()
            : { mime: "text/plain", data: text }
        if (!content || changed()) return
        const image = content.mime.startsWith("image/")
        if (image && shell()) {
          input.onStatus("image attachments are unavailable in shell mode")
          return
        }
        if (!image && content.mime !== "text/plain") return
        const normalized = image ? content.data : stripAnsiSequences(content.data).replace(/\r\n?/g, "\n")
        const files = image
          ? [{ type: "file" as const, uri: `data:${content.mime};base64,${content.data}`, filename: "clipboard" }]
          : shell()
            ? undefined
            : await resolvePastedAttachments(normalized, process.platform)
        if (changed()) return
        // A paste's own text edits must not cancel a submit waiting on that paste.
        applyingPaste = true
        try {
          files?.forEach((file) => {
            if (file.type === "file") {
              pasteAttachment(file)
              return
            }
            target.insertText(file.content)
          })
          if (!files) target.insertText(normalized)
        } finally {
          applyingPaste = false
        }
        hide()
        syncDraft()
        target.getLayoutNode().markDirty()
        renderer.requestRender()
        scheduleRows()
      })
      .catch((error) => {
        revision += 1
        if (!disposed) input.onStatus(errorMessage(error))
      })
      .finally(() => {
        if (pasteQueue === next) pasteQueue = undefined
      })
    pasteQueue = next
    return next
  }

  const onPaste = (event: PasteEvent) => {
    event.preventDefault()
    return paste(event.bytes.length ? decodePasteBytes(event.bytes) : undefined)
  }

  const push = (value: RunPrompt) => {
    history = pushPromptHistory(history, value)
  }

  const move = (dir: -1 | 1, event: KeyEvent) => {
    if (!area || area.isDestroyed) {
      return false
    }

    if (history.index === null && dir === -1) {
      stash = promptCopy(draft)
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

    const endOffset = stringWidth(area.plainText)
    if (dir === -1) {
      if (area.cursorOffset === 0) return false
      if (area.visualCursor.visualRow === 0) {
        area.cursorOffset = 0
        return
      }
      area.moveCursorUp()
      return
    }

    const end =
      typeof area.height === "number" && Number.isFinite(area.height) && area.height > 0
        ? area.height - 1
        : Math.max(0, (area.virtualLineCount ?? 1) - 1)
    if (area.cursorOffset === endOffset) return false
    if (area.visualCursor.visualRow === end) {
      area.cursorOffset = endOffset
      return
    }
    area.moveCursorDown()
  }

  const requestExit = () => {
    const text = area && !area.isDestroyed ? area.plainText : draft.text
    revision += 1
    if (input.prompt() && (text.length > 0 || draft.parts.some((part) => part.type === "file"))) {
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
    const startOffset = at()
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

    const current = promptCopy(draft)
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

  const select = (item?: PromptOption, delivery: RunDelivery = "steer") => {
    const next = item ?? options()[menu.selected()]
    if (!next || !area || area.isDestroyed) {
      return
    }

    if (next.kind === "skill") {
      if (parts.some((part) => part.type === "skill" && part.id === next.id)) {
        cancelAutocomplete()
        return
      }
      const cursor = area.cursorOffset
      const tail = displayCharAt(area.plainText, cursor)
      const append = `/${next.id}${tail === " " ? "" : " "}`
      area.cursorOffset = at()
      const start = area.logicalCursor
      area.cursorOffset = cursor
      const end = area.logicalCursor
      area.deleteRange(start.row, start.col, end.row, end.col)
      area.insertText(append)

      const text = `/${next.id}`
      const startOffset = at()
      const endOffset = startOffset + stringWidth(text)
      const part: Extract<RunPromptPart, { type: "skill" }> = {
        type: "skill",
        id: next.id,
        source: { start: startOffset, end: endOffset, value: text },
      }
      const id = area.extmarks.create({ start: startOffset, end: endOffset, virtual: true, typeId: type })
      marks.set(id, parts.length)
      parts.push(part)
      hide()
      syncDraft()
      scheduleRows()
      area.focus()
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

      if (next.action === "settings" && !shell()) {
        cancelAutocomplete()
        input.onSettings()
        return
      }

      const cursor = area.cursorOffset
      const head = parseSlashHead(area.plainText)
      const local = !shell() && (next.name === "new" || next.name === "exit")
      const separator = !shell() && !local && head && /\s/.test(area.plainText[head.end] ?? "") ? "" : " "
      const text = `/${next.name}${separator}`

      area.cursorOffset = 0
      const start = area.logicalCursor
      area.cursorOffset =
        shell() || !head ? cursor : local ? stringWidth(area.plainText) : stringWidth(area.plainText.slice(0, head.end))
      const end = area.logicalCursor

      area.deleteRange(start.row, start.col, end.row, end.col)
      area.insertText(text)
      area.cursorOffset = stringWidth(text)
      hide()
      syncDraft()
      if (!shell()) {
        submitPrompt(promptCopy(draft), delivery)
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
    const endOffset = startOffset + stringWidth(text)
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
    if (current === "settings") return false
    if (current === "queued-menu") return false
    if (current === "subagent-menu") return false
    return true
  }

  Keymap.createLayer(() => ({
    enabled: baseBindingsEnabled(),
    commands: [
      {
        id: "prompt.clear",
        title: "Clear prompt or exit",
        group: "Prompt",
        run() {
          if (requestExit()) return
          return false
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: input.prompt(),
    commands: [
      {
        id: "prompt.paste",
        title: "Paste",
        group: "Prompt",
        run: () => paste(),
      },
      {
        id: "session.interrupt",
        title: "Interrupt session",
        group: "Session",
        run() {
          if (input.onInterrupt()) return
          return false
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    priority: 1,
    enabled: input.prompt() && (!visible() || mode() === "slash"),
    commands: [
      {
        id: "prompt.queue",
        title: "Queue prompt",
        group: "Prompt",
        palette: true,
        run() {
          onSubmit("queue")
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    priority: 1,
    enabled: input.prompt() && !visible(),
    commands: [
      {
        id: "prompt.editor",
        title: "Open editor",
        group: "Prompt",
        run() {
          void openEditor()
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    priority: 1,
    enabled: input.prompt() && !visible(),
    commands: [
      {
        id: "prompt.history.previous",
        title: "Previous prompt history",
        group: "Prompt",
        run(_input: string | undefined, event?: KeyEvent) {
          if (!event) return false
          return historyCommand(-1, event)
        },
      },
      {
        id: "prompt.history.next",
        title: "Next prompt history",
        group: "Prompt",
        run(_input: string | undefined, event?: KeyEvent) {
          if (!event) return false
          return historyCommand(1, event)
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: input.prompt() && !visible(),
    commands: [
      {
        bind: "!",
        title: "Shell mode",
        group: "Prompt",
        run() {
          if (shell()) return false
          if (!area || area.isDestroyed) return false
          if (area.cursorOffset !== 0) return false
          setShellMode(true)
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: input.prompt() && shell() && !visible(),
    commands: [
      {
        bind: "escape",
        title: "Exit shell mode",
        group: "Prompt",
        run: () => setShellMode(false),
      },
      {
        bind: "backspace",
        title: "Exit shell mode",
        group: "Prompt",
        run() {
          if (!area || area.isDestroyed) return false
          if (area.cursorOffset !== 0) return false
          setShellMode(false)
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    enabled: input.prompt() && visible(),
    commands: [
      {
        id: "prompt.autocomplete.prev",
        title: "Previous autocomplete item",
        group: "Autocomplete",
        run: () => menu.move(-1),
      },
      {
        id: "prompt.autocomplete.next",
        title: "Next autocomplete item",
        group: "Autocomplete",
        run: () => menu.move(1),
      },
      {
        id: "prompt.autocomplete.hide",
        title: "Hide autocomplete",
        group: "Autocomplete",
        run: cancelAutocomplete,
      },
      {
        id: "prompt.autocomplete.select",
        title: "Select autocomplete item",
        group: "Autocomplete",
        run() {
          if (mode() === "slash" && options().length === 0) {
            hide()
            return
          }
          select()
        },
      },
      {
        id: "prompt.autocomplete.complete",
        title: "Complete autocomplete item",
        group: "Autocomplete",
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
  }))

  const onKeyDown = (event: KeyEvent) => {
    if (input.state().phase === "idle" && event.name.toLowerCase() === "escape") {
      input.onInputClear()
    }
  }

  let submitting = false
  const submitPrompt = (next: RunPrompt, delivery: RunDelivery = "steer") => {
    if (!area || area.isDestroyed) {
      draft = promptCopy(next)
    }

    if (visible()) {
      if (mode() !== "slash" || options().length > 0) {
        select(undefined, delivery)
        return
      }

      hide()
    }

    if (submitting) return

    if (!next.text.trim() && !next.parts.some((part) => part.type === "file")) {
      const queued = delivery === "steer" ? input.queuedPrompts()[0] : undefined
      if (queued) {
        submitting = true
        void input.onQueuedPromptSteer(queued.messageID).finally(() => {
          submitting = false
        })
        return
      }
      input.onStatus(input.state().phase === "running" ? "waiting for current response" : "empty prompt ignored")
      return
    }

    const command = next.mode === "shell" ? undefined : selectedCommand(next.text, next.command)
    if (
      delivery === "queue" &&
      (next.mode === "shell" ||
        command?.source === "skill" ||
        isNewCommand(next.text) ||
        isCompactCommand(next.text) ||
        isExitCommand(next.text) ||
        next.text.trim().toLowerCase() === "/settings")
    ) {
      input.onStatus("this prompt cannot be queued")
      return
    }
    if (!command && next.mode !== "shell" && isExitCommand(next.text)) {
      input.onExit()
      return
    }

    if (!command && next.mode !== "shell" && next.text.trim().toLowerCase() === "/settings") {
      resetDraft()
      input.onSettings()
      return
    }

    const parsed =
      command || next.parts.some((part) => part.type === "skill") || next.mode === "shell" || isNewCommand(next.text)
        ? undefined
        : parseSlashCommand(next.text, input.commands())
    if (parsed?.type === "pending") {
      input.onStatus("loading commands")
      return
    }

    const submit = command
      ? { ...next, command, delivery }
      : parsed?.type === "command"
        ? { ...next, command: parsed.command, delivery }
        : { ...next, delivery }
    const shellMode = next.mode === "shell"

    submitting = true
    resetDraft()
    queueMicrotask(async () => {
      try {
        if (await input.onSubmit(submit)) {
          push(next)
          if (shellMode) {
            setShellMode(false)
            draft = emptyPrompt(false)
          }
          return
        }
        restore(next)
      } finally {
        submitting = false
      }
    })
  }

  const onSubmit = (delivery: RunDelivery = "steer") => {
    if (pasteQueue) {
      const before = revision
      void pasteQueue.then(() => {
        if (revision === before) onSubmit(delivery)
      })
      return
    }
    if (disposed || !input.prompt()) return
    syncDraft()
    submitPrompt(promptCopy(draft), delivery)
  }

  const submitText = (text: string) => {
    submitPrompt({ text, parts: [] })
  }

  onCleanup(() => {
    disposed = true
    void clipboard?.dispose().catch(() => {})
    if (area && !area.isDestroyed) {
      area.off("line-info-change", scheduleRows)
    }
  })

  createEffect(() => {
    setStatusRows(input.statusRows())
  })

  createEffect(() => {
    input.width()
    layout()
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
    images,
    layout,
    requestExit,
    onSubmit: () => onSubmit(),
    submitText,
    openEditor,
    onKeyDown,
    onPaste,
    onContentChange: () => {
      if (!applyingPaste && area && area.plainText !== draft.text) revision += 1
      input.onInputClear()
      syncDraft()
      refresh()
      scheduleRows()
    },
    onSizeChange: scheduleRows,
    replacePrompt: restore,
    bind,
  }
}
