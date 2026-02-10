import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { Installation } from "../../../../../installation"

function memberStatusIcon(status: string): string {
  switch (status) {
    case "busy":
      return "*"
    case "ready":
      return "o"
    case "shutdown_requested":
      return "!"
    case "shutdown":
      return "x"
    case "error":
      return "!"
    default:
      return "?"
  }
}

function TeamBadge(props: { teamInfo: any }) {
  const { theme } = useTheme()
  const info = () => props.teamInfo
  if (!info()) return null

  const activeCount = () => info().members?.filter((m: any) => m.status === "busy").length ?? 0
  const idleCount = () => info().members?.filter((m: any) => m.status === "ready").length ?? 0
  const totalCount = () => info().members?.length ?? 0

  return (
    <Switch>
      <Match when={info().role === "lead"}>
        <text fg={theme.primary} wrapMode="none" flexShrink={0}>
          Team: {info().teamName} ({activeCount()} active, {idleCount()} idle, {totalCount()} total)
        </text>
      </Match>
      <Match when={info().role === "member"}>
        <text fg={theme.primary} wrapMode="none" flexShrink={0}>
          {info().memberName} @{info().teamName}
        </text>
      </Match>
    </Switch>
  )
}

/** Persistent status bar showing team members — displayed below the header when a team is active */
function TeamStatusBar(props: { teamInfo: any }) {
  const { theme } = useTheme()
  const nav = useRoute()
  const info = () => props.teamInfo
  if (!info()) return null
  const members = () => info().members ?? []
  if (members().length === 0) return null

  const tasks = () => info().tasks ?? []
  const completedTasks = () => tasks().filter((t: any) => t.status === "completed").length

  // Find what task a member is working on
  const memberTask = (memberName: string) => {
    return tasks().find((t: any) => t.assignee === memberName && t.status === "in_progress")
  }

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      backgroundColor={theme.backgroundPanel}
      flexShrink={0}
    >
      <For each={members()}>
        {(member: any) => {
          const statusColor = () => {
            if (member.planApproval === "pending") return theme.warning
            switch (member.status) {
              case "busy":
                return theme.success
              case "ready":
                return theme.textMuted
              case "shutdown_requested":
                return theme.warning
              case "shutdown":
                return theme.error
              case "error":
                return theme.error
              default:
                return theme.textMuted
            }
          }
          const task = () => memberTask(member.name)
          const planLabel = () => {
            if (member.planApproval === "pending") return " [awaiting plan approval]"
            if (member.planApproval === "approved") return " [plan approved]"
            return ""
          }
          return (
            <box
              flexDirection="row"
              gap={1}
              onMouseUp={() => {
                if (member.sessionID) {
                  nav.navigate({ type: "session", sessionID: member.sessionID })
                }
              }}
            >
              <text fg={statusColor()} wrapMode="none">
                {memberStatusIcon(member.status)} {member.name}
                {member.model ? ` (${member.model})` : ""}
                {planLabel()}
              </text>
              <Show when={task()}>
                <text fg={theme.textMuted} wrapMode="none">
                  — {task()!.content.length > 50 ? task()!.content.slice(0, 50) + "..." : task()!.content}
                </text>
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={tasks().length > 0}>
        <text fg={theme.textMuted} wrapMode="none">
          tasks: {completedTasks()}/{tasks().length}
          <Show when={info().delegate}> | delegate mode</Show>
        </text>
      </Show>
    </box>
  )
}

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

export function Header(props: { sidebarVisible?: boolean }) {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const teamInfo = createMemo(() => sync.data.team[route.sessionID])

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
    if (last.tokens.cache.read > 0) {
      const totalInput = last.tokens.input + last.tokens.cache.read + last.tokens.cache.write
      const pct = Math.round((last.tokens.cache.read / totalInput) * 100)
      result += ` (${pct}% cached)`
    }
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)

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
            <box flexDirection="column" gap={1}>
              <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>
                    <b>{teamInfo() ? "Teammate" : "Subagent"} session</b>
                  </text>
                  <Show when={teamInfo()}>
                    <TeamBadge teamInfo={teamInfo()} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <ContextInfo context={context} cost={cost} />
                  <text fg={theme.textMuted}>v{Installation.VERSION}</text>
                </box>
              </box>
              <box flexDirection="row" gap={2}>
                <box
                  onMouseOver={() => setHover("parent")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.parent")}
                  backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
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
              </box>
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection="column" gap={0}>
              <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={1}>
                <Title session={session} />
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <ContextInfo context={context} cost={cost} />
                  <text fg={theme.textMuted}>v{Installation.VERSION}</text>
                </box>
              </box>
              <Show when={teamInfo()}>
                <TeamBadge teamInfo={teamInfo()} />
              </Show>
            </box>
          </Match>
        </Switch>
      </box>
      <Show when={teamInfo() && !props.sidebarVisible}>
        <TeamStatusBar teamInfo={teamInfo()} />
      </Show>
    </box>
  )
}
