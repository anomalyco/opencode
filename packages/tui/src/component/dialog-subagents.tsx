import { TextAttributes } from "@opentui/core"
import { createMemo, Show, type JSX } from "solid-js"
import type { SessionInfo } from "@opencode/client"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { useSubagentTeams } from "../context/subagent-teams"
import { useTheme, useThemes } from "../context/theme"
import { Locale } from "../util/locale"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"

type Entry = {
  value: string
  title: string
  description?: string
  current: boolean
  category: string
  categoryView?: JSX.Element
}

function label(session: SessionInfo) {
  const base = withTimestampedFallback(session)
  if (/^[\w-]+-\d+ \((leader|member)\)/.test(base)) return base
  const match = base.match(/@(\w+) subagent/)
  const agent = session.agent ? Locale.titlecase(session.agent) : match ? Locale.titlecase(match[1]) : undefined
  const name = match ? base.replace(match[0], "").trim() || base : base
  return agent ? `${agent}: ${name}` : name
}

function root(sessions: readonly SessionInfo[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const start = byID.get(sessionID)
  if (!start) return
  let current = start
  for (;;) {
    const parent = current.parentID ? byID.get(current.parentID) : undefined
    if (!parent) break
    current = parent
  }
  return current
}

function descendants(sessions: readonly SessionInfo[], rootID: string) {
  const children = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const group = children.get(session.parentID)
    if (group) group.push(session)
    else children.set(session.parentID, [session])
  }
  const result: SessionInfo[] = []
  const walk = (parentID: string) => {
    for (const session of children.get(parentID) ?? []) {
      result.push(session)
      walk(session.id)
    }
  }
  walk(rootID)
  return result
}

export function DialogSubagents() {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const teams = useSubagentTeams()
  const theme = useTheme().surface("dialog")
  const themes = useThemes()

  const currentSessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const accent = () => theme.hue.accent[themes.mode() === "light" ? 800 : 200]

  const heading = (category: string, divider: boolean) => (
    <>
      <Show when={divider}>
        <box border={["top"]} borderColor={theme.border.base} width="100%" flexShrink={0} />
      </Show>
      <text fg={accent()} attributes={TextAttributes.BOLD}>
        {category}
      </text>
    </>
  )

  const options = createMemo<Entry[]>(() => {
    const sessionID = currentSessionID()
    const current = sessionID ? data.session.get(sessionID) : undefined
    if (!current) return []
    const sessions = data.session.list()
    const top = root(sessions, current.id)
    if (!top) return []
    const all = descendants(sessions, top.id)

    const groups = teams.group(all, current.location)
    const grouped = new Set(groups.flatMap((group) => group.sessions.map((session) => session.id)))
    const entry = (session: SessionInfo, category: string, categoryView?: JSX.Element): Entry => ({
      value: session.id,
      title: label(session),
      description: data.session.status(session.id) === "running" ? "Running" : undefined,
      current: session.id === sessionID,
      category,
      categoryView,
    })

    // Boss (the root session) always sits at the very top and never enters the
    // pinned team slots, so it stays reachable regardless of team activity.
    const result: Entry[] = [entry(top, "")]
    result.push(
      ...groups.flatMap((group, index) =>
        group.sessions.map((session, position) =>
          entry(session, group.team, position === 0 ? heading(group.team, index > 0) : undefined),
        ),
      ),
    )

    // Non-team descendants stay visible in a plain section below the teams.
    const rest = all.filter((session) => !grouped.has(session.id))
    result.push(
      ...rest.map((session, index) =>
        entry(session, "Subagents", index === 0 ? heading("Subagents", groups.length > 0) : undefined),
      ),
    )

    return result
  })

  return (
    <DialogSelect
      title="Subagents"
      current={currentSessionID()}
      options={options()}
      skipFilter
      renderFilter={false}
      sectionNavigation
      heightScale={1.7}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
    />
  )
}
