import { InputRenderable, TextAttributes, BoxRenderable, type ParsedKey } from "@opentui/core"
import { createEffect, createMemo, createResource, For, Match, onMount, Show, Switch } from "solid-js"
import { firstBy } from "remeda"
import { useLocal } from "../context/local"
import { Theme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { SplitBorder } from "./border"
import { useSDK } from "../context/sdk"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { Identifier } from "../../../../id/id"
import { createStore, produce } from "solid-js/store"
import type { FilePart } from "@opencode-ai/sdk"
import fuzzysort from "fuzzysort"
import { useCommandDialog } from "./dialog-command"
import { useKeybind } from "../context/keybind"

export type PromptProps = {
  sessionID?: string
}

type Prompt = {
  input: string
  parts: Omit<FilePart, "id" | "messageID" | "sessionID">[]
}

export function Prompt(props: PromptProps) {
  let input: InputRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const dialog = useDialog()
  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const status = createMemo(() => (props.sessionID ? sync.session.status(props.sessionID) : "idle"))

  const [store, setStore] = createStore<Prompt>({
    input: "",
    parts: [],
  })

  createEffect(() => {
    if (dialog.stack.length === 0 && input) input.focus()
    if (dialog.stack.length > 0) input.blur()
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
              onPaste={function (text) {
                this.insertText(text)
              }}
              onInput={(value) => {
                let diff = value.length - store.input.length
                setStore(
                  produce((draft) => {
                    draft.input = value
                    for (let i = 0; i < draft.parts.length; i++) {
                      const part = draft.parts[i]
                      if (!part.source) continue
                      if (part.source.text.start >= input.cursorPosition) {
                        part.source.text.start += diff
                        part.source.text.end += diff
                      }
                      const sliced = draft.input.slice(part.source.text.start, part.source.text.end)
                      if (sliced != part.source.text.value && diff < 0) {
                        diff -= part.source.text.value.length
                        draft.input =
                          draft.input.slice(0, part.source.text.start) + draft.input.slice(part.source.text.end)
                        draft.parts.splice(i, 1)
                        input.cursorPosition = Math.max(0, part.source.text.start - 1)
                        i--
                      }
                    }
                  }),
                )
                autocomplete.onInput(value)
              }}
              value={store.input}
              onKeyDown={(e) => {
                autocomplete.onKeyDown(e)
                const old = input.cursorPosition
                setTimeout(() => {
                  const position = input.cursorPosition
                  const direction = Math.sign(old - position)
                  for (const part of store.parts) {
                    if (part.source && part.source.type === "file") {
                      if (position >= part.source.text.start && position < part.source.text.end) {
                        if (direction === 1) {
                          input.cursorPosition = Math.max(0, part.source.text.start - 1)
                        }
                        if (direction === -1) {
                          input.cursorPosition = part.source.text.end
                        }
                      }
                    }
                  }
                }, 0)
              }}
              onSubmit={async () => {
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
                  return
                }
                const parts = store.parts
                setStore({
                  input: "",
                  parts: [],
                })
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

type AutocompleteRef = {
  onInput: (value: string) => void
  onKeyDown: (e: ParsedKey) => void
  visible: false | "@" | "/"
}

type AutocompleteOption = {
  display: string
  disabled?: boolean
  description?: string
  onSelect?: () => void
}

function Autocomplete(props: {
  value: string
  sessionID?: string
  setPrompt: (input: (prompt: Prompt) => void) => void
  anchor: () => BoxRenderable
  input: () => InputRenderable
  ref: (ref: AutocompleteRef) => void
}) {
  const sdk = useSDK()
  const sync = useSync()
  const command = useCommandDialog()

  const [store, setStore] = createStore({
    index: 0,
    selected: 0,
    visible: false as AutocompleteRef["visible"],
    position: { x: 0, y: 0, width: 0 },
  })
  const filter = createMemo(() => {
    if (!store.visible) return ""
    return props.value.substring(store.index + 1).split(" ")[0]
  })

  const [files] = createResource(
    () => [filter()],
    async () => {
      if (!store.visible) return []
      const result = await sdk.find.files({
        query: {
          query: filter(),
        },
      })
      if (result.error) return []
      return (result.data ?? []).map(
        (item): AutocompleteOption => ({
          display: item,
          onSelect: () => {
            const part: Prompt["parts"][number] = {
              type: "file",
              mime: "text/plain",
              filename: item,
              url: `file://${process.cwd()}/${item}`,
              source: {
                type: "file",
                text: {
                  start: store.index,
                  end: store.index + item.length + 1,
                  value: "@" + item,
                },
                path: item,
              },
            }
            props.setPrompt((draft) => {
              const append = "@" + item + " "
              if (store.index === 0) draft.input = append
              if (store.index > 0) draft.input = draft.input.slice(0, store.index) + append
              draft.parts.push(part)
            })
          },
        }),
      )
    },
    {
      initialValue: [],
    },
  )

  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const commands = createMemo((): AutocompleteOption[] => {
    const results: AutocompleteOption[] = []
    const s = session()
    for (const command of sync.data.command) {
      results.push({
        display: "/" + command.name,
        description: command.description,
        onSelect: () => {
          props.input().value = "/" + command.name + " "
          props.input().cursorPosition = props.input().value.length
        },
      })
    }
    if (s) {
      results.push(
        {
          display: "/undo",
          description: "undo the last message",
          onSelect: () => {},
        },
        {
          display: "/redo",
          description: "redo the last message",
          onSelect: () => {},
        },
        {
          display: "/compact",
          description: "compact the session",
          onSelect: () => command.trigger("session.compact"),
        },
        {
          display: "/share",
          disabled: !!s.share?.url,
          description: "share a session",
          onSelect: () => command.trigger("session.share"),
        },
        {
          display: "/unshare",
          disabled: !s.share,
          description: "unshare a session",
          onSelect: () => command.trigger("session.unshare"),
        },
      )
    }
    results.push(
      {
        display: "/new",
        description: "create a new session",
        onSelect: () => command.trigger("session.new"),
      },
      {
        display: "/models",
        description: "list models",
        onSelect: () => command.trigger("model.list"),
      },
      {
        display: "/agents",
        description: "list agents",
        onSelect: () => command.trigger("agent.list"),
      },
    )
    const max = firstBy(results, [(x) => x.display.length, "desc"])?.display.length
    if (!max) return results
    return results.map((item) => ({
      ...item,
      display: item.display.padEnd(max + 2),
    }))
  })

  const options = createMemo(() => {
    const mixed: AutocompleteOption[] = (store.visible === "@" ? [...files()] : [...commands()]).filter(
      (x) => x.disabled !== true,
    )
    if (!filter()) return mixed
    const result = fuzzysort.go(filter(), mixed, {
      keys: ["display", "description"],
    })
    return result.map((arr) => arr.obj)
  })

  createEffect(() => {
    filter()
    setStore("selected", 0)
  })

  function move(direction: -1 | 1) {
    if (!store.visible) return
    let next = store.selected + direction
    if (next < 0) next = options().length - 1
    if (next >= options().length) next = 0
    setStore("selected", next)
  }

  function select() {
    const selected = options()[store.selected]
    if (!selected) return
    selected.onSelect?.()
    setTimeout(() => hide(), 0)
  }

  function show(mode: "@" | "/") {
    setStore({
      visible: mode,
      index: props.input().cursorPosition,
      position: {
        x: props.anchor().x,
        y: props.anchor().y,
        width: props.anchor().width,
      },
    })
  }

  function hide() {
    if (store.visible === "/" && !props.value.endsWith(" ")) props.input().value = ""
    setStore("visible", false)
  }

  onMount(() => {
    props.ref({
      get visible() {
        return store.visible
      },
      onInput(value: string) {
        if (store.visible && value.length <= store.index) hide()
      },
      onKeyDown(e: ParsedKey) {
        if (store.visible) {
          if (e.name === "up") move(-1)
          if (e.name === "down") move(1)
          if (e.name === "escape") hide()
          if (e.name === "return") select()
        }
        if (!store.visible && e.name === "@") {
          const last = props.value.at(-1)
          if (last === " " || last === undefined) {
            show("@")
          }
        }

        if (!store.visible && e.name === "/") {
          if (props.input().cursorPosition === 0) show("/")
        }
      },
    })
  })

  const height = createMemo(() => {
    if (options().length) return Math.min(10, options().length)
    return 1
  })

  return (
    <box
      visible={store.visible !== false}
      position="absolute"
      top={store.position.y - height()}
      left={store.position.x}
      width={store.position.width}
      zIndex={100}
      {...SplitBorder}
    >
      <box backgroundColor={Theme.backgroundElement} height={height()}>
        <For
          each={options()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text>No matching items</text>
            </box>
          }
        >
          {(option, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() === store.selected ? Theme.primary : undefined}
              flexDirection="row"
            >
              <text fg={index() === store.selected ? Theme.background : Theme.text}>{option.display}</text>
              <Show when={option.description}>
                <text fg={index() === store.selected ? Theme.background : Theme.textMuted}> {option.description}</text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
