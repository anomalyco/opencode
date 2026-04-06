import { useSync } from "@tui/context/sync"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useSDK } from "@tui/context/sdk"
import { useTuiConfig } from "../../context/tui-config"
import { useToast } from "../../ui/toast"
import { getScrollAcceleration } from "../../util/scroll"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import type { Part, AssistantMessage } from "@opencode-ai/sdk/v2"
import { batch, createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import * as fuzzysort from "fuzzysort"

const PANEL_WIDTH = 80

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function estimate(part: Part): number {
  switch (part.type) {
    case "text":
      return Math.ceil((part.text?.length ?? 0) / 4)
    case "tool": {
      if (part.state.status !== "completed") return 0
      const raw = JSON.stringify(part.state.input ?? "").length + (part.state.output ?? "").length
      return Math.ceil(raw / 4)
    }
    case "reasoning":
      return Math.ceil((part.text?.length ?? 0) / 4)
    case "subtask":
      return Math.ceil((part.prompt?.length ?? 0) / 4)
    default:
      return 0
  }
}

type Item = {
  id: string
  title: string
  description?: string
  footer?: string
  category: string
  sessionID: string
  messageID: string
  partID: string
  kind: string
  disabled?: boolean
}

function items(
  sessionID: string,
  messages: ReturnType<typeof useSync>["data"]["message"][string],
  parts: ReturnType<typeof useSync>["data"]["part"],
): Item[] {
  const result: Item[] = []
  const all = messages ?? []
  for (let i = 0; i < all.length; i++) {
    const msg = all[i]
    const msgParts = parts[msg.id] ?? []
    const role = msg.role === "user" ? "User" : "Assistant"
    let info = ""
    if (msg.role === "assistant") {
      const t = (msg as AssistantMessage).tokens
      const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
      info = ` · ${total.toLocaleString()} tok`
      if ((msg as AssistantMessage).cost > 0) info += ` · ${money.format((msg as AssistantMessage).cost)}`
    }
    const category = `#${i + 1} ${role}${info}`

    for (const part of msgParts) {
      const tok = estimate(part)
      result.push({
        id: part.id,
        title: partLabel(part),
        description: partDesc(part),
        footer: tok > 0 ? `~${tok.toLocaleString()} tok` : undefined,
        category,
        sessionID,
        messageID: msg.id,
        partID: part.id,
        kind: part.type,
      })
    }

    if (msgParts.length === 0) {
      result.push({
        id: `empty-${msg.id}`,
        title: "(no parts)",
        category,
        sessionID,
        messageID: msg.id,
        partID: "",
        kind: "empty",
        disabled: true,
      })
    }
  }
  return result
}

function partLabel(part: Part): string {
  switch (part.type) {
    case "text":
      return (part.text ?? "").slice(0, 60).replace(/\n/g, " ") || "(empty)"
    case "tool": {
      const icon =
        part.state.status === "completed"
          ? "✓"
          : part.state.status === "error"
            ? "✗"
            : part.state.status === "running"
              ? "…"
              : "○"
      const flag = part.state.status === "completed" && part.state.time?.compacted ? " [compacted]" : ""
      return `[${part.tool}] ${icon}${flag}`
    }
    case "reasoning":
      return "[reasoning] " + (part.text ?? "").slice(0, 40).replace(/\n/g, " ")
    case "subtask":
      return `[subtask] ${part.description ?? part.prompt?.slice(0, 40) ?? ""}`
    case "file":
      return `[file] ${part.filename ?? part.url ?? ""}`
    case "step-start":
      return "[step-start]"
    case "step-finish":
      return `[step-finish] ${part.reason ?? ""}`
    case "patch":
      return `[patch] ${part.files?.length ?? 0} files`
    case "agent":
      return `[@${part.name}]`
    case "retry":
      return `[retry] #${part.attempt}`
    case "compaction":
      return "[compaction]"
    case "snapshot":
      return "[snapshot]"
    default:
      return "[unknown]"
  }
}

function partDesc(part: Part): string | undefined {
  if (part.type === "tool" && part.state.status === "completed") return part.state.title ?? undefined
  return undefined
}

export { PANEL_WIDTH }

export function ContextPanel(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const tuiConfig = useTuiConfig()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const acceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const msgs = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const cost = createMemo(() =>
    msgs().reduce((sum, m) => sum + (m.role === "assistant" ? (m as AssistantMessage).cost : 0), 0),
  )

  const all = createMemo(() => items(props.sessionID, msgs(), sync.data.part))

  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  const [pending, setPending] = createSignal<string>()

  const filtered = createMemo(() => {
    const opts = all().filter((x) => !x.disabled)
    const needle = store.filter.toLowerCase()
    if (!needle) return opts
    return fuzzysort
      .go(needle, opts, {
        keys: ["title", "category"],
        scoreFn: (r) => r[0].score * 2 + r[1].score,
      })
      .map((x) => x.obj)
  })

  const flatten = createMemo(() => store.filter.length > 0)

  const grouped = createMemo<[string, Item[]][]>(() => {
    if (flatten()) return [["", filtered()]]
    const map = new Map<string, Item[]>()
    for (const item of filtered()) {
      const key = item.category
      const arr = map.get(key) ?? []
      arr.push(item)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  })

  const flat = createMemo(() => grouped().flatMap(([, opts]) => opts))

  const selected = createMemo(() => flat()[store.selected])

  createEffect(
    on(
      () => store.filter,
      () => {
        setTimeout(() => moveTo(0, true), 0)
      },
    ),
  )

  createEffect(() => {
    filtered()
    setStore("input", "keyboard")
  })

  function move(dir: number) {
    if (flat().length === 0) return
    let next = store.selected + dir
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next, true)
  }

  function moveTo(next: number, center = false) {
    setStore("selected", next)
    if (!scroll) return
    const target = scroll.getChildren().find((c) => c.id === selected()?.id)
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      scroll.scrollBy(y - Math.floor(scroll.height / 2))
    } else {
      if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
      if (y < 0) scroll.scrollBy(y)
    }
  }

  async function compact() {
    const s = selected()
    if (!s || s.kind !== "tool") return
    const parts = sync.data.part[s.messageID] ?? []
    const part = parts.find((p) => p.id === s.partID)
    if (!part || part.type !== "tool") return
    if (part.state.status !== "completed") return
    if (part.state.time?.compacted) return
    await sdk.client.part.update({
      sessionID: s.sessionID,
      messageID: s.messageID,
      partID: s.partID,
      part: {
        ...part,
        state: {
          ...part.state,
          time: { ...part.state.time, compacted: Date.now() },
        },
      },
    })
    toast.show({ message: "Part compacted", variant: "success" })
  }

  async function del() {
    const s = selected()
    if (!s || !s.partID) return
    if (pending() !== s.partID) {
      setPending(s.partID)
      return
    }
    setPending(undefined)
    await sdk.client.part.delete({
      sessionID: s.sessionID,
      messageID: s.messageID,
      partID: s.partID,
    })
  }

  async function delSection() {
    const s = selected()
    if (!s) return
    const key = `section:${s.messageID}`
    if (pending() !== key) {
      setPending(key)
      return
    }
    setPending(undefined)
    await sdk.client.session.deleteMessage({
      sessionID: s.sessionID,
      messageID: s.messageID,
    })
    toast.show({ message: "Message deleted", variant: "success" })
  }

  const compactKey = Keybind.parse("alt+c")[0]
  const deleteKey = Keybind.parse("alt+d")[0]
  const sectionKey = Keybind.parse("alt+s")[0]

  let input: InputRenderable
  let scroll: ScrollBoxRenderable

  useKeyboard((evt) => {
    setStore("input", "keyboard")
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.name === "home") moveTo(0)
    if (evt.name === "end") moveTo(flat().length - 1)

    if (compactKey && Keybind.match(compactKey, keybind.parse(evt))) {
      evt.preventDefault()
      compact()
    }
    if (deleteKey && Keybind.match(deleteKey, keybind.parse(evt))) {
      evt.preventDefault()
      del()
    }
    if (sectionKey && Keybind.match(sectionKey, keybind.parse(evt))) {
      evt.preventDefault()
      delSection()
    }
  })

  const fg = selectedForeground(theme)
  const maxTitle = createMemo(() => PANEL_WIDTH - 22)

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={PANEL_WIDTH}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context · {money.format(cost())}
        </text>
        <text fg={theme.textMuted}>{keybind.print("context_panel")} close</text>
      </box>

      <box paddingTop={1} flexShrink={0}>
        <input
          onInput={(e) => {
            batch(() => {
              setStore("filter", e)
            })
          }}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.primary}
          focusedTextColor={theme.textMuted}
          ref={(r) => {
            input = r
            setTimeout(() => {
              if (!input || input.isDestroyed) return
              input.focus()
            }, 1)
          }}
          placeholder="Filter parts..."
          placeholderColor={theme.textMuted}
        />
      </box>

      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingTop={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          flexGrow={1}
          paddingTop={1}
          scrollAcceleration={acceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <For each={grouped()}>
            {([category, opts], index) => (
              <>
                <Show when={category}>
                  <box paddingTop={index() > 0 ? 1 : 0}>
                    <text
                      fg={pending() === `section:${opts[0]?.messageID}` ? theme.error : theme.accent}
                      attributes={TextAttributes.BOLD}
                    >
                      {pending() === `section:${opts[0]?.messageID}` ? "Press again to delete section" : category}
                    </text>
                  </box>
                </Show>
                <For each={opts}>
                  {(opt) => {
                    const active = createMemo(() => opt.id === selected()?.id)
                    const deleting = createMemo(() => pending() === opt.partID)
                    return (
                      <box
                        id={opt.id}
                        flexDirection="row"
                        onMouseMove={() => setStore("input", "mouse")}
                        onMouseOver={() => {
                          if (store.input !== "mouse") return
                          const idx = flat().findIndex((x) => x.id === opt.id)
                          if (idx !== -1) moveTo(idx)
                        }}
                        onMouseDown={() => {
                          const idx = flat().findIndex((x) => x.id === opt.id)
                          if (idx !== -1) moveTo(idx)
                        }}
                        backgroundColor={
                          active() ? (deleting() ? theme.error : theme.primary) : RGBA.fromInts(0, 0, 0, 0)
                        }
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text
                          flexGrow={1}
                          fg={active() ? fg : theme.text}
                          attributes={active() ? TextAttributes.BOLD : undefined}
                          overflow="hidden"
                          wrapMode="none"
                        >
                          {Locale.truncate(deleting() ? "Press again to confirm delete" : opt.title, maxTitle())}
                          <Show when={!deleting() && opt.description}>
                            <span
                              style={{
                                fg: active() ? fg : theme.textMuted,
                              }}
                            >
                              {" "}
                              {opt.description}
                            </span>
                          </Show>
                        </text>
                        <Show when={opt.footer}>
                          <box flexShrink={0}>
                            <text fg={active() ? fg : theme.textMuted}>{opt.footer}</text>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>

      <box flexShrink={0} flexDirection="row" gap={2} paddingTop={1}>
        <text>
          <span style={{ fg: theme.text }}>
            <b>compact</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>alt+c</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>delete</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>alt+d</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>section</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>alt+s</span>
        </text>
      </box>
    </box>
  )
}
