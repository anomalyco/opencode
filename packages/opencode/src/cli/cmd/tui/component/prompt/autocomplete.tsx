import type { BoxRenderable, TextareaRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import fuzzysort from "fuzzysort"
import { firstBy } from "remeda"
import { createMemo, createResource, createEffect, onMount, onCleanup, Index, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"
import { Locale } from "@/util/locale"
import type { PromptInfo } from "./history"
import { useFrecency } from "./frecency"

function removeLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  return hashIndex !== -1 ? input.substring(0, hashIndex) : input
}

function extractLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  if (hashIndex === -1) {
    return { baseQuery: input }
  }

  const baseName = input.substring(0, hashIndex)
  const linePart = input.substring(hashIndex + 1)
  const lineMatch = linePart.match(/^(\d+)(?:-(\d*))?$/)

  if (!lineMatch) {
    return { baseQuery: baseName }
  }

  const startLine = Number(lineMatch[1])
  const endLine = lineMatch[2] && startLine < Number(lineMatch[2]) ? Number(lineMatch[2]) : undefined

  return {
    lineRange: {
      baseName,
      startLine,
      endLine,
    },
    baseQuery: baseName,
  }
}

export type AutocompleteRef = {
  onInput: (value: string) => void
  onKeyDown: (e: KeyEvent) => void
  visible: false | "@" | "/"
}

export type AutocompleteOption = {
  display: string
  value?: string
  aliases?: string[]
  disabled?: boolean
  description?: string
  isDirectory?: boolean
  onSelect?: () => void
  path?: string
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
  const dimensions = useTerminalDimensions()
  const frecency = useFrecency()

  const [store, setStore] = createStore({
    index: 0,
    selected: 0,
    visible: false as AutocompleteRef["visible"],
  })

  const [positionTick, setPositionTick] = createSignal(0)

  createEffect(() => {
    if (store.visible) {
      let lastPos = { x: 0, y: 0, width: 0 }
      const interval = setInterval(() => {
        const anchor = props.anchor()
        if (anchor.x !== lastPos.x || anchor.y !== lastPos.y || anchor.width !== lastPos.width) {
          lastPos = { x: anchor.x, y: anchor.y, width: anchor.width }
          setPositionTick((t) => t + 1)
        }
      }, 50)

      onCleanup(() => clearInterval(interval))
    }
  })

  const position = createMemo(() => {
    if (!store.visible) return { x: 0, y: 0, width: 0 }
    const dims = dimensions()
    positionTick()
    const anchor = props.anchor()
    const parent = anchor.parent
    const parentX = parent?.x ?? 0
    const parentY = parent?.y ?? 0

    return {
      x: anchor.x - parentX,
      y: anchor.y - parentY,
      width: anchor.width,
    }
  })

  const filter = createMemo(() => {
    if (!store.visible) return
    // Track props.value to make memo reactive to text changes
    props.value // <- there surely is a better way to do this, like making .input() reactive

    return props.input().getTextRange(store.index + 1, props.input().cursorOffset)
  })

  function insertPart(text: string, part: PromptInfo["parts"][number]) {
    const input = props.input()
    const currentCursorOffset = input.cursorOffset

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
    const extmarkEnd = extmarkStart + Bun.stringWidth(virtualText)

    const styleId = part.type === "file" ? props.fileStyleId : part.type === "agent" ? props.agentStyleId : undefined

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

    if (part.type === "file" && part.source && part.source.type === "file") {
      frecency.updateFrecency(part.source.path)
    }
  }

  const [files] = createResource(
    () => filter(),
    async (query) => {
      if (!store.visible || store.visible === "/") return []

      const { lineRange, baseQuery } = extractLineRange(query ?? "")

      // Get files from SDK
      const result = await sdk.client.find.files({
        query: baseQuery,
      })

      const options: AutocompleteOption[] = []

      // Add file options
      if (!result.error && result.data) {
        const sortedFiles = result.data.sort((a, b) => {
          const aScore = frecency.getFrecency(a)
          const bScore = frecency.getFrecency(b)
          if (aScore !== bScore) return bScore - aScore
          const aDepth = a.split("/").length
          const bDepth = b.split("/").length
          if (aDepth !== bDepth) return aDepth - bDepth
          return a.localeCompare(b)
        })

        const width = props.anchor().width - 4
        options.push(
          ...sortedFiles.map((item): AutocompleteOption => {
            let url = `file://${process.cwd()}/${item}`
            let filename = item
            if (lineRange && !item.endsWith("/")) {
              filename = `${item}#${lineRange.startLine}${lineRange.endLine ? `-${lineRange.endLine}` : ""}`
              const urlObj = new URL(url)
              urlObj.searchParams.set("start", String(lineRange.startLine))
              if (lineRange.endLine !== undefined) {
                urlObj.searchParams.set("end", String(lineRange.endLine))
              }
              url = urlObj.toString()
            }

            const isDir = item.endsWith("/")
            return {
              display: Locale.truncateMiddle(filename, width),
              value: filename,
              isDirectory: isDir,
              path: item,
              onSelect: () => {
                insertPart(filename, {
                  type: "file",
                  mime: "text/plain",
                  filename,
                  url,
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
            }
          }),
        )
      }

      return options
    },
    {
      initialValue: [],
    },
  )

  const mcpResources = createMemo(() => {
    if (!store.visible || store.visible === "/") return []

    const options: AutocompleteOption[] = []
    const width = props.anchor().width - 4

    for (const res of Object.values(sync.data.mcp_resource)) {
      const text = `${res.name} (${res.uri})`
      options.push({
        display: Locale.truncateMiddle(text, width),
        value: text,
        description: res.description,
        onSelect: () => {
          insertPart(res.name, {
            type: "file",
            mime: res.mimeType ?? "text/plain",
            filename: res.name,
            url: res.uri,
            source: {
              type: "resource",
              text: {
                start: 0,
                end: 0,
                value: "",
              },
              clientName: res.client,
              uri: res.uri,
            },
          })
        },
      })
    }

    return options
  })

  const agents = createMemo(() => {
    const agents = sync.data.agent
    return agents
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
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

  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const commands = createMemo((): AutocompleteOption[] => {
    const results: AutocompleteOption[] = []
    const s = session()
    for (const command of sync.data.command) {
      results.push({
        display: "/" + command.name + (command.mcp ? " (MCP)" : ""),
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
          onSelect: () => {
            command.trigger("session.undo")
          },
        },
        {
          display: "/redo",
          description: "redo the last message",
          onSelect: () => command.trigger("session.redo"),
        },
        {
          display: "/compact",
          aliases: ["/summarize"],
          description: "compact the session",
          onSelect: () => command.trigger("session.compact"),
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
        {
          display: "/copy",
          description: "copy session transcript to clipboard",
          onSelect: () => command.trigger("session.copy"),
        },
        {
          display: "/export",
          description: "export session transcript to file",
          onSelect: () => command.trigger("session.export"),
        },
        {
          display: "/timeline",
          description: "jump to message",
          onSelect: () => command.trigger("session.timeline"),
        },
        {
          display: "/fork",
          description: "fork from message",
          onSelect: () => command.trigger("session.fork"),
        },
        {
          display: "/thinking",
          description: "toggle thinking visibility",
          onSelect: () => command.trigger("session.toggle.thinking"),
        },
      )
      if (sync.data.config.share !== "disabled") {
        results.push({
          display: "/share",
          disabled: !!s.share?.url,
          description: "share a session",
          onSelect: () => command.trigger("session.share"),
        })
      }
    }

    results.push(
      {
        display: "/new",
        aliases: ["/clear"],
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
        aliases: ["/resume", "/continue"],
        description: "list sessions",
        onSelect: () => command.trigger("session.list"),
      },
      {
        display: "/status",
        description: "show status",
        onSelect: () => command.trigger("opencode.status"),
      },
      {
        display: "/mcp",
        description: "toggle MCPs",
        onSelect: () => command.trigger("mcp.list"),
      },
      {
        display: "/theme",
        description: "toggle theme",
        onSelect: () => command.trigger("theme.switch"),
      },
      {
        display: "/editor",
        description: "open editor",
        onSelect: () => command.trigger("prompt.editor", "prompt"),
      },
      {
        display: "/connect",
        description: "connect to a provider",
        onSelect: () => command.trigger("provider.connect"),
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
      {
        display: "/exit",
        aliases: ["/quit", "/q"],
        description: "exit the app",
        onSelect: () => command.trigger("app.exit"),
      },
    )
    const max = firstBy(results, [(x) => x.display.length, "desc"])?.display.length
    if (!max) return results
    return results.map((item) => ({
      ...item,
      display: item.display.padEnd(max + 2),
    }))
  })

  const options = createMemo((prev: AutocompleteOption[] | undefined) => {
    const filesValue = files()
    const agentsValue = agents()
    const commandsValue = commands()

    const mixed: AutocompleteOption[] = (
      store.visible === "@" ? [...agentsValue, ...(filesValue || []), ...mcpResources()] : [...commandsValue]
    ).filter((x) => x.disabled !== true)

    const currentFilter = filter()

    if (!currentFilter) {
      return mixed
    }

    if (files.loading && prev && prev.length > 0) {
      return prev
    }

    const result = fuzzysort.go(removeLineRange(currentFilter), mixed, {
      keys: [
        (obj) => removeLineRange((obj.value ?? obj.display).trimEnd()),
        "description",
        (obj) => obj.aliases?.join(" ") ?? "",
      ],
      limit: 10,
      scoreFn: (objResults) => {
        const displayResult = objResults[0]
        let score = objResults.score
        if (displayResult && displayResult.target.startsWith(store.visible + currentFilter)) {
          score *= 2
        }
        const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
        return score * (1 + frecencyScore)
      },
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
    moveTo(next)
  }

  function moveTo(next: number) {
    setStore("selected", next)
    if (!scroll) return
    const viewportHeight = Math.min(height(), options().length)
    const scrollBottom = scroll.scrollTop + viewportHeight
    if (next < scroll.scrollTop) {
      scroll.scrollBy(next - scroll.scrollTop)
    } else if (next + 1 > scrollBottom) {
      scroll.scrollBy(next + 1 - scrollBottom)
    }
  }

  function select() {
    const selected = options()[store.selected]
    if (!selected) return
    hide()
    selected.onSelect?.()
  }

  function expandDirectory() {
    const selected = options()[store.selected]
    if (!selected) return

    const input = props.input()
    const currentCursorOffset = input.cursorOffset

    const displayText = selected.display.trimEnd()
    const path = displayText.startsWith("@") ? displayText.slice(1) : displayText

    input.cursorOffset = store.index
    const startCursor = input.logicalCursor
    input.cursorOffset = currentCursorOffset
    const endCursor = input.logicalCursor

    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    input.insertText("@" + path)

    setStore("selected", 0)
  }

  function show(mode: "@" | "/") {
    command.keybinds(false)
    setStore({
      visible: mode,
      index: props.input().cursorOffset,
    })
  }

  function hide() {
    const text = props.input().plainText
    if (store.visible === "/" && !text.endsWith(" ") && text.startsWith("/")) {
      const cursor = props.input().logicalCursor
      props.input().deleteRange(0, 0, cursor.row, cursor.col)
      // Sync the prompt store immediately since onContentChange is async
      props.setPrompt((draft) => {
        draft.input = props.input().plainText
      })
    }
    command.keybinds(true)
    setStore("visible", false)
  }

  onMount(() => {
    props.ref({
      get visible() {
        return store.visible
      },
      onInput(value) {
        if (store.visible) {
          if (
            // Typed text before the trigger
            props.input().cursorOffset <= store.index ||
            // There is a space between the trigger and the cursor
            props.input().getTextRange(store.index, props.input().cursorOffset).match(/\s/) ||
            // "/<command>" is not the sole content
            (store.visible === "/" && value.match(/^\S+\s+\S+\s*$/))
          ) {
            hide()
          }
          return
        }

        // Check if autocomplete should reopen (e.g., after backspace deleted a space)
        const offset = props.input().cursorOffset
        if (offset === 0) return

        // Check for "/" at position 0 - reopen slash commands
        if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
          show("/")
          setStore("index", 0)
          return
        }

        // Check for "@" trigger - find the nearest "@" before cursor with no whitespace between
        const text = value.slice(0, offset)
        const idx = text.lastIndexOf("@")
        if (idx === -1) return

        const between = text.slice(idx)
        const before = idx === 0 ? undefined : value[idx - 1]
        if ((before === undefined || /\s/.test(before)) && !between.match(/\s/)) {
          show("@")
          setStore("index", idx)
        }
      },
      onKeyDown(e: KeyEvent) {
        if (store.visible) {
          const name = e.name?.toLowerCase()
          const ctrlOnly = e.ctrl && !e.meta && !e.shift
          const isNavUp = name === "up" || (ctrlOnly && name === "p")
          const isNavDown = name === "down" || (ctrlOnly && name === "n")

          if (isNavUp) {
            move(-1)
            e.preventDefault()
            return
          }
          if (isNavDown) {
            move(1)
            e.preventDefault()
            return
          }
          if (name === "escape") {
            hide()
            e.preventDefault()
            return
          }
          if (name === "return") {
            select()
            e.preventDefault()
            return
          }
          if (name === "tab") {
            const selected = options()[store.selected]
            if (selected?.isDirectory) {
              expandDirectory()
            } else {
              select()
            }
            e.preventDefault()
            return
          }
        }
        if (!store.visible) {
          if (e.name === "@") {
            const cursorOffset = props.input().cursorOffset
            const charBeforeCursor =
              cursorOffset === 0 ? undefined : props.input().getTextRange(cursorOffset - 1, cursorOffset)
            const canTrigger = charBeforeCursor === undefined || charBeforeCursor === "" || /\s/.test(charBeforeCursor)
            if (canTrigger) show("@")
          }

          if (e.name === "/") {
            if (props.input().cursorOffset === 0) show("/")
          }
        }
      },
    })
  })

  const height = createMemo(() => {
    const count = options().length || 1
    if (!store.visible) return Math.min(10, count)
    positionTick()
    return Math.min(10, count, Math.max(1, props.anchor().y))
  })

  let scroll: ScrollBoxRenderable

  return (
    <box
      visible={store.visible !== false}
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      {...SplitBorder}
      borderColor={theme.border}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        backgroundColor={theme.backgroundMenu}
        height={height()}
        scrollbarOptions={{ visible: false }}
      >
        <Index
          each={options()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No matching items</text>
            </box>
          }
        >
          {(option, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index === store.selected ? theme.primary : undefined}
              flexDirection="row"
              onMouseOver={() => moveTo(index)}
              onMouseUp={() => select()}
            >
              <text fg={index === store.selected ? selectedForeground(theme) : theme.text} flexShrink={0}>
                {option().display}
              </text>
              <Show when={option().description}>
                <text fg={index === store.selected ? selectedForeground(theme) : theme.textMuted} wrapMode="none">
                  {option().description}
                </text>
              </Show>
            </box>
          )}
        </Index>
      </scrollbox>
    </box>
  )
}
