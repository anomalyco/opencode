import {
  TextAttributes,
  BoxRenderable,
  TextareaRenderable,
  MouseEvent,
  KeyEvent,
  PasteEvent,
  t,
  dim,
  fg,
} from "@opentui/core"
import { createEffect, createMemo, Match, Switch, type JSX, onMount, batch } from "solid-js"
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
  const status = createMemo(() => (props.sessionID ? sync.session.status(props.sessionID) : "idle"))
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
    ]
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
          const value = trigger === "prompt" ? "" : input.plainText
          const content = await Editor.open({ value, renderer })
          if (content) {
            input.setText(content, { history: false })
            setStore("prompt", {
              input: content,
              parts: [],
            })
            input.cursorOffset = Bun.stringWidth(content)
          }
        },
      },
      {
        title: "Clear prompt",
        value: "prompt.clear",
        disabled: true,
        category: "Prompt",
        onSelect: (dialog) => {
          input.extmarks.clear()
          setStore("prompt", {
            input: "",
            parts: [],
          })
          setStore("extmarkToPartIndex", new Map())
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
    ]
  })

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    setStore(
      "prompt",
      produce((draft) => {
        draft.input += evt.properties.text
      }),
    )
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.primary
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
  }>({
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
  })

  createEffect(() => {
    input.focus()
  })

  local.setInitialPrompt.listen((initialPrompt) => {
    batch(() => {
      setStore("prompt", {
        input: initialPrompt,
        parts: [],
      })
      input.insertText(initialPrompt)
    })
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
    const sortedExtmarks = allExtmarks.sort(
      (a: { start: number }, b: { start: number }) => b.start - a.start,
    )

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
          command: inputText,
        },
      })
      setStore("mode", "normal")
    } else if (inputText.startsWith("/")) {
      const [command, ...args] = inputText.split(" ")
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
          borderColor={
            keybind.leader ? theme.accent : store.mode === "shell" ? theme.secondary : theme.border
          }
          justifyContent="space-evenly"
        >
          <box
            backgroundColor={theme.backgroundElement}
            width={3}
            height="100%"
            alignItems="center"
            paddingTop={1}
          >
            <text attributes={TextAttributes.BOLD} fg={theme.primary}>
              {store.mode === "normal" ? ">" : "!"}
            </text>
          </box>
          <box
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
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
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e: KeyEvent) => {
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
                  if (
                    (e.name === "backspace" && input.visualCursor.offset === 0) ||
                    e.name === "escape"
                  ) {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) &&
                      input.cursorOffset === input.plainText.length)
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

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0)
                    input.cursorOffset = 0
                  if (
                    keybind.match("history_next", e) &&
                    input.visualCursor.visualRow === input.height - 1
                  )
                    input.cursorOffset = input.plainText.length
                }
                if (!autocomplete.visible) {
                  if (keybind.match("session_interrupt", e) && props.sessionID) {
                    sdk.client.session.abort({
                      path: {
                        id: props.sessionID,
                      },
                    })
                    return
                  }
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                const pastedContent = event.text.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                console.log(pastedContent, filepath)
                try {
                  const file = Bun.file(filepath)
                  if (file.type.startsWith("image/")) {
                    event.preventDefault()
                    const content = await file
                      .arrayBuffer()
                      .then((buffer) => Buffer.from(buffer).toString("base64"))
                      .catch(console.error)
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

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (lineCount >= 5) {
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
          <box
            backgroundColor={theme.backgroundElement}
            width={1}
            justifyContent="center"
            alignItems="center"
          ></box>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text flexShrink={0} wrapMode="none" fg={theme.text}>
            <span style={{ fg: theme.textMuted }}>{local.model.parsed().provider}</span>{" "}
            <span style={{ bold: true }}>{local.model.parsed().model}</span>
          </text>
          <Switch>
            <Match when={status() === "compacting"}>
              <text fg={theme.textMuted}>compacting...</text>
            </Match>
            <Match when={status() === "working"}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  esc <span style={{ fg: theme.textMuted }}>interrupt</span>
                </text>
              </box>
            </Match>
            <Match when={props.hint}>{props.hint!}</Match>
            <Match when={true}>
              <text fg={theme.text}>
                {keybind.print("command_list")}{" "}
                <span style={{ fg: theme.textMuted }}>commands</span>
              </text>
            </Match>
          </Switch>
        </box>
      </box>
    </>
  )
}
