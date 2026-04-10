import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createResource, For, Show } from "solid-js"

const id = "internal:sidebar-quota"

type Line = {
  label: string
  utilization: number
  resetsAt?: string
}

type Account = {
  label?: string
  email?: string
  isActive?: boolean
}

type Usage = Partial<{
  anthropic: {
    anthropicUsage?: Partial<{
      fiveHour: { utilization: number; resetsAt?: string }
      sevenDay: { utilization: number; resetsAt?: string }
      sevenDaySonnet: { utilization: number; resetsAt?: string }
    }>
    accounts?: Account[]
  }
  codex: {
    codexUsage?: Partial<{
      fiveHour: { utilization: number; resetsAt?: string }
      sevenDay: { utilization: number; resetsAt?: string }
      planType: string
    }>
    accounts?: Account[]
  }
  minimax: {
    minimaxUsage?: Partial<{
      fiveHour: {
        utilization: number
        resetsAt?: string
        remainingCredits?: number
        totalCredits?: number
      }
    }>
    accounts?: Account[]
  }
  "github-copilot": {
    githubCopilotUsage?: Partial<{
      hasAccess: boolean
      statusMessage: string
      orgBillingBreakdown: {
        planType?: string
        activeSeats: number
        totalSeats: number
      }
    }>
    accounts?: Account[]
  }
}>

type Item = {
  title: string
  subtitle?: string
  info?: string
  lines: Line[]
  accounts?: Account[]
}

function reset(value?: string) {
  if (!value) return
  const diff = new Date(value).getTime() - Date.now()
  if (diff <= 0) return "now"
  const mins = Math.floor(diff / 60_000)
  const hrs = Math.floor(mins / 60)
  if (hrs > 0) return `${hrs}h ${mins % 60}m`
  return `${mins}m`
}

function codex(input?: Usage["codex"]): Item | undefined {
  const usage = input?.codexUsage
  const lines = [
    usage?.fiveHour ? { label: "Codex (5h)", ...usage.fiveHour } : undefined,
    usage?.sevenDay ? { label: "Codex (7d)", ...usage.sevenDay } : undefined,
  ].filter((item): item is Line => !!item)
  if (!lines.length) return
  return {
    title: "OpenAI Codex",
    subtitle: usage?.planType,
    lines,
    accounts: input?.accounts,
  }
}

function anthropic(input?: Usage["anthropic"]): Item | undefined {
  const usage = input?.anthropicUsage
  const lines = [
    usage?.fiveHour ? { label: "Current session", ...usage.fiveHour } : undefined,
    usage?.sevenDay ? { label: "Current week", ...usage.sevenDay } : undefined,
    usage?.sevenDaySonnet ? { label: "Sonnet week", ...usage.sevenDaySonnet } : undefined,
  ].filter((item): item is Line => !!item)
  if (!lines.length) return
  return {
    title: "Anthropic / Claude",
    subtitle: "Claude Pro/Max",
    lines,
    accounts: input?.accounts,
  }
}

function minimax(input?: Usage["minimax"]): Item | undefined {
  const usage = input?.minimaxUsage?.fiveHour
  if (!usage) return
  const credits =
    usage.remainingCredits !== undefined && usage.totalCredits !== undefined
      ? ` (${usage.remainingCredits}/${usage.totalCredits} credits)`
      : ""
  return {
    title: "MiniMax",
    lines: [{ label: `5-Hour Window${credits}`, utilization: usage.utilization, resetsAt: usage.resetsAt }],
    accounts: input?.accounts,
  }
}

function copilot(input?: Usage["github-copilot"]): Item | undefined {
  if (!input) return
  const usage = input.githubCopilotUsage
  return {
    title: "GitHub Copilot",
    subtitle: usage?.orgBillingBreakdown?.planType ?? (usage?.hasAccess ? "Access granted" : undefined),
    info:
      usage?.statusMessage ??
      (usage?.orgBillingBreakdown
        ? `${usage.orgBillingBreakdown.activeSeats}/${usage.orgBillingBreakdown.totalSeats} seats active`
        : "Connected"),
    lines: [],
    accounts: input.accounts,
  }
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [usage, act] = createResource(async () => ((await props.api.client.auth.usage()).data ?? {}) as Usage)

  const list = createMemo(() => {
    const data = usage()
    if (!data) return [] as Item[]
    return [anthropic(data.anthropic), codex(data.codex), minimax(data.minimax), copilot(data["github-copilot"])]
      .filter((item): item is Item => !!item)
  })

  const accounts = (item: Item) =>
    (item.accounts ?? [])
      .filter((item) => item.isActive)
      .map((item) => item.label ?? item.email ?? "default")
      .join(", ")

  return (
    <Show when={usage.loading || list().length > 0}>
      <box gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().text}>
            <b>Provider Quota</b>
          </text>
          <Show when={!usage.loading}>
            <text fg={theme().textMuted} onMouseDown={() => void act.refetch()}>
              ↻
            </text>
          </Show>
        </box>

        <Show when={usage.loading}>
          <text fg={theme().textMuted}>Loading...</text>
        </Show>

        <For each={list()}>
          {(item) => (
            <box>
              <text fg={theme().text}>
                <b>{item.title}</b>
              </text>
              <Show when={item.subtitle}>
                <text fg={theme().textMuted}>{item.subtitle}</text>
              </Show>
              <Show when={accounts(item)}>
                <text fg={theme().textMuted}>{accounts(item)}</text>
              </Show>
              <Show when={item.info && item.lines.length === 0}>
                <text fg={theme().textMuted}>{item.info}</text>
              </Show>
              <For each={item.lines}>
                {(line) => (
                  <text fg={theme().textMuted}>
                    {line.label} {line.utilization}% used
                    <Show when={reset(line.resetsAt)}>{(value) => ` · resets ${value()}`}</Show>
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
