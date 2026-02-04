import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { RGBA } from "@opentui/core"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const VALID_STATUSES = new Set(["pending", "running", "completed", "error"])
type SubagentStatus = "pending" | "running" | "completed" | "error"

export function normalizeStatus(s: unknown): SubagentStatus {
  return VALID_STATUSES.has(s as string) ? (s as SubagentStatus) : "pending"
}

export interface SubagentPart {
  id: string
  status: () => SubagentStatus
  description: () => string
  sessionId: () => string | undefined
}

export interface SubagentGroup {
  name: string
  parts: SubagentPart[]
}

export interface SubagentListProps {
  groups: SubagentGroup[]
  theme: { text: RGBA; textMuted: RGBA; success: RGBA; backgroundHover: RGBA }
  onNavigate: (sessionId: string) => void
}

export function SubagentList(props: SubagentListProps) {
  const [hover, setHover] = createSignal<string | null>(null)
  const [spinnerIndex, setSpinnerIndex] = createSignal(0)

  // Spinner lifecycle: only runs when there are active items, cleaned up properly
  createEffect(() => {
    const hasActive = props.groups.some((g) =>
      g.parts.some((p) => {
        const status = p.status()
        return status === "running" || status === "pending"
      }),
    )
    if (!hasActive) return

    const id = setInterval(() => setSpinnerIndex((i) => (i + 1) % SPINNER_FRAMES.length), 80)
    onCleanup(() => clearInterval(id))
  })

  const getSpinnerFrame = () => SPINNER_FRAMES[spinnerIndex()]

  return (
    <For each={props.groups}>
      {(group) => {
        const groupActive = () =>
          group.parts.some((p) => {
            const status = p.status()
            return status === "running" || status === "pending"
          })

        return (
          <box>
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} style={{ fg: groupActive() ? props.theme.success : props.theme.text }}>
                •
              </text>
              <text fg={props.theme.text} wrapMode="word">
                {group.name}
              </text>
            </box>
            <For each={group.parts}>
              {(part) => {
                const active = () => {
                  const status = part.status()
                  return status === "running" || status === "pending"
                }
                const hasSession = () => part.sessionId() !== undefined
                const indicator = () => {
                  if (active()) return getSpinnerFrame()
                  return part.status() === "error" ? "✗" : "✓"
                }

                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    backgroundColor={hasSession() && hover() === part.id ? props.theme.backgroundHover : undefined}
                    onMouseOver={() => hasSession() && setHover(part.id)}
                    onMouseOut={() => setHover(null)}
                    onMouseDown={() => {
                      const sid = part.sessionId()
                      if (sid) props.onNavigate(sid)
                    }}
                  >
                    <text flexShrink={0} fg={active() ? props.theme.success : props.theme.textMuted}>
                      {indicator()}
                    </text>
                    <text fg={active() ? props.theme.text : props.theme.textMuted} wrapMode="word">
                      <Show when={part.description()} fallback={part.id}>
                        {part.description()}
                      </Show>
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        )
      }}
    </For>
  )
}
