import { InputRenderable, TextAttributes, BoxRenderable } from "@opentui/core"
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
  const command = useCommandDialog()
  const renderer = useRenderer()

  command.register(() => {
    return [
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        onSelect: async () => {
          renderer.suspend()
          // asni code to clear
          /* @ts-ignore */
          // renderer.writeOut("\x1b[2J\x1b[H")
          renderer.currentRenderBuffer.clear()
          const proc = Bun.spawn({
            cmd: ["nvim"],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          })
          await proc.exited
          renderer.resume()
          renderer.requestRender()
        },
      },
    ]
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
      input.cursorPosition = prompt.input.length
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
          const sessionID = await sdk.session.create({}).then((x) => x.data!.id)
          route.navigate({
            type: "session",
            sessionID,
          })
          return sessionID
        })()
    const messageID = Identifier.ascending("message")
    const input = store.prompt.input
    if (store.mode === "shell") {
      sdk.session.shell({
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
      setStore("prompt", {
        input: "",
        parts: [],
      })
      return
    } else {
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
          input.cursorPosition = store.prompt.input.length
        }}
        value={store.prompt.input}
      />
      <box ref={(r) => (anchor = r)}>
        <box
          flexDirection="row"
          {...SplitBorder}
          borderColor={keybind.leader ? Theme.accent : store.mode === "shell" ? Theme.secondary : undefined}
        >
          <box backgroundColor={Theme.backgroundElement} width={3} justifyContent="center" alignItems="center">
            <text attributes={TextAttributes.BOLD} fg={Theme.primary}>
              {store.mode === "normal" ? ">" : "!"}
            </text>
          </box>
          <box paddingTop={1} paddingBottom={2} backgroundColor={Theme.backgroundElement} flexGrow={1}>
            <input
              onPaste={async function (text) {
                this.insertText(text)
              }}
              onInput={(value) => {
                let diff = value.length - store.prompt.input.length
                setStore(
                  produce((draft) => {
                    draft.prompt.input = value
                    for (let i = 0; i < draft.prompt.parts.length; i++) {
                      const part = draft.prompt.parts[i]
                      if (!part.source) continue
                      const source = part.type === "agent" ? part.source : part.source.text
                      if (source.start >= input.cursorPosition) {
                        source.start += diff
                        source.end += diff
                      }
                      const sliced = draft.prompt.input.slice(source.start, source.end)
                      if (sliced != source.value && diff < 0) {
                        diff -= source.value.length
                        draft.prompt.input =
                          draft.prompt.input.slice(0, source.start) + draft.prompt.input.slice(source.end)
                        draft.prompt.parts.splice(i, 1)
                        input.cursorPosition = Math.max(0, source.start - 1)
                        i--
                      }
                    }
                  }),
                )
                autocomplete.onInput(value)
              }}
              value={store.prompt.input}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                if (e.name === "!" && input.cursorPosition === 0) {
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.cursorPosition === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (e.name === "up" || e.name === "down") {
                    const direction = e.name === "up" ? -1 : 1
                    const item = history.move(direction)
                    setStore("prompt", item)
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
                  for (const part of store.prompt.parts) {
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
              onSubmit={submit}
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
