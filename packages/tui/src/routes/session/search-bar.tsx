import { InputRenderable, TextAttributes } from "@opentui/core"
import { createMemo, createSignal, onMount } from "solid-js"
import { SplitBorder } from "../../ui/border"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import type { SearchDirection, SearchHit } from "../../util/session-search"

const barCommands = ["search.previous", "search.next", "search.accept", "search.close"] as const

export function SearchBar(props: {
  query: string
  hits: readonly SearchHit[]
  index: number
  onQuery: (value: string) => void
  onMove: (direction: SearchDirection) => void
  onClose: (accept: boolean) => void
  onRecall: () => string | undefined
  ref?: (input: InputRenderable) => void
}) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const [inputTarget, setInputTarget] = createSignal<InputRenderable>()
  let input: InputRenderable

  function previous() {
    // Readline detail: ctrl+r on an empty bar recalls the previous query.
    if (!input.value.trim()) {
      const last = props.onRecall()
      if (!last) return
      input.value = last
      props.onQuery(last)
      return
    }
    props.onMove("previous")
  }

  useBindings(() => ({
    target: inputTarget,
    enabled: inputTarget() !== undefined,
    // Search bar semantics must win over session-level bindings (escape interrupts, ctrl+r reopens).
    priority: 1,
    commands: [
      {
        name: "search.previous",
        title: "Previous search match",
        category: "Search",
        hidden: true,
        run: previous,
      },
      {
        name: "search.next",
        title: "Next search match",
        category: "Search",
        hidden: true,
        run: () => props.onMove("next"),
      },
      {
        name: "search.accept",
        title: "Accept search",
        category: "Search",
        hidden: true,
        run: () => props.onClose(true),
      },
      {
        name: "search.close",
        title: "Close search",
        category: "Search",
        hidden: true,
        run: () => props.onClose(false),
      },
    ],
    bindings: tuiConfig.keybinds.gather("search", barCommands),
  }))

  onMount(() => {
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  })

  const counter = createMemo(() => {
    if (props.hits.length) return `${Math.min(props.index + 1, props.hits.length)}/${props.hits.length}`
    if (props.query.trim()) return "0/0"
    return ""
  })

  return (
    <box
      width="100%"
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={props.hits.length || !props.query.trim() ? theme.warning : theme.error}
    >
      <box
        flexDirection="row"
        alignItems="center"
        gap={1}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundPanel}
        width="100%"
      >
        <input
          flexGrow={1}
          onInput={(value: string) => props.onQuery(value)}
          ref={(r: InputRenderable) => {
            input = r
            setInputTarget(r)
            props.ref?.(r)
          }}
          placeholder="search session"
          placeholderColor={theme.textMuted}
          textColor={theme.text}
          focusedTextColor={theme.text}
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.text}
        />
        <text fg={props.hits.length ? theme.textMuted : theme.error} attributes={TextAttributes.BOLD}>
          {counter()}
        </text>
        <text fg={theme.textMuted}>↵ keep · esc back · ^R↑ · ^S↓</text>
      </box>
    </box>
  )
}
