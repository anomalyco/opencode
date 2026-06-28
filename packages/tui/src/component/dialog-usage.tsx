import { TextAttributes } from "@opentui/core"
import { For, Show, createMemo, createResource } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useBindings } from "../keymap"

type SessionRow = {
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  model?: { id: string; providerID: string }
  time: { updated: number }
}

type Bucket = {
  sessions: number
  input: number
  output: number
  cache: number
  cost: number
}

type ModelBucket = {
  model: string
  tokens: number
  cost: number
}

type WindowRow = Bucket & { label: string }

type Report = {
  totalSessions: number
  windows: WindowRow[]
  models: ModelBucket[]
}

function emptyBucket(): Bucket {
  return { sessions: 0, input: 0, output: 0, cache: 0, cost: 0 }
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M"
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K"
  return num.toString()
}

// Local midnight, start of this week (Monday) and start of this month.
function windowStarts() {
  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  // getDay() is 0 (Sun) to 6 (Sat); shift so Monday is the first day.
  week.setDate(week.getDate() - ((today.getDay() + 6) % 7))
  const month = new Date(now.getFullYear(), now.getMonth(), 1)
  return { today: today.getTime(), week: week.getTime(), month: month.getTime() }
}

// Aggregate cost and tokens from the client session list. This mirrors the
// numbers behind `opencode stats`, but only for the sessions returned here.
function buildReport(sessions: SessionRow[]): Report {
  const starts = windowStarts()
  const windows: WindowRow[] = [
    { label: "Today", ...emptyBucket() },
    { label: "This Week", ...emptyBucket() },
    { label: "This Month", ...emptyBucket() },
    { label: "All Time", ...emptyBucket() },
  ]
  const models = new Map<string, ModelBucket>()

  function add(bucket: Bucket, input: number, output: number, cache: number, cost: number) {
    bucket.sessions += 1
    bucket.input += input
    bucket.output += output
    bucket.cache += cache
    bucket.cost += cost
  }

  for (const session of sessions) {
    const cost = session.cost ?? 0
    const tokens = session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    const input = tokens.input ?? 0
    const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    const cache = (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
    const updated = session.time.updated

    if (updated >= starts.today) add(windows[0], input, output, cache, cost)
    if (updated >= starts.week) add(windows[1], input, output, cache, cost)
    if (updated >= starts.month) add(windows[2], input, output, cache, cost)
    add(windows[3], input, output, cache, cost)

    const key = session.model ? `${session.model.providerID}/${session.model.id}` : "unknown"
    let entry = models.get(key)
    if (!entry) {
      entry = { model: key, tokens: 0, cost: 0 }
      models.set(key, entry)
    }
    entry.tokens += input + output + cache
    entry.cost += cost
  }

  return {
    totalSessions: sessions.length,
    windows,
    models: [...models.values()].sort((a, b) => b.cost - a.cost).slice(0, 6),
  }
}

function windowRow(label: string, sessions: string, input: string, output: string, cache: string, cost: string) {
  return (
    label.padEnd(10) +
    sessions.padStart(5) +
    input.padStart(8) +
    output.padStart(8) +
    cache.padStart(8) +
    cost.padStart(9)
  )
}

function modelRow(model: string, tokens: string, cost: string) {
  const name = model.length > 28 ? model.slice(0, 27) + "..." : model
  return name.padEnd(28) + tokens.padStart(9) + cost.padStart(11)
}

export function DialogUsage() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Close usage",
        group: "Dialog",
        cmd: () => dialog.clear(),
      },
    ],
  }))

  const [sessions] = createResource(async () => {
    // Scope to the current project and cap the row count to keep this snappy.
    const result = await sdk.client.session.list({ scope: "project", limit: 1000 })
    return result.data ?? []
  })

  const report = createMemo(() => {
    const list = sessions()
    if (!list) return undefined
    return buildReport(list)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>Token and cost usage for the current project.</text>
      <Show when={!sessions.loading} fallback={<text fg={theme.textMuted}>Loading usage...</text>}>
        <Show when={sessions.error}>
          <text fg={theme.textMuted}>Could not load usage.</text>
        </Show>
        <Show when={report()}>
          {(value) => (
            <Show when={value().totalSessions > 0} fallback={<text fg={theme.textMuted}>No usage recorded yet.</text>}>
              <box gap={1}>
                <box>
                  <text fg={theme.textMuted}>{windowRow("Period", "Sess", "Input", "Output", "Cache", "Cost")}</text>
                  <For each={value().windows}>
                    {(row) => (
                      <text fg={theme.text}>
                        {windowRow(
                          row.label,
                          row.sessions.toString(),
                          formatNumber(row.input),
                          formatNumber(row.output),
                          formatNumber(row.cache),
                          "$" + row.cost.toFixed(2),
                        )}
                      </text>
                    )}
                  </For>
                </box>
                <Show when={value().models.length > 0}>
                  <box>
                    <text fg={theme.textMuted}>{modelRow("Model", "Tokens", "Cost")}</text>
                    <For each={value().models}>
                      {(model) => (
                        <text fg={theme.text}>
                          {modelRow(model.model, formatNumber(model.tokens), "$" + model.cost.toFixed(4))}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            </Show>
          )}
        </Show>
      </Show>
    </box>
  )
}
