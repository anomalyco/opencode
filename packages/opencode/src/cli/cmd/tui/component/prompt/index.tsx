import { InputRenderable, TextAttributes, BoxRenderable } from "@opentui/core"
import { createEffect, createMemo, Match, Switch } from "solid-js"
import { useLocal } from "@tui/context/local"
import { Theme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { Clipboard } from "@/util/clipboard"
import { usePromptHistory, type PromptInfo } from "./history"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { iife } from "@/util/iife"

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
}

export type PromptRef = {
  focused: boolean
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
}

export function Prompt(props: PromptProps) {
  let input: InputRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const status = createMemo(() => (props.sessionID ? sync.session.status(props.sessionID) : "idle"))
  const history = usePromptHistory()

  createEffect(() => {
    if (props.disabled) input.cursorColor = Theme.backgroundElement
    if (!props.disabled) input.cursorColor = Theme.primary
  })

  const [store, setStore] = createStore<PromptInfo>({
    input: "",
    parts: [],
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
      setStore(prompt)
      input.cursorPosition = prompt.input.length
    },
    reset() {
      setStore({
        input: "",
        parts: [],
      })
    },
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore(produce(cb))
          input.cursorPosition = store.input.length
        }}
        value={store.input}
      />
      <box ref={(r) => (anchor = r)}>
        <box flexDirection="row" {...SplitBorder} borderColor={keybind.leader ? Theme.accent : undefined}>
          <box backgroundColor={Theme.backgroundElement} width={3} justifyContent="center" alignItems="center">
            <text attributes={TextAttributes.BOLD} fg={Theme.primary}>
              {">"}
            </text>
          </box>
          <box paddingTop={1} paddingBottom={2} backgroundColor={Theme.backgroundElement} flexGrow={1}>
            <input
              onPaste={async function (text) {
                const content = await Clipboard.read()
                if (!content) {
                  this.insertText(text)
                }
              }}
              onInput={(value) => {
                let diff = value.length - store.input.length
                setStore(
                  produce((draft) => {
                    draft.input = value
                    for (let i = 0; i < draft.parts.length; i++) {
                      const part = draft.parts[i]
                      if (!part.source) continue
                      const source = part.type === "agent" ? part.source : part.source.text
                      if (source.start >= input.cursorPosition) {
                        source.start += diff
                        source.end += diff
                      }
                      const sliced = draft.input.slice(source.start, source.end)
                      if (sliced != source.value && diff < 0) {
                        diff -= source.value.length
                        draft.input = draft.input.slice(0, source.start) + draft.input.slice(source.end)
                        draft.parts.splice(i, 1)
                        input.cursorPosition = Math.max(0, source.start - 1)
                        i--
                      }
                    }
                  }),
                )
                autocomplete.onInput(value)
              }}
              value={store.input}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (e.name === "up" || e.name === "down") {
                    const direction = e.name === "up" ? -1 : 1
                    const item = history.move(direction)
                    setStore(item)
                    input.cursorPosition = item.input.length
                    return
                  }
                  if (e.name === "escape" && props.sessionID) {
                    sdk.session.abort({
                      path: {
                        id: props.sessionID,
                      },
                    })
                    return
                  }
                }
                const old = input.cursorPosition
                setTimeout(() => {
                  const position = input.cursorPosition
                  const direction = Math.sign(old - position)
                  for (const part of store.parts) {
                    const source = iife(() => {
                      if (part.type === "agent") return part.source
                      if (part.type === "file") return part.source?.text
                      return
                    })
                    if (source) {
                      if (position >= source.start && position < source.end) {
                        if (direction === 1) {
                          input.cursorPosition = Math.max(0, source.start - 1)
                        }
                        if (direction === -1) {
                          input.cursorPosition = source.end
                        }
                      }
                    }
                  }
                }, 0)
              }}
              onSubmit={async () => {
                if (props.disabled) return
                if (autocomplete.visible) return
                if (!store.input) return
                const sessionID = props.sessionID
                  ? props.sessionID
                  : await (async () => {
                      const sessionID = await sdk.session.create({}).then((x) => x.data!.id)
                      route.navigate({
                        type: "session",
                        sessionID,
                      })
                      return sessionID
                    })()
                const messageID = Identifier.ascending("message")
                const input = store.input
                if (input.startsWith("/")) {
                  const [command, ...args] = input.split(" ")
                  sdk.session.command({
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
                  setStore({
                    input: "",
                    parts: [],
                  })
                  props.onSubmit?.()
                  return
                }
                const parts = store.parts
                history.append(store)
                setStore(
                  produce((draft) => {
                    draft.input = ""
                    draft.parts = []
                  }),
                )
                sdk.session.prompt({
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
                      ...parts.map((x) => ({
                        id: Identifier.ascending("part"),
                        ...x,
                      })),
                    ],
                  },
                })
                props.onSubmit?.()
              }}
              ref={(r) => (input = r)}
              onMouseDown={(r) => r.target?.focus()}
              focusedBackgroundColor={Theme.backgroundElement}
              cursorColor={Theme.primary}
              backgroundColor={Theme.backgroundElement}
            />
          </box>
          <box backgroundColor={Theme.backgroundElement} width={1} justifyContent="center" alignItems="center"></box>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text flexShrink={0} wrap={false}>
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
