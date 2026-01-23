import { For, createMemo, createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"

// Spinner
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinnerInitialized = false
const [spinnerIndex, setSpinnerIndex] = createSignal(0)

function initSpinner(): void {
  if (spinnerInitialized) return
  spinnerInitialized = true
  setInterval(() => setSpinnerIndex((prev) => (prev + 1) % FRAMES.length), 60)
}

function getSpinnerFrame(): string {
  initSpinner()
  return FRAMES[spinnerIndex()]
}

// Types
export interface SubagentPart {
  id: string
  status: () => "pending" | "running" | "completed" | "error"
  description: string
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

  return (
    <For each={props.groups}>
      {(group) => {
        const groupActive = () => group.parts.some((p) => p.status() === "running" || p.status() === "pending")
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
                const active = () => part.status() === "running" || part.status() === "pending"
                const indicator = createMemo(() => {
                  if (active()) return getSpinnerFrame()
                  return part.status() === "error" ? "✗" : "✓"
                })

                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    backgroundColor={hover() === part.id ? props.theme.backgroundHover : undefined}
                    onMouseOver={() => setHover(part.id)}
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
                      {part.description}
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
