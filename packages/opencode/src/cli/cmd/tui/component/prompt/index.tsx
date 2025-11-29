import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, t, dim, fg, type KeyBinding } from "@opentui/core"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
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
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { createColors, createFrames } from "../../ui/spinner.ts"

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
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

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const status = createMemo(() => sync.data.session_status[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()

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
  let promptPartTypeId: number

  command.register(() => {
    return [
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        onSelect: async (dialog, trigger) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = trigger === "prompt" ? "" : text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content, { history: false })

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        disabled: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        disabled: true,
        keybind: "input_submit",
        category: "Prompt",
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        disabled: true,
        keybind: "input_paste",
        category: "Prompt",
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        disabled: status().type === "idle",
        category: "Session",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              path: {
                id: props.sessionID,
              },
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
    ]
  })

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    input.insertText(evt.properties.text)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.primary
  })

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
          agent: local.agent.current().name,
          model: {
            providerID: local.model.current().providerID,
            modelID: local.model.current().modelID,
          },
          command: inputText,
        },
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      iife(() => {
        const command = inputText.split(" ")[0].slice(1)
        console.log(command)
        return sync.data.command.some((x) => x.name === command)
      })
    ) {
      let [command, ...args] = inputText.split(" ")
      sdk.client.session.command({
        path: {
          id: sessionID,
        },
        body: {
          command: command.slice(1),
          arguments: args.join(" "),
          agent: local.agent.current().name,
          model: `${local.model.current().providerID}/${local.model.current().modelID}`,
          messageID,
        },
      })
    } else {
      sdk.client.session.prompt({
        path: {
          id: sessionID,
        },
        body: {
          ...local.model.current(),
          messageID,
          agent: local.agent.current().name,
          model: local.model.current(),
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

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file").length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
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
        path: file.filename ?? "",
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

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.25,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.25,
      }),
    }
  })

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
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={props.sessionID ? undefined : "Build anything..."}
              textColor={theme.text}
              focusedTextColor={theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
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

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const file = Bun.file(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (file.type === "image/svg+xml") {
                      event.preventDefault()
                      const content = await file.text().catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${file.name ?? "image"}]`)
                        return
                      }
                    }
                    if (file.type.startsWith("image/")) {
                      event.preventDefault()
                      const content = await file
                        .arrayBuffer()
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteImage({
                          filename: file.name,
                          mime: file.type,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                setTimeout(() => {
                  input.cursorColor = highlight()
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={highlight()}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <text flexShrink={0} fg={theme.text}>
                    {local.model.parsed().model}
                  </text>
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            // when the background is transparent, don't draw the vertical line
            vertical: theme.background.a != 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.background.a != 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={<text />}>
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                <box flexDirection="row" gap={1} flexShrink={0}>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 50) return r.message.slice(0, 50) + "..."
                      return r.message
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    return (
                      <Show when={retry()}>
                        <text fg={theme.error}>
                          {message()} [retrying {seconds() > 0 ? `in ${seconds()}s ` : ""}
                          attempt #{retry()!.attempt}]
                        </text>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                  {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <Switch>
                <Match when={store.mode === "normal"}>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>switch agent</span>
                  </text>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
