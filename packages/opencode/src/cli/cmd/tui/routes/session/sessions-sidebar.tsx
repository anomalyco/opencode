import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import { useRoute } from "@tui/context/route"
import "opentui-spinner/solid"

export function SessionsSidebar(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const { navigate } = useRoute()
  
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  
  const sessions = createMemo(() => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString()
    
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        
        if (category === today) {
          category = "Today"
        } else if (category === yesterday) {
          category = "Yesterday"
        } else {
          // Format as "Mon Dec 15"
          category = date.toLocaleDateString("en-US", { 
            weekday: "short", 
            month: "short", 
            day: "numeric" 
          })
        }
        
        const status = sync.data.session_status[x.id]
        const isWorking = status?.type === "busy"
        const isCurrent = x.id === props.sessionID
        
        return {
          ...x,
          category,
          isWorking,
          isCurrent,
        }
      })
      .slice(0, 50) // Limit to 50 most recent sessions
  })
  
  const groupedSessions = createMemo(() => {
    const groups: Map<string, typeof sessions extends () => infer T ? T : never> = new Map()
    
    for (const session of sessions()) {
      const existing = groups.get(session.category) || []
      groups.set(session.category, [...existing, session])
    }
    
    return Array.from(groups.entries())
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={42}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexGrow={1} gap={1}>
        <box>
          <text fg={theme.text}>
            <b>Sessions</b>
          </text>
          <text fg={theme.textMuted}>{sessions().length} total</text>
        </box>
        
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <For each={groupedSessions()}>
              {([category, items]) => (
                <box gap={0}>
                  <text fg={theme.textMuted}>
                    <b>{category}</b>
                  </text>
                  <For each={items}>
                    {(session) => (
                      <box
                        flexDirection="row"
                        gap={1}
                        backgroundColor={session.isCurrent ? theme.backgroundElement : undefined}
                        paddingLeft={session.isCurrent ? 1 : 0}
                        paddingRight={session.isCurrent ? 1 : 0}
                        onMouseDown={() => {
                          if (!session.isCurrent) {
                            navigate({
                              type: "session",
                              sessionID: session.id,
                            })
                          }
                        }}
                      >
                        <Show
                          when={session.isWorking}
                          fallback={
                            <text
                              flexShrink={0}
                              fg={session.isCurrent ? theme.primary : theme.textMuted}
                            >
                              {session.isCurrent ? "▶" : "•"}
                            </text>
                          }
                        >
                          <spinner
                            frames={spinnerFrames}
                            interval={80}
                            color={theme.primary}
                          />
                        </Show>
                        <text
                          fg={session.isCurrent ? theme.text : theme.textMuted}
                          wrapMode="word"
                          flexGrow={1}
                        >
                          {session.title}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
      </box>
      
      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>
          <b>Ctrl+X L</b> - Full session list
        </text>
      </box>
    </box>
  )
}
