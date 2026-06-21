import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createMemo, onMount, Show } from "solid-js"
import { useTheme, type Theme } from "../context/theme"
import { useSync } from "../context/sync"
import { useRouteData } from "../context/route"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

type TeamMemberStatus = "ready" | "busy" | "shutdown_requested" | "shutdown" | "error"
type TeamExecutionStatus =
  | "idle"
  | "starting"
  | "running"
  | "cancel_requested"
  | "cancelling"
  | "cancelled"
  | "completing"
  | "completed"
  | "failed"
  | "timed_out"
type TeamPlanApproval = "none" | "pending" | "approved" | "rejected"

type TeamResponse = {
  team: {
    name: string
    delegate?: boolean
    members?: Array<{
      name: string
      sessionID: string
      agent: string
      status: TeamMemberStatus
      execution_status?: TeamExecutionStatus
      model?: string
      planApproval?: TeamPlanApproval
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
  const toast = useToast()
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRouteData("session")
  const nav = useRoute()
  const sdk = useSDK()

  const teamInfo = createMemo(() => sync.data.team[route.sessionID])
  const isLead = createMemo(() => teamInfo()?.role === "lead")

  const applyTeamResponse = (data: TeamResponse | null) => {
    if (!data) return
    sync.set("team", route.sessionID, {
      teamName: data.team.name,
      role: data.role,
      memberName: data.memberName,
      delegate: data.team.delegate,
      members: data.team.members ?? [],
      tasks: data.tasks ?? [],
    })
  }

  const refreshTeam = () =>
    fetch(`${sdk.url}/team/by-session/${route.sessionID}`)
      .then((r: Response) => r.json())
      .then((data: TeamResponse | null) => applyTeamResponse(data))
      .catch(() => {})

  onMount(() => {
    dialog.setSize("large")
    void refreshTeam()
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const info = teamInfo()
    if (!info) return []

    const teamOption: DialogSelectOption<string> = {
      title: "Team controls",
      value: `team:${info.teamName}`,
      category: "Team",
      footer: [info.role, info.delegate ? "delegate mode" : null].filter(Boolean).join(" | "),
      gutter: <text fg={theme.primary}>#</text>,
    }

    const memberOptions: DialogSelectOption<string>[] = info.members.map((m) => ({
      title: `${m.name} (@${m.agent})`,
      value: `member:${m.sessionID}`,
      category: "Teammates",
      footer: [
        `status: ${m.status}`,
        m.execution_status ? `run: ${m.execution_status}` : null,
        m.planApproval && m.planApproval !== "none" ? `plan: ${m.planApproval}` : null,
        m.model ? `model: ${m.model}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
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

    return [teamOption, ...memberOptions, ...taskOptions]
  })

  const selectedMember = (option: DialogSelectOption<string> | undefined) => {
    if (!option) return
    const [type, id] = option.value.split(":", 2)
    if (type !== "member" || !id) return
    return teamInfo()?.members.find((member) => member.sessionID === id)
  }

  const postTeam = (path: string, body: unknown, message: string, refresh = true, afterSuccess?: () => void) =>
    fetch(`${sdk.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (!response.ok) {
          toast.show({ message: `${message} failed`, variant: "error" })
          return
        }
        toast.show({ message, variant: "success" })
        afterSuccess?.()
        if (refresh) void refreshTeam()
      })
      .catch(() => {
        toast.show({ message: `${message} failed`, variant: "error" })
      })

  const memberPlanNeedsReview = (option: DialogSelectOption<string> | undefined) => {
    const member = selectedMember(option)
    return isLead() && (member?.planApproval === "pending" || member?.planApproval === "rejected")
  }

  const memberCanCancel = (option: DialogSelectOption<string> | undefined) => {
    const member = selectedMember(option)
    return isLead() && (member?.status === "busy" || member?.status === "shutdown_requested")
  }

  const memberCanShutdown = (option: DialogSelectOption<string> | undefined) => {
    const member = selectedMember(option)
    return isLead() && !!member && member.status !== "shutdown"
  }

  const canCleanup = () => {
    const info = teamInfo()
    return isLead() && !!info && info.members.every((member) => member.status === "shutdown")
  }

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
            disabled: () => !teamInfo(),
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
          {
            command: "team.delegate.toggle",
            title: "toggle delegate",
            disabled: () => !isLead(),
            onTrigger: () => {
              const info = teamInfo()
              if (!info) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/delegate`,
                { enabled: !info.delegate },
                "Delegate mode updated",
              )
            },
          },
          {
            command: "team.approve_plan",
            title: "approve plan",
            disabled: (option) => !memberPlanNeedsReview(option),
            onTrigger: (option) => {
              const info = teamInfo()
              const member = selectedMember(option)
              if (!info || !member) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/approve-plan`,
                { member: member.name, approved: true },
                `Approved @${member.name}`,
              )
            },
          },
          {
            command: "team.reject_plan",
            title: "reject plan",
            disabled: (option) => !memberPlanNeedsReview(option),
            onTrigger: (option) => {
              const info = teamInfo()
              const member = selectedMember(option)
              if (!info || !member) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/approve-plan`,
                { member: member.name, approved: false },
                `Rejected @${member.name}`,
              )
            },
          },
          {
            command: "team.cancel",
            title: "cancel work",
            disabled: (option) => !memberCanCancel(option),
            onTrigger: (option) => {
              const info = teamInfo()
              const member = selectedMember(option)
              if (!info || !member) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/cancel`,
                { member: member.name },
                `Cancelled @${member.name}`,
              )
            },
          },
          {
            command: "team.shutdown",
            title: "shutdown",
            disabled: (option) => !memberCanShutdown(option),
            onTrigger: (option) => {
              const info = teamInfo()
              const member = selectedMember(option)
              if (!info || !member) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/shutdown`,
                { member: member.name },
                `Shutdown requested for @${member.name}`,
              )
            },
          },
          {
            command: "team.cleanup",
            title: "cleanup",
            side: "right",
            disabled: () => !canCleanup(),
            onTrigger: () => {
              const info = teamInfo()
              if (!info) return
              void postTeam(
                `/team/${encodeURIComponent(info.teamName)}/cleanup`,
                {},
                `Cleaned up ${info.teamName}`,
                false,
                () => dialog.clear(),
              )
            },
          },
        ]}
      />
    </Show>
  )
}
