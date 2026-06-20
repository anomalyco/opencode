import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createMemo, onMount, Show } from "solid-js"
import { useTheme, type Theme } from "../context/theme"
import { useSync } from "../context/sync"
import { useRouteData } from "../context/route"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"

type TeamMemberStatus = "ready" | "busy" | "shutdown_requested" | "shutdown" | "error"

type TeamResponse = {
  team: {
    name: string
    delegate?: boolean
    members?: Array<{
      name: string
      sessionID: string
      agent: string
      status: TeamMemberStatus
    }>
  }
  role: "lead" | "member"
  memberName?: string
  tasks?: Array<{
    id: string
    content: string
    status: string
    priority: string
    assignee?: string
    depends_on?: string[]
  }>
}

function statusIcon(status: string): string {
  switch (status) {
    case "busy":
      return "*"
    case "ready":
      return "o"
    case "shutdown_requested":
      return "!"
    case "shutdown":
      return "x"
    case "completed":
      return "+"
    case "in_progress":
      return ">"
    case "blocked":
      return "#"
    case "cancelled":
      return "-"
    case "pending":
      return " "
    default:
      return "?"
  }
}

function statusColor(status: string, theme: Theme) {
  switch (status) {
    case "busy":
      return theme.primary
    case "ready":
      return theme.textMuted
    case "shutdown_requested":
      return theme.warning
    case "shutdown":
      return theme.error
    case "completed":
      return theme.success
    case "in_progress":
      return theme.primary
    case "blocked":
      return theme.error
    case "pending":
      return theme.textMuted
    default:
      return theme.textMuted
  }
}

export function DialogTeam() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRouteData("session")
  const nav = useRoute()
  const sdk = useSDK()

  const teamInfo = createMemo(() => sync.data.team[route.sessionID])

  onMount(() => {
    dialog.setSize("large")
    fetch(`${sdk.url}/team/by-session/${route.sessionID}`)
      .then((r: Response) => r.json())
      .then((data: TeamResponse | null) => {
        if (!data) return
        sync.set("team", route.sessionID, {
          teamName: data.team.name,
          role: data.role,
          memberName: data.memberName,
          delegate: data.team.delegate,
          members: data.team.members ?? [],
          tasks: data.tasks ?? [],
        })
      })
      .catch(() => {})
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const info = teamInfo()
    if (!info) return []

    const memberOptions: DialogSelectOption<string>[] = info.members.map((m) => ({
      title: `${m.name} (@${m.agent})`,
      value: `member:${m.sessionID}`,
      category: "Teammates",
      footer: `Status: ${m.status}`,
      gutter: <text fg={statusColor(m.status, theme)}>{statusIcon(m.status)}</text>,
    }))

    const taskOptions: DialogSelectOption<string>[] = (info.tasks ?? []).map((t) => ({
      title: t.content,
      value: `task:${t.id}`,
      category: "Shared Tasks",
      footer: [
        t.status,
        t.assignee ? `@${t.assignee}` : null,
        t.depends_on?.length ? `depends: ${t.depends_on.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
      gutter: <text fg={statusColor(t.status, theme)}>{statusIcon(t.status)}</text>,
      disabled: t.status === "completed" || t.status === "cancelled",
    }))

    return [...memberOptions, ...taskOptions]
  })

  const handleSelect = (option: DialogSelectOption<string>) => {
    const [type, id] = option.value.split(":", 2)
    if (type === "member" && id) {
      dialog.clear()
      nav.navigate({ type: "session", sessionID: id })
    }
  }

  return (
    <Show
      when={teamInfo()}
      fallback={
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={1}>
              Agent Team
            </text>
            <text fg={theme.textMuted}>esc</text>
          </box>
          <text fg={theme.textMuted}>No active team for this session.</text>
          <text fg={theme.textMuted}>The lead agent can create a team using the team_create tool.</text>
        </box>
      }
    >
      <DialogSelect
        title={`Team: ${teamInfo()!.teamName} (${teamInfo()!.role})`}
        options={options()}
        onSelect={handleSelect}
        actions={[
          {
            command: "team.lead",
            title: "go to lead",
            onTrigger: () => {
              const info = teamInfo()
              if (!info) return
              for (const [sid, entry] of Object.entries(sync.data.team)) {
                if (entry.teamName === info.teamName && entry.role === "lead") {
                  dialog.clear()
                  nav.navigate({ type: "session", sessionID: sid })
                  return
                }
              }
            },
          },
        ]}
      />
    </Show>
  )
}
