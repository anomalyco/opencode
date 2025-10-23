import { TextAttributes, BoxRenderable, TextareaRenderable, MouseEvent, KeyEvent } from "@opentui/core"
import { createEffect, createMemo, Match, Switch, type JSX } from "solid-js"
import { useLocal } from "@tui/context/local"
import { Theme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { iife } from "@/util/iife"
import { useCommandDialog } from "../dialog-command"
import { useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
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

  command.register(() => {
    return [
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        onSelect: async (dialog) => {
          dialog.clear()
          const value = input.value
          input.value = ""
          setStore("prompt", {
            input: "",
            parts: [],
          })
          const content = await Editor.open({ value, renderer })
          if (content) {
            setStore("prompt", {
              input: content,
              parts: [],
            })
            console.log("editor.open", content, Bun.stringWidth(content))
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
          setStore("prompt", {
            input: "",
            parts: [],
          })
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
          submit()
          dialog.clear()
        },
      },
    ]
  })

  sdk.event.on("tui.prompt.append", (evt) => {
    setStore(
      "prompt",
      produce((draft) => {
        draft.input += evt.properties.text
      }),
    )
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = Theme.backgroundElement
    if (!props.disabled) input.cursorColor = Theme.primary
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
  }>({
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
  })

  createEffect(() => {
    input.focus()
  })

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
      setStore("prompt", prompt)
      console.log("prompt.set", prompt.input, Bun.stringWidth(prompt.input))
      input.cursorOffset = Bun.stringWidth(prompt.input)
    },
    reset() {
      setStore("prompt", {
        input: "",
        parts: [],
      })
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
    const input = store.prompt.input
    if (store.mode === "shell") {
      sdk.client.session.shell({
        path: {
          id: sessionID,
        },
        body: {
          agent: local.agent.current().name,
          command: input,
        },
      })
      setStore("mode", "normal")
    } else if (input.startsWith("/")) {
      const [command, ...args] = input.split(" ")
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
              text: input,
            },
            ...store.prompt.parts.map((x) => ({
              id: Identifier.ascending("part"),
              ...x,
            })),
          ],
        },
      })
    }
    history.append(store.prompt)
    setStore("prompt", {
      input: "",
      parts: [],
    })
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
  }
  const exit = useExit()

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
          console.log("setPrompt", store.prompt.input, Bun.stringWidth(store.prompt.input))
          input.cursorOffset = Bun.stringWidth(store.prompt.input)
        }}
        value={store.prompt.input}
      />
      <box ref={(r) => (anchor = r)}>
        <box
          flexDirection="row"
          {...SplitBorder}
          borderColor={keybind.leader ? Theme.accent : store.mode === "shell" ? Theme.secondary : undefined}
          justifyContent="space-evenly"
        >
          <box
            backgroundColor={Theme.backgroundElement}
            width={3}
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <text attributes={TextAttributes.BOLD} fg={Theme.primary}>
              {store.mode === "normal" ? ">" : "!"}
            </text>
          </box>
          <box paddingTop={1} paddingBottom={1} backgroundColor={Theme.backgroundElement} flexGrow={1}>
            <textarea
              onContentChange={() => {
                const value = input.value
                let diff = value.length - store.prompt.input.length
                setStore(
                  produce((draft) => {
                    draft.prompt.input = value
                    for (let i = 0; i < draft.prompt.parts.length; i++) {
                      const part = draft.prompt.parts[i]
                      if (!part.source) continue
                      const source = part.type === "agent" ? part.source : part.source.text
                      if (source.start >= input.visualCursor.offset) {
                        source.start += diff
                        source.end += diff
                      }
                      const sliced = draft.prompt.input.slice(source.start, source.end)
                      if (sliced != source.value && diff < 0) {
                        diff -= source.value.length
                        draft.prompt.input =
                          draft.prompt.input.slice(0, source.start) + draft.prompt.input.slice(source.end)
                        draft.prompt.parts.splice(i, 1)
                        console.log(
                          "onContentChange setting cursor offset",
                          value,
                          input.visualCursor.offset,
                          source.start,
                          source.end,
                        )
                        input.cursorOffset = Math.max(0, source.start - 1)
                        i--
                      }
                    }
                  }),
                )
                autocomplete.onInput(value)
              }}
              value={store.prompt.input}
              onKeyDown={async (e: KeyEvent) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
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
                if (!autocomplete.visible && input.visualCursor.offset === 0) {
                  if (e.name === "up" || e.name === "down") {
                    const direction = e.name === "up" ? -1 : 1
                    const item = history.move(direction, input.value)
                    if (item) {
                      setStore("prompt", item)
                      input.cursorPosition = item.input.length
                      e.preventDefault()
                    }
                    return
                  }
                }
                if (!autocomplete.visible) {
                  if (e.name === "escape" && props.sessionID) {
                    sdk.client.session.abort({
                      path: {
                        id: props.sessionID,
                      },
                    })
                    return
                  }
                }
                const old = input.visualCursor.offset
                setTimeout(() => {
                  const position = input.visualCursor.offset
                  const direction = Math.sign(old - position)
                  for (const part of store.prompt.parts) {
                    const source = iife(() => {
                      if (part.type === "agent") return part.source
                      if (part.type === "file") return part.source?.text
                      return
                    })
                    if (source) {
                      if (position >= source.start && position < source.end) {
                        if (direction === 1) {
                          console.log("onKeyDown setting cursor offset", source.start - 1)
                          input.cursorOffset = Math.max(0, source.start - 1)
                        }
                        if (direction === -1) {
                          console.log("onKeyDown setting cursor offset", source.end)
                          input.cursorOffset = source.end
                        }
                      }
                    }
                  }
                }, 0)
              }}
              onSubmit={submit}
              ref={(r: TextareaRenderable) => (input = r)}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={Theme.backgroundElement}
              cursorColor={Theme.primary}
              backgroundColor={Theme.backgroundElement}
            />
          </box>
          <box backgroundColor={Theme.backgroundElement} width={1} justifyContent="center" alignItems="center"></box>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text flexShrink={0} wrapMode="none">
            <span style={{ fg: Theme.textMuted }}>{local.model.parsed().provider}</span>{" "}
            <span style={{ bold: true }}>{local.model.parsed().model}</span>
          </text>
          <Switch>
            <Match when={status() === "compacting"}>
              <text fg={Theme.textMuted}>compacting...</text>
            </Match>
            <Match when={status() === "working"}>
              <box flexDirection="row" gap={1}>
                <text>
                  esc <span style={{ fg: Theme.textMuted }}>interrupt</span>
                </text>
              </box>
            </Match>
            <Match when={props.hint}>{props.hint!}</Match>
            <Match when={true}>
              <text>
                ctrl+p <span style={{ fg: Theme.textMuted }}>commands</span>
              </text>
            </Match>
          </Switch>
        </box>
      </box>
    </>
  )
}
