import type { BoxRenderable, TextareaRenderable, ScrollBoxRenderable } from "@opentui/core"
import { pathToFileURL } from "bun"
import fuzzysort from "fuzzysort"
import path from "path"
import { firstBy } from "remeda"
import { createMemo, createResource, createEffect, onMount, onCleanup, Index, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useEditorContext } from "../../context/editor"
import { useProject } from "../../context/project"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useData } from "../../context/data"
import { getScrollAcceleration } from "../../util/scroll"
import { useTuiPaths } from "../../context/runtime"
import { useTuiConfig } from "../../config"
import { useTheme, selectedForeground } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { useTerminalDimensions } from "@opentui/solid"
import { Locale } from "../../util/locale"
import type { PromptInfo } from "../../prompt/history"
import { useFrecency } from "../../prompt/frecency"
import { useBindings, useCommandSlashes, useOpencodeModeStack } from "../../keymap"
import { displayCharAt, mentionTriggerIndex } from "../../prompt/display"

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
  const editor = useEditorContext()
  const sdk = useSDK()
  const sync = useSync()
  const data = useData()
  const project = useProject()
  const slashes = useCommandSlashes()
  const modeStack = useOpencodeModeStack()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const frecency = useFrecency()
  const tuiConfig = useTuiConfig()
  const paths = useTuiPaths()
  const [store, setStore] = createStore({
    index: 0,
    selected: 0,
    visible: false as AutocompleteRef["visible"],
    input: "keyboard" as "keyboard" | "mouse",
  })

  const [positionTick, setPositionTick] = createSignal(0)

  createEffect(() => {
    if (!store.visible) return
    const popMode = modeStack.push("autocomplete")
    onCleanup(popMode)
  })

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
    dimensions()
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

  // filter() reads reactive props.value plus non-reactive cursor/text state.
  // On keypress those can be briefly out of sync, so filter() may return an empty/partial string.
  // Copy it into search in an effect because effects run after reactive updates have been rendered and painted
  // so the input has settled and all consumers read the same stable value.
  const [search, setSearch] = createSignal("")
  createEffect(() => {
    const next = filter()
    setSearch(next ? next : "")
  })

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard so
  // that the mouseover event doesn't trigger when filtering.
  createEffect(() => {
    filter()
    setStore("input", "keyboard")
  })

  function insertPart(text: string, part: PromptInfo["parts"][number]) {
    const input = props.input()
    const currentCursorOffset = input.cursorOffset

    const charAfterCursor = displayCharAt(props.value, currentCursorOffset)
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
      if (part.type === "file") {
        const existingIndex = draft.parts.findIndex((p) => p.type === "file" && "url" in p && p.url === part.url)
        if (existingIndex !== -1) {
          const existing = draft.parts[existingIndex]
          if (
            part.source?.text &&
            existing &&
            "source" in existing &&
            existing.source &&
            "text" in existing.source &&
            existing.source.text
          ) {
            existing.source.text.start = extmarkStart
            existing.source.text.end = extmarkEnd
            existing.source.text.value = virtualText
          }
          return
        }
      }

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

  function createFilePart(item: string, lineRange?: { startLine: number; endLine?: number }) {
    const baseDir = (sync.path.directory || paths.cwd).replace(/\/+$/, "")
    const fullPath = path.isAbsolute(item) ? item : path.join(baseDir, item)
    const urlObj = pathToFileURL(fullPath)
    const filename =
      lineRange && !item.endsWith("/")
        ? `${item}#${lineRange.startLine}${lineRange.endLine ? `-${lineRange.endLine}` : ""}`
        : item

    if (lineRange && !item.endsWith("/")) {
      urlObj.searchParams.set("start", String(lineRange.startLine))
      if (lineRange.endLine !== undefined) {
        urlObj.searchParams.set("end", String(lineRange.endLine))
      }
    }

    return {
      filename,
      url: urlObj.href,
      part: {
        type: "file" as const,
        mime: "text/plain",
        filename,
        url: urlObj.href,
        source: {
          type: "file" as const,
          text: {
            start: 0,
            end: 0,
            value: "",
          },
          path: item,
        },
      },
    }
  }

  const references = createMemo(() => data.location.reference.list() ?? [])

  const referenceMatch = createMemo(() => {
    if (!store.visible || store.visible === "/") return
    const { baseQuery } = extractLineRange(search())
    const slash = baseQuery.indexOf("/")
    const alias = slash === -1 ? baseQuery : baseQuery.slice(0, slash)
    return references().find((item) => !item.hidden && item.name === alias)
  })

  function normalizeMentionPath(filePath: string) {
    const baseDir = sync.path.directory || paths.cwd
    const absolute = path.resolve(filePath)
    const relative = path.relative(baseDir, absolute)

    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join("/")
    }

    return absolute.split(path.sep).join("/")
  }

  function insertFileMention(input: { filePath: string; lineStart: number; lineEnd: number }) {
    const item = normalizeMentionPath(input.filePath)
    const lineRange = {
      startLine: input.lineStart,
      endLine: input.lineEnd > input.lineStart ? input.lineEnd : undefined,
    }
    const { filename, part } = createFilePart(item, lineRange)
    const index = store.visible === "@" ? store.index : props.input().cursorOffset

    setStore("visible", false)
    setStore("index", index)
    insertPart(filename, part)
  }

  const [files] = createResource(
    () => search(),
    async (query) => {
      if (!store.visible || store.visible === "/") return []
      if (referenceMatch()) return []
      const { lineRange, baseQuery } = extractLineRange(query ?? "")

      // Get files from SDK
      const result = await sdk.client.v2.fs.find({
        query: baseQuery,
        limit: "20",
        location: { workspace: project.workspace.current() },
      })

      const options: AutocompleteOption[] = []

      // Add file options. Trust the order returned by fff (frecency, fuzzy
      // score, filename bonus, etc. are already factored in).
      if (!result.error && result.data) {
        const width = props.anchor().width - 4
        options.push(
          ...result.data.data.map((item): AutocompleteOption => {
            const { filename, url, part } = createFilePart(item.path, lineRange)
            return {
              display: Locale.truncateMiddle(filename, width),
              value: filename,
              isDirectory: item.type === "directory",
              path: item.path,
              onSelect: () => {
                insertPart(filename, part)
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
    return sync.data.agent
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

  const referenceAliases = createMemo(() =>
    references()
      .filter((reference) => !reference.hidden)
      .map(
        (reference): AutocompleteOption => ({
          display: "@" + reference.name,
          description: ` ${reference.source.type === "git" ? reference.source.repository : reference.source.path}`,
          onSelect: () => {
            insertPart(reference.name, {
              type: "file",
              mime: "application/x-directory",
              filename: reference.name,
              url: pathToFileURL(reference.path).href,
              source: {
                type: "file",
                text: { start: 0, end: 0, value: "" },
                path: reference.name,
              },
            })
          },
        }),
      ),
  )

  const commands = createMemo((): AutocompleteOption[] => {
    const results: AutocompleteOption[] = [...slashes()]

    for (const serverCommand of sync.data.command) {
      if (serverCommand.source === "skill") continue
      const label = serverCommand.source === "mcp" ? ":mcp" : ""
      results.push({
        display: "/" + serverCommand.name + label,
        description: serverCommand.description,
        onSelect: () => {
          const newText = "/" + serverCommand.name + " "
          const cursor = props.input().logicalCursor
          props.input().deleteRange(0, 0, cursor.row, cursor.col)
          props.input().insertText(newText)
          props.input().cursorOffset = Bun.stringWidth(newText)
        },
      })
    }

    results.sort((a, b) => a.display.localeCompare(b.display))

    const max = firstBy(results, [(x) => x.display.length, "desc"])?.display.length
    if (!max) return results
    return results.map((item) => ({
      ...item,
      display: item.display.padEnd(max + 2),
    }))
  })

  const options = createMemo((prev: AutocompleteOption[] | undefined) => {
    const filesValue = files()
    const referenceMatchValue = referenceMatch()
    const agentsValue = agents()
    const referenceAliasesValue = referenceAliases()
    const commandsValue = commands()
    const searchValue = search()

    if (store.visible === "@" && referenceMatchValue) {
      return referenceAliasesValue.filter((item) => item.display === `@${referenceMatchValue.name}`)
    }

    // Files come from fff already fuzzy ranked and filtered
    // it shouldn't be additionally sorted by fuzzysort as it will loose the results
    const fileOptions: AutocompleteOption[] = store.visible === "@" ? filesValue || [] : []
    const nonFileOptions: AutocompleteOption[] =
      store.visible === "@" ? [...referenceAliasesValue, ...agentsValue, ...mcpResources()] : [...commandsValue]

    if (!searchValue) {
      return [...nonFileOptions, ...fileOptions]
    }

    if (files.loading && prev && prev.length > 0) {
      return prev
    }

    const fuzziedNonFiles = fuzzysort
      .go(removeLineRange(searchValue), nonFileOptions, {
        keys: [
          (obj) => removeLineRange((obj.value ?? obj.display).trimEnd()),
          "description",
          (obj) => obj.aliases?.join(" ") ?? "",
        ],
        limit: 10,
        scoreFn: (objResults) => {
          const displayResult = objResults[0]
          let score = objResults.score
          if (displayResult && displayResult.target.startsWith(store.visible + searchValue)) {
            score *= 2
          }
          const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
          return score * (1 + frecencyScore)
        },
      })
      .map((arr) => arr.obj)

    return [...fuzziedNonFiles, ...fileOptions].slice(0, 10)
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

    const displayText = (selected.value ?? selected.display).trimEnd()
    const path = displayText.startsWith("@") ? displayText.slice(1) : displayText

    input.cursorOffset = store.index
    const startCursor = input.logicalCursor
    input.cursorOffset = currentCursorOffset
    const endCursor = input.logicalCursor

    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    input.insertText("@" + path + "/")

    setStore("selected", 0)
  }

  useBindings(() => ({
    target: props.input,
    enabled: () => Boolean(store.visible),
    commands: [
      {
        name: "prompt.autocomplete.prev",
        title: "Previous autocomplete item",
        category: "Autocomplete",
        run() {
          setStore("input", "keyboard")
          move(-1)
        },
      },
      {
        name: "prompt.autocomplete.next",
        title: "Next autocomplete item",
        category: "Autocomplete",
        run() {
          setStore("input", "keyboard")
          move(1)
        },
      },
      {
        name: "prompt.autocomplete.hide",
        title: "Hide autocomplete",
        category: "Autocomplete",
        run() {
          hide()
        },
      },
      {
        name: "prompt.autocomplete.select",
        title: "Select autocomplete item",
        category: "Autocomplete",
        run() {
          select()
        },
      },
      {
        name: "prompt.autocomplete.complete",
        title: "Complete autocomplete item",
        category: "Autocomplete",
        run() {
          const selected = options()[store.selected]
          if (selected?.isDirectory) {
            expandDirectory()
            return
          }

          select()
        },
      },
    ],
    bindings: tuiConfig.keybinds.gather("prompt.autocomplete", [
      "prompt.autocomplete.prev",
      "prompt.autocomplete.next",
      "prompt.autocomplete.hide",
      "prompt.autocomplete.select",
      "prompt.autocomplete.complete",
    ]),
  }))

  function show(mode: "@" | "/") {
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
    setStore("visible", false)
  }

  onMount(() => {
    const unsubscribeMention = editor.onMention((mention) => {
      insertFileMention(mention)
    })

    onCleanup(() => {
      unsubscribeMention()
    })

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
        const idx = mentionTriggerIndex(value, offset)
        if (idx !== undefined) {
          show("@")
          setStore("index", idx)
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
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

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
        scrollAcceleration={scrollAcceleration()}
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
              onMouseMove={() => {
                setStore("input", "mouse")
              }}
              onMouseOver={() => {
                if (store.input !== "mouse") return
                moveTo(index)
              }}
              onMouseDown={() => {
                setStore("input", "mouse")
                moveTo(index)
              }}
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
