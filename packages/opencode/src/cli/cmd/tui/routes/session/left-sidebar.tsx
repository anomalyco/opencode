import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useDialog } from "../../ui/dialog"
import { DialogPrompt } from "../../ui/dialog-prompt"

export function LeftSidebar(props: {
  sessionID: string
  onToggle: () => void
  onSelect: (sessionID: string) => void
  onSwitch: () => void
  openTabs: string[]
  onClose: (sessionID: string) => void
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const dialog = useDialog()

  const [displayLimit, setDisplayLimit] = createSignal(20)
  const [expandedCategories, setExpandedCategories] = createSignal<Set<string>>(new Set(["Today"]))
  const [searchQuery, setSearchQuery] = createSignal("")

  const openSearchDialog = () => {
    dialog.replace(() => (
      <DialogPrompt
        title="Search Sessions"
        value={searchQuery()}
        onConfirm={(value: string) => {
          setSearchQuery(value)
          dialog.clear()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  const allSessions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim()

    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .filter((x) => {
        const title = x.title.toLowerCase()
        return (
          !title.includes("clarifying") &&
          !title.includes("parsing") &&
          !title.includes("invalid input") &&
          !title.includes("discussing adsad") &&
          !title.startsWith("new session -")
        )
      })
      .filter((x) => {
        // If no search query, show all
        if (!query) return true
        // Search in session title
        return x.title.toLowerCase().includes(query)
      })
      .sort((a, b) => b.time.updated - a.time.updated)
  })

  // Group sessions by date
  const sessionsByCategory = createMemo(() => {
    const grouped = new Map<string, any[]>()
    const today = new Date()

    allSessions().forEach((session) => {
      const sessionDate = new Date(session.time.updated)
      const isToday = sessionDate.toDateString() === today.toDateString()
      const category = isToday ? "Today" : sessionDate.toLocaleDateString()

      if (!grouped.has(category)) {
        grouped.set(category, [])
      }
      grouped.get(category)!.push(session)
    })

    return grouped
  })

  // Get all categories for UI
  const allCategories = createMemo(() => {
    return Array.from(sessionsByCategory().keys())
  })

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(category)) {
        newSet.delete(category)
      } else {
        newSet.add(category)
      }
      return newSet
    })
  }

  const sessions = createMemo(() => allSessions().slice(0, displayLimit()))
  const hasMore = createMemo(() => allSessions().length > displayLimit())
  const currentSession = createMemo(() => sync.session.get(props.sessionID)!)

  return (
    <Show when={currentSession()}>
      <box flexShrink={0} gap={1} width={45}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            SESSIONS
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onToggle()
            }}
          >
            ◀
          </text>
        </box>

        {/* Search Field */}
        <box
          flexDirection="row"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
          border={["bottom"]}
          borderColor={theme.border}
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            openSearchDialog()
          }}
        >
          <text fg={theme.textMuted}>🔍</text>
          <box flexGrow={1}>
            <Show when={searchQuery()} fallback={<text fg={theme.textMuted}>Click to search...</text>}>
              <text fg={theme.text}>{searchQuery()}</text>
            </Show>
          </box>
          <Show when={searchQuery()}>
            <text
              fg={theme.textMuted}
              onMouseUp={(e) => {
                e.stopPropagation?.()
                setSearchQuery("")
              }}
            >
              ×
            </text>
          </Show>
        </box>

        <box overflow="hidden">
          <For each={allCategories()}>
            {(category) => {
              const isExpanded = () => expandedCategories().has(category)
              const categorySessions = () => sessionsByCategory().get(category) || []

              return (
                <>
                  <text
                    fg={theme.textMuted}
                    attributes={TextAttributes.BOLD}
                    wrapMode="none"
                    height={1}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      toggleCategory(category)
                    }}
                  >
                    {isExpanded() ? "▼" : "▶"} {category} ({categorySessions().length})
                  </text>
                  <Show when={isExpanded()}>
                    <For each={categorySessions()}>
                      {(session) => {
                        const [hover, setHover] = createSignal(false)
                        const isOpen = () => props.openTabs.includes(session.id)

                        return (
                          <text
                            fg={session.id === props.sessionID ? theme.accent : theme.text}
                            attributes={session.id === props.sessionID ? TextAttributes.BOLD : undefined}
                            wrapMode="none"
                            height={1}
                            renderBefore={function () {
                              const el = this as any
                              el.on("mouseenter", () => setHover(true))
                              el.on("mouseleave", () => setHover(false))
                            }}
                            onMouseUp={(evt) => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              const target = (evt as any).target
                              if (target?.textContent?.includes("×")) {
                                props.onClose(session.id)
                              } else if (session.id !== props.sessionID) {
                                props.onSelect(session.id)
                              }
                            }}
                          >
                            {session.id === props.sessionID ? "  ▶ " : "    "}
                            {Locale.truncate(Locale.stripMarkdown(session.title), isOpen() && hover() ? 33 : 37)}
                            {isOpen() && hover() && " ×"}
                          </text>
                        )
                      }}
                    </For>
                  </Show>
                </>
              )
            }}
          </For>
        </box>

        <box marginTop={1}>
          <text
            fg={theme.accent}
            attributes={TextAttributes.BOLD}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onSwitch()
            }}
          >
            New Session
          </text>
        </box>
      </box>
    </Show>
  )
}
