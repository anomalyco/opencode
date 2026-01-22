import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { Installation } from "@/installation"
import { useTerminalDimensions } from "@opentui/solid"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: { context: Accessor<string | undefined>; cost: Accessor<string> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()} ({props.cost()})
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  // Build session path from root to current session
  const sessionPath = createMemo(() => {
    const path: Session[] = []
    let current: Session | undefined = session()
    while (current) {
      path.unshift(current)
      current = current.parentID ? sync.session.get(current.parentID) : undefined
    }
    return path
  })

  // Current depth (0 = root, 1 = first child, etc.)
  const depth = createMemo(() => sessionPath().length - 1)

  // Direct children of current session (for down navigation availability)
  const directChildren = createMemo(() => {
    const currentID = session()?.id
    if (!currentID) return []
    return sync.data.session.filter((x) => x.parentID === currentID)
  })

  // Siblings at current level (for left/right navigation availability)
  const siblings = createMemo(() => {
    const currentParentID = session()?.parentID
    if (!currentParentID) return []
    return sync.data.session.filter((x) => x.parentID === currentParentID)
  })

  // Navigation availability
  const canGoUp = createMemo(() => !!session()?.parentID)
  const canGoDown = createMemo(() => directChildren().length > 0)
  const canCycleSiblings = createMemo(() => siblings().length > 1)

  // Get display name for a session
  const getSessionDisplayName = (s: Session, isRoot: boolean) => {
    if (isRoot) {
      // Root session: show the title
      return s.title || s.id.slice(0, 8)
    }
    // Child session: extract agent name from title like "Description (@agent-name subagent)"
    const match = s.title?.match(/\(@([^)]+?)(?:\s+subagent)?\)/)
    if (match) {
      // Return just the agent name without @ and "subagent"
      return match[1]
    }
    // Fallback to title or shortened ID
    return s.title || s.id.slice(0, 8)
  }

  // Get UP navigation label based on depth
  const upLabel = createMemo(() => {
    const d = depth()
    if (d <= 0) return "" // Root has no parent
    if (d === 1) return "Parent" // Depth 1 → Root
    return `Child(L${d - 1})` // Depth N → Child(L{N-1})
  })

  // Get DOWN navigation label based on depth
  const downLabel = createMemo(() => {
    const d = depth()
    return `Child(L${d + 1})` // Depth N → Child(L{N+1})
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  const [hover, setHover] = createSignal<"parent" | "root" | "prev" | "next" | "down" | "breadcrumb" | null>(null)
  const [hoverBreadcrumbIdx, setHoverBreadcrumbIdx] = createSignal<number | null>(null)

  // Calculate breadcrumb text for a set of segments
  const calcBreadcrumbLength = (segments: Session[], truncated: boolean) => {
    let len = 0
    segments.forEach((s, i) => {
      len += getSessionDisplayName(s, !s.parentID).length
      if (i < segments.length - 1) {
        len += truncated && i === 0 ? 9 : 3 // " > ... > " or " > "
      }
    })
    return len
  }

  // Dynamic breadcrumb truncation based on available width
  const breadcrumbSegments = createMemo(() => {
    const path = sessionPath()
    const availableWidth = dimensions().width - 40 // Reserve ~40 chars for right-side stats

    // Try full path first
    const fullLength = calcBreadcrumbLength(path, false)
    if (fullLength <= availableWidth || path.length <= 2) {
      return { truncated: false, segments: path }
    }

    // Truncate: show root + ... + last N segments that fit
    // Start with root + last segment, add more if space allows
    for (let keepLast = path.length - 1; keepLast >= 1; keepLast--) {
      const segments = [path[0], ...path.slice(-keepLast)]
      const len = calcBreadcrumbLength(segments, true)
      if (len <= availableWidth || keepLast === 1) {
        return { truncated: true, segments }
      }
    }

    // Fallback: root + last segment
    return { truncated: true, segments: [path[0], path[path.length - 1]] }
  })

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            {/* Subagent session: 3-row layout */}
            <box flexDirection="column" gap={0}>
              {/* Row 1: Breadcrumb trail */}
              <box flexDirection="row" gap={0}>
                <For each={breadcrumbSegments().segments}>
                  {(segment, index) => (
                    <>
                      <box
                        onMouseOver={() => {
                          setHover("breadcrumb")
                          setHoverBreadcrumbIdx(index())
                        }}
                        onMouseOut={() => {
                          setHover(null)
                          setHoverBreadcrumbIdx(null)
                        }}
                        onMouseUp={() => {
                          navigate({ type: "session", sessionID: segment.id })
                        }}
                        backgroundColor={
                          hover() === "breadcrumb" && hoverBreadcrumbIdx() === index()
                            ? theme.backgroundElement
                            : theme.backgroundPanel
                        }
                      >
                        <text fg={index() === breadcrumbSegments().segments.length - 1 ? theme.text : theme.textMuted}>
                          <Show when={index() === breadcrumbSegments().segments.length - 1} fallback={getSessionDisplayName(segment, !segment.parentID)}>
                            <b>{getSessionDisplayName(segment, !segment.parentID)}</b>
                          </Show>
                        </text>
                      </box>
                      <Show when={index() < breadcrumbSegments().segments.length - 1}>
                        {/* Show "... >" after root when truncated */}
                        <text fg={theme.textMuted}>
                          {index() === 0 && breadcrumbSegments().truncated ? " > ... >" : " > "}
                        </text>
                      </Show>
                    </>
                  )}
                </For>
              </box>

              {/* Row 2: Divider + stats */}
              <box flexDirection="row" gap={1}>
                <box flexGrow={1}>
                  <text fg={theme.border}>────────────────────────────────────────</text>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <ContextInfo context={context} cost={cost} />
                  <text fg={theme.textMuted}>v{Installation.VERSION}</text>
                </box>
              </box>

              {/* Row 3: Navigation hints */}
              <box flexDirection="row" gap={2}>
                <Show when={canGoUp()}>
                  <box
                    onMouseOver={() => setHover("parent")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.parent")}
                    backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>
                      {upLabel()} <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
                    </text>
                  </box>
                </Show>
                <Show when={depth() >= 2}>
                  <box
                    onMouseOver={() => setHover("root")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.root")}
                    backgroundColor={hover() === "root" ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>
                      Root <span style={{ fg: theme.textMuted }}>{keybind.print("session_root")}</span>
                    </text>
                  </box>
                </Show>
                <Show when={canCycleSiblings()}>
                  <box
                    onMouseOver={() => setHover("next")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.child.next")}
                    backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>
                      Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                    </text>
                  </box>
                  <box
                    onMouseOver={() => setHover("prev")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.child.previous")}
                    backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>
                      Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                    </text>
                  </box>
                </Show>
                <Show when={canGoDown()}>
                  <box
                    onMouseOver={() => setHover("down")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.child.down")}
                    backgroundColor={hover() === "down" ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>
                      {downLabel()} <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_down")}</span>
                    </text>
                  </box>
                </Show>
              </box>
            </box>
          </Match>
          <Match when={true}>
            {/* Root session: responsive layout */}
            <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
              <Title session={session} />
              <ContextInfo context={context} cost={cost} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
