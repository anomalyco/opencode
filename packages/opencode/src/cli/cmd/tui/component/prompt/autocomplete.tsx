import type { BoxRenderable, TextareaRenderable, KeyEvent } from "@opentui/core"
import fuzzysort from "fuzzysort"
import { firstBy } from "remeda"
import { createMemo, createResource, createEffect, onMount, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { PromptInfo } from "./history"

export type AutocompleteRef = {
  onInput: (value: string) => void
  onKeyDown: (e: KeyEvent) => void
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
  setExtmark: (partIndex: number, extmarkId: number) => void
  anchor: () => BoxRenderable
  input: () => TextareaRenderable
  ref: (ref: AutocompleteRef) => void
  fileStyleId: number
  agentStyleId: number
  promptPartTypeId: () => number
}) {
  const sdk = useSDK()
  const sync = useSync()
  const command = useCommandDialog()
  const { theme } = useTheme()

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

  function insertPart(text: string, part: PromptInfo["parts"][number]) {
    const input = props.input()
    const currentCursorOffset = input.visualCursor.offset

    const charAfterCursor = props.value.at(currentCursorOffset)
    const needsSpace = charAfterCursor !== " "
    const append = "@" + text + (needsSpace ? " " : "")

    input.cursorOffset = store.index
    const startCursor = input.logicalCursor
    input.cursorOffset = currentCursorOffset
    const endCursor = input.logicalCursor

    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    input.insertText(append)

    const virtualText = "@" + text
    const extmarkStart = store.index
    const extmarkEnd = extmarkStart + virtualText.length

    const styleId =
      part.type === "file"
        ? props.fileStyleId
        : part.type === "agent"
          ? props.agentStyleId
          : undefined

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId,
      typeId: props.promptPartTypeId(),
    })

    props.setPrompt((draft) => {
      if (part.type === "file" && part.source?.text) {
        part.source.text.start = extmarkStart
        part.source.text.end = extmarkEnd
        part.source.text.value = virtualText
      } else if (part.type === "agent" && part.source) {
        part.source.start = extmarkStart
        part.source.end = extmarkEnd
        part.source.value = virtualText
      }
      const partIndex = draft.parts.length
      draft.parts.push(part)
      props.setExtmark(partIndex, extmarkId)
    })
  }

  const [files] = createResource(
    () => filter(),
    async (query) => {
      if (!store.visible || store.visible === "/") return []

      // Get files from SDK
      const result = await sdk.client.find.files({
        query: {
          query: query ?? "",
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
                insertPart(item, {
                  type: "file",
                  mime: "text/plain",
                  filename: item,
                  url: `file://${process.cwd()}/${item}`,
                  source: {
                    type: "file",
                    text: {
                      start: 0,
                      end: 0,
                      value: "",
                    },
                    path: item,
                  },
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
            insertPart(agent.name, {
              type: "agent",
              name: agent.name,
              source: {
                start: 0,
                end: 0,
                value: "",
              },
            })
          },
        }),
      )
  })

  const session = createMemo(() =>
    props.sessionID ? sync.session.get(props.sessionID) : undefined,
  )
  const commands = createMemo((): AutocompleteOption[] => {
    const results: AutocompleteOption[] = []
    const s = session()
    for (const command of sync.data.command) {
      results.push({
        display: "/" + command.name,
        description: command.description,
        onSelect: () => {
          const newText = "/" + command.name + " "
          const cursor = props.input().logicalCursor
          props.input().deleteRange(0, 0, cursor.row, cursor.col)
          props.input().insertText(newText)
          props.input().cursorOffset = Bun.stringWidth(newText)
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
        {
          display: "/rename",
          description: "rename session",
          onSelect: () => command.trigger("session.rename"),
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
        display: "/session",
        description: "list sessions",
        onSelect: () => command.trigger("session.list"),
      },
      {
        display: "/status",
        description: "show status",
        onSelect: () => command.trigger("opencode.status"),
      },
      {
        display: "/theme",
        description: "toggle theme",
        onSelect: () => command.trigger("theme.switch"),
      },
      {
        display: "/editor",
        description: "open editor",
        onSelect: () => command.trigger("prompt.editor"),
      },
      {
        display: "/help",
        description: "show help",
        onSelect: () => command.trigger("help.show"),
      },
      {
        display: "/commands",
        description: "show all commands",
        onSelect: () => command.show(),
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
    const mixed: AutocompleteOption[] = (
      store.visible === "@"
        ? [...agents(), ...(files.loading ? files.latest || [] : files())]
        : [...commands()]
    ).filter((x) => x.disabled !== true)
    const currentFilter = filter()
    if (!currentFilter) return mixed.slice(0, 10)
    const result = fuzzysort.go(currentFilter, mixed, {
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
    if (!options().length) return
    let next = store.selected + direction
    if (next < 0) next = options().length - 1
    if (next >= options().length) next = 0
    setStore("selected", next)
  }

  function select() {
    const selected = options()[store.selected]
    if (!selected) return
    selected.onSelect?.()
    hide()
  }

  function show(mode: "@" | "/") {
    command.keybinds(false)
    setStore({
      visible: mode,
      index: props.input().visualCursor.offset,
      position: {
        x: props.anchor().x,
        y: props.anchor().y,
        width: props.anchor().width,
      },
    })
  }

  function hide() {
    const text = props.input().plainText
    if (store.visible === "/" && !text.endsWith(" ")) {
      const cursor = props.input().logicalCursor
      props.input().deleteRange(0, 0, cursor.row, cursor.col)
    }
    command.keybinds(true)
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
      onKeyDown(e: KeyEvent) {
        if (store.visible) {
          if (e.name === "up") move(-1)
          if (e.name === "down") move(1)
          if (e.name === "escape") hide()
          if (e.name === "return" || e.name === "tab") select()
          if (["up", "down", "return", "tab", "escape"].includes(e.name)) e.preventDefault()
        }
        if (!store.visible) {
          if (e.name === "@") {
            const cursorOffset = props.input().visualCursor.offset
            const charBeforeCursor =
              cursorOffset === 0 ? undefined : props.value.at(cursorOffset - 1)
            if (
              charBeforeCursor === " " ||
              charBeforeCursor === "\n" ||
              charBeforeCursor === undefined
            ) {
              show("@")
            }
          }

          if (e.name === "/") {
            if (props.input().visualCursor.offset === 0) show("/")
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
      borderColor={theme.border}
    >
      <box backgroundColor={theme.backgroundElement} height={height()}>
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
              backgroundColor={index() === store.selected ? theme.primary : undefined}
              flexDirection="row"
            >
              <text fg={index() === store.selected ? theme.background : theme.text} flexShrink={0}>
                {option.display}
              </text>
              <Show when={option.description}>
                <text
                  fg={index() === store.selected ? theme.background : theme.textMuted}
                  wrapMode="none"
                >
                  {option.description}
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
