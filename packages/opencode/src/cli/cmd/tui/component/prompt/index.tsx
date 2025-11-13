import {
  TextAttributes,
  BoxRenderable,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  t,
  dim,
  fg,
  type KeyBinding,
} from "@opentui/core"
import { createEffect, createMemo, Match, Switch, Show, type JSX, onMount, batch } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@opencode-ai/sdk"
import { TuiEvent } from "../../event"
import { DialogModel } from "../dialog-model"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Perf } from "@/util/perf"
import path from "path"

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
  onScrollToBottom?: () => void
}

export type PromptRef = {
  focused: boolean
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef
  let promptPartTypeId: number

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const status = createMemo(() => (props.sessionID ? sync.session.status(props.sessionID) : "idle"))
  const history = usePromptHistory()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  let aborting = false
  let dropProcessing = false

  const textareaKeybindings = createMemo(() => {
    const newlineBindings = keybind.all.input_newline || []
    const submitBindings = keybind.all.input_submit || []

    return [
      { name: "return", action: "submit" },
      { name: "return", meta: true, action: "newline" },
      ...newlineBindings.map((binding) => ({
        name: binding.name,
        ctrl: binding.ctrl || undefined,
        meta: binding.meta || undefined,
        shift: binding.shift || undefined,
        action: "newline" as const,
      })),
      ...submitBindings.map((binding) => ({
        name: binding.name,
        ctrl: binding.ctrl || undefined,
        meta: binding.meta || undefined,
        shift: binding.shift || undefined,
        action: "submit" as const,
      })),
    ] satisfies KeyBinding[]
  })

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!

  const stopSession = async () => {
    if (status() !== "working") return
    if (!props.sessionID) return
    if (aborting) return
    aborting = true
    try {
      await sdk.client.session.abort({
        path: {
          id: props.sessionID,
        },
      })
    } catch (error) {
      console.error("[Prompt] Failed to stop session", error)
      toast.show({ message: "Failed to stop session", variant: "error" })
    } finally {
      aborting = false
    }
  }

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
  }>({
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  createEffect(() => {
    input.focus()
  })

  onMount(() => {
    promptPartTypeId = input.extmarks.registerType("prompt-part")
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  // Debounced version - delays sync during rapid typing (100ms)
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null
  const trackedSyncExtmarks = Perf.track("syncExtmarksWithPromptParts", syncExtmarksWithPromptParts)
  function syncExtmarksDebounced() {
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer)
    }
    syncDebounceTimer = setTimeout(() => {
      trackedSyncExtmarks()
      syncDebounceTimer = null
    }, 100)
  }

  props.ref?.({
    get focused() {
      return input.focused
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input, { history: false })
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
  })

  async function submit() {
    if (props.disabled) return
    if (autocomplete.visible) return
    if (!store.prompt.input) return
    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) return
    const sessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
          return sessionID
        })()
    const messageID = Identifier.ascending("message")
    let inputText = store.prompt.input

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    if (store.mode === "shell") {
      sdk.client.session.shell({
        path: {
          id: sessionID,
        },
        body: {
          agent: currentAgent.name,
          command: inputText,
        },
      })
      setStore("mode", "normal")
    } else if (inputText.startsWith("/") && nonTextParts.length === 0) {
      const [commandStr, ...args] = inputText.split(" ")
      const commandName = commandStr.slice(1)

      // Handle special /voice command locally
      if (commandName === "voice") {
        command.trigger("livekit.connect")
        input.extmarks.clear()
        setStore("prompt", {
          input: "",
          parts: [],
        })
        setStore("extmarkToPartIndex", new Map())
        props.onSubmit?.()
        input.clear()
        return
      }

      // Handle special /widget_test command to test widget rendering
      if (commandName === "widget_test") {
        sdk.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: "text",
                text: `Testing widget rendering:\n\n<steering-question id="test-widget">\n{\n  "title": "Widget Test",\n  "questions": [\n    {\n      "id": "test-q",\n      "label": "Does this render as a form?",\n      "type": "single-choice",\n      "options": ["Yes", "No"],\n      "required": true\n    }\n  ]\n}\n</steering-question>\n\nIf you see a form above, widgets work. If you see raw JSON, they don't.`,
              },
            ],
          },
        })
        input.extmarks.clear()
        setStore("prompt", {
          input: "",
          parts: [],
        })
        setStore("extmarkToPartIndex", new Map())
        props.onSubmit?.()
        input.clear()
        return
      }

      sdk.client.session.command({
        path: {
          id: sessionID,
        },
        body: {
          command: commandName,
          arguments: args.join(" "),
          agent: currentAgent.name,
          model: `${currentModel.providerID}/${currentModel.modelID}`,
          messageID,
        },
      })
    } else {
      sdk.client.session.prompt({
        path: {
          id: sessionID,
        },
        body: {
          ...currentModel,
          messageID,
          agent: currentAgent.name,
          model: currentModel,
          parts: [
            {
              id: Identifier.ascending("part"),
              type: "text",
              text: inputText,
            },
            ...nonTextParts.map((x) => ({
              id: Identifier.ascending("part"),
              ...x,
            })),
          ],
        },
      })
    }
    history.append(store.prompt)
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
  }
  const exit = useExit()

  async function attachFilePart(file: { filename?: string; filepath?: string; content: string; mime: string }) {
    const start = input.visualCursor.offset
    const index = store.prompt.parts.filter((x) => x.type === "file").length + 1
    const label = file.mime.startsWith("image/") ? `Image ${index}` : `File ${index}`
    const virtualText = `[${label}]`
    const end = start + virtualText.length

    input.insertText(`${virtualText} `)

    const extmarkId = input.extmarks.create({
      start,
      end,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filepath ?? file.filename ?? "",
        text: {
          start,
          end,
          value: virtualText,
        },
      },
    }

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  const MIME_HINTS: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  }

  function guessMimeFromPath(filePath: string) {
    const ext = path.extname(filePath).toLowerCase()
    return MIME_HINTS[ext]
  }

  function looksLikePath(value: string) {
    const trimmed = value.trim().replace(/^['"]+|['"]+$/g, "")
    if (!trimmed) return false
    if (trimmed.startsWith("file://")) return true
    if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~/")) {
      return true
    }
    return /^[A-Za-z]:[\\/]/.test(trimmed)
  }

  function extractFilePathCandidates(input: string) {
    const trimmed = input.trim()
    if (!trimmed) return []
    const quoted = [...trimmed.matchAll(/(['"])(.*?)\1/g)]
      .map((match) => match[2])
      .filter((candidate) => looksLikePath(candidate))
    if (quoted.length) {
      return quoted
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length > 1 && lines.every((line) => looksLikePath(line))) {
      return lines
    }

    return looksLikePath(trimmed) ? [trimmed] : []
  }

  function normalizeFilePath(candidate: string) {
    let value = candidate.trim()
    if (!value) return
    value = value.replace(/^['"]+|['"]+$/g, "")
    value = value.replace(/\\ /g, " ")
    if (!value) return

    if (value.startsWith("file://")) {
      try {
        const url = new URL(value)
        let pathname = decodeURIComponent(url.pathname)
        if (/^\/[A-Za-z]:/.test(pathname)) {
          pathname = pathname.slice(1)
        }
        value = pathname || value
      } catch {
        return
      }
    }

    if (value.startsWith("~")) {
      const home = process.env.HOME
      if (home) {
        value = path.join(home, value.slice(1))
      }
    }

    return value
  }

  async function attachFilesFromCandidates(candidates: string[]) {
    let attached = false

    for (const candidate of candidates) {
      const normalized = normalizeFilePath(candidate)
      if (!normalized) continue
      try {
        const bunFile = Bun.file(normalized)
        if (!(await bunFile.exists())) continue
        const buffer = await bunFile.arrayBuffer()
        const mime = bunFile.type || guessMimeFromPath(normalized) || "application/octet-stream"
        await attachFilePart({
          filename: path.basename(normalized),
          filepath: normalized,
          mime,
          content: Buffer.from(buffer).toString("base64"),
        })
        attached = true
      } catch (error) {
        console.warn("[Prompt] Failed to attach file", error)
      }
    }

    return attached
  }

  async function handleDropFileTokens(value: string) {
    if (dropProcessing) return
    const pattern = /(^|\s)([^[]+?)\[(?:Image|File) \d+\]/g
    const matches = [...value.matchAll(pattern)]
    if (!matches.length) return
    dropProcessing = true
    try {
      let updated = value
      let modified = false
      for (const match of matches) {
        const rawPath = match[2]?.trim()
        if (!rawPath) continue
        const attached = await attachFilesFromCandidates([rawPath])
        if (attached) {
          updated = updated.replace(match[0], match[1] ?? "")
          modified = true
        }
      }

      if (modified) {
        const normalized = updated.replace(/\s{2,}/g, " ").trimStart()
        input.setText(normalized, { history: false })
        setStore("prompt", "input", normalized)
        autocomplete.onInput(normalized)
        syncExtmarksDebounced()
        input.cursorOffset = normalized.length
      }
    } finally {
      dropProcessing = false
    }
  }

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)}>
        <box
          flexDirection="row"
          {...SplitBorder}
          borderColor={keybind.leader ? theme.accent : store.mode === "shell" ? theme.secondary : theme.border}
          justifyContent="space-evenly"
        >
          <box backgroundColor={theme.backgroundElement} width={3} height="100%" alignItems="center" paddingTop={1}>
            <text attributes={TextAttributes.BOLD} fg={theme.primary}>
              {store.mode === "normal" ? ">" : "!"}
            </text>
          </box>
          <box paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundElement} flexGrow={1}>
            <textarea
              placeholder={
                props.showPlaceholder
                  ? t`${dim(fg(theme.primary)("  → up/down"))} ${dim(fg("#64748b")("history"))} ${dim(fg("#a78bfa")("•"))} ${dim(fg(theme.primary)(keybind.print("input_newline")))} ${dim(fg("#64748b")("newline"))} ${dim(fg("#a78bfa")("•"))} ${dim(fg(theme.primary)(keybind.print("input_submit")))} ${dim(fg("#64748b")("submit"))}`
                  : undefined
              }
              textColor={theme.text}
              focusedTextColor={theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                let value = input.plainText
                // Filter out mouse wheel escape sequences
                const mouseWheelPattern = /\[<[\d;]+[mM]/g
                if (mouseWheelPattern.test(value)) {
                  value = value.replace(mouseWheelPattern, "")
                  input.setText(value, { history: false })
                  return
                }
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksDebounced() // Use debounced version during typing
                void handleDropFileTokens(value)
              }}
              keyBindings={textareaKeybindings()}
              // TODO: fix this any
              onKeyDown={async (e: any) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("input_forward_delete", e) && store.prompt.input !== "") {
                  const cursorOffset = input.cursorOffset
                  if (cursorOffset < input.plainText.length) {
                    const text = input.plainText
                    const newText = text.slice(0, cursorOffset) + text.slice(cursorOffset + 1)
                    input.setText(newText)
                    input.cursorOffset = cursorOffset
                  }
                  e.preventDefault()
                  return
                }
                if (keybind.match("app_exit", e)) {
                  await exit()
                  return
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input, { history: false })
                      setStore("prompt", item)
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                const rawContent = event.text
                const pastedContent = rawContent.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                const fileCandidates = extractFilePathCandidates(pastedContent)
                if (fileCandidates.length) {
                  event.preventDefault()
                  const attached = await attachFilesFromCandidates(fileCandidates)
                  if (!attached) {
                    input.insertText(rawContent)
                  }
                  return
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  const currentOffset = input.visualCursor.offset
                  const virtualText = `[Pasted ~${lineCount} lines]`
                  const textToInsert = virtualText + " "
                  const extmarkStart = currentOffset
                  const extmarkEnd = extmarkStart + virtualText.length

                  input.insertText(textToInsert)

                  const extmarkId = input.extmarks.create({
                    start: extmarkStart,
                    end: extmarkEnd,
                    virtual: true,
                    styleId: pasteStyleId,
                    typeId: promptPartTypeId,
                  })

                  const part = {
                    type: "text" as const,
                    text: pastedContent,
                    source: {
                      text: {
                        start: extmarkStart,
                        end: extmarkEnd,
                        value: virtualText,
                      },
                    },
                  }

                  setStore(
                    produce((draft) => {
                      const partIndex = draft.prompt.parts.length
                      draft.prompt.parts.push(part)
                      draft.extmarkToPartIndex.set(extmarkId, partIndex)
                    }),
                  )
                  return
                }
              }}
              ref={(r: TextareaRenderable) => (input = r)}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              syntaxStyle={syntax()}
            />
          </box>
          <box backgroundColor={theme.backgroundElement} width={1} justifyContent="center" alignItems="center"></box>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" alignItems="center" gap={1} flexShrink={0} flexWrap="no-wrap">
            <text
              flexShrink={0}
              wrapMode="none"
              fg={theme.text}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                dialog.replace(() => <DialogModel />)
              }}
            >
              {(() => {
                const parsed = local.model.parsed()
                if (!parsed) return <span style={{ fg: theme.textMuted }}>Loading...</span>
                return (
                  <>
                    <span style={{ fg: theme.textMuted }}>{parsed.provider}</span>{" "}
                    <span style={{ bold: true, fg: theme.primary, underline: true }}>{parsed.model}</span>
                  </>
                )
              })()}
            </text>
          </box>
          <Switch>
            <Match when={status() === "compacting"}>
              <text fg={theme.textMuted}>compacting...</text>
            </Match>
            <Match when={status() === "working"}>
              <box flexDirection="row" gap={2} alignItems="center">
                <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                  esc{" "}
                  <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                    {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                  </span>
                </text>
                <text
                  fg={theme.error}
                  onMouseUp={(event) => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    event.stopPropagation()
                    void stopSession()
                  }}
                >
                  <span style={{ fg: theme.error, bold: true }}>■ stop</span>
                </text>
              </box>
            </Match>

            <Match when={props.hint}>{props.hint!}</Match>
            <Match when={true}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.text}>
                  {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                </text>
                {props.onScrollToBottom && (
                  <text
                    fg={theme.accent}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      props.onScrollToBottom?.()
                    }}
                  >
                    Latest ↓
                  </text>
                )}
              </box>
            </Match>
          </Switch>
        </box>
      </box>
    </>
  )
}
