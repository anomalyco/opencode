import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"

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

  const [displayLimit, setDisplayLimit] = createSignal(20)
  const [expandedCategories, setExpandedCategories] = createSignal<Set<string>>(new Set(['Today']))

  const allSessions = createMemo(() => {
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .filter((x) => {
        const title = x.title.toLowerCase()
        return !title.includes("clarifying") && 
               !title.includes("parsing") && 
               !title.includes("invalid input") &&
               !title.includes("discussing adsad") &&
               !title.startsWith("new session -")
      })
      .sort((a, b) => b.time.updated - a.time.updated)
  })

  // Group sessions by date
  const sessionsByCategory = createMemo(() => {
    const grouped = new Map<string, any[]>()
    const today = new Date()
    
    allSessions().forEach(session => {
      const sessionDate = new Date(session.time.updated)
      const isToday = sessionDate.toDateString() === today.toDateString()
      const category = isToday ? 'Today' : sessionDate.toLocaleDateString()
      
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
    setExpandedCategories(prev => {
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
                    {isExpanded() ? '▼' : '▶'} {category} ({categorySessions().length})
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
                              renderBefore={function() {
                                const el = this as any
                                el.on("mouseenter", () => setHover(true))
                                el.on("mouseleave", () => setHover(false))
                              }}
                              onMouseUp={(evt) => {
                                if (renderer.getSelection()?.getSelectedText()) return
                                const target = (evt as any).target
                                if (target?.textContent?.includes('×')) {
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
