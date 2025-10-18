import type { ParsedKey, BoxRenderable, InputRenderable } from "@opentui/core"
import fuzzysort from "fuzzysort"
import { firstBy } from "remeda"
import { createMemo, createResource, createEffect, onMount, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { Theme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { PromptInfo } from "./history"

export type AutocompleteRef = {
  onInput: (value: string) => void
  onKeyDown: (e: ParsedKey) => void
  visible: false | "@" | "/"
}

export type AutocompleteOption = {
  display: string
  disabled?: boolean
  description?: string
  onSelect?: () => void
}

export function Autocomplete(props: {
  value: string
  sessionID?: string
  setPrompt: (input: (prompt: PromptInfo) => void) => void
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
    if (!store.visible) return
    return props.value.substring(store.index + 1).split(" ")[0]
  })

  const [files] = createResource(
    () => [filter()],
    async () => {
      if (!store.visible) return []
      if (store.visible === "/") return []

      // Get files from SDK
      const result = await sdk.client.find.files({
        query: {
          query: filter() ?? "",
        },
      })

      const options: AutocompleteOption[] = []

      // Add file options
      if (!result.error && result.data) {
        options.push(
          ...result.data.map(
            (item): AutocompleteOption => ({
              display: item,
              onSelect: () => {
                const part: PromptInfo["parts"][number] = {
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
          ),
        )
      }

      return options
    },
    {
      initialValue: [],
    },
  )

  const agents = createMemo(() => {
    if (store.index !== 0) return []
    const agents = sync.data.agent
    return agents
      .filter((agent) => !agent.builtIn && agent.mode !== "primary")
      .map(
        (agent): AutocompleteOption => ({
          display: "@" + agent.name,
          onSelect: () => {
            props.setPrompt((draft) => {
              const append = "@" + agent.name + " "
              draft.input = append
              draft.parts.push({
                type: "agent",
                source: {
                  start: store.index,
                  end: store.index + agent.name.length + 1,
                  value: "@" + agent.name,
                },
                name: agent.name,
              })
            })
          },
        }),
      )
  })

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
          onSelect: () => command.trigger("session.undo"),
        },
        {
          display: "/redo",
          description: "redo the last message",
          onSelect: () => command.trigger("session.redo"),
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
      {
        display: "/status",
        description: "show status",
        onSelect: () => command.trigger("opencode.status"),
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
    console.log(agents())
    const mixed: AutocompleteOption[] = (store.visible === "@" ? [...agents(), ...files()] : [...commands()]).filter(
      (x) => x.disabled !== true,
    )
    if (!filter()) return mixed.slice(0, 10)
    const result = fuzzysort.go(filter()!, mixed, {
      keys: ["display", "description"],
      limit: 10,
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
        if (!store.visible) {
          if (e.name === "@") {
            const last = props.value.at(-1)
            if (last === " " || last === undefined) {
              show("@")
            }
          }

          if (e.name === "/") {
            if (props.input().cursorPosition === 0) show("/")
          }
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
