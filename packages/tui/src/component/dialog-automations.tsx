import type { AutomationCondition, AutomationInfo, AutomationWhen } from "@opencode/client"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { DIALOG_LIST_INSET, DialogFooter, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import * as Locale from "../util/locale"
import { getScrollAcceleration } from "../util/scroll"

const STATUS_RANK: Record<AutomationInfo["status"], number> = {
  active: 0,
  paused: 1,
  done: 2,
}

function singleLine(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function formatWhen(when: AutomationWhen) {
  switch (when.type) {
    case "in":
      return `in ${when.in}`
    case "at":
      return `at ${when.at}`
    case "every":
      return `every ${when.every}`
    case "cron":
      return `cron ${when.cron}`
  }
}

function formatGateShort(item: AutomationInfo) {
  if (item.until) return `until ${item.until.type}`
  if (item.if) return `if ${item.if.type}`
  return undefined
}

function formatConditionLine(mode: "until" | "if", condition: AutomationCondition) {
  if (condition.type === "shell") {
    const suffix =
      condition.changes === true
        ? " (on change)"
        : condition.is !== undefined
          ? ` (equals ${JSON.stringify(condition.is)})`
          : condition.matches !== undefined
            ? ` (matches /${condition.matches}/)`
            : ""
    return `${mode} $ ${singleLine(condition.run)}${suffix}`
  }
  return `${mode} code: ${singleLine(condition.code)}`
}

function formatConditionFull(mode: "until" | "if", condition: AutomationCondition) {
  if (condition.type === "shell") {
    const guards = [
      condition.changes === true ? "wake when stdout changes" : undefined,
      condition.is !== undefined ? `wake when stdout == ${JSON.stringify(condition.is)}` : undefined,
      condition.matches !== undefined ? `wake when stdout matches /${condition.matches}/` : undefined,
    ].filter(Boolean)
    return [`Mode: ${mode} (shell)`, `Command: ${condition.run}`, ...guards].join("\n")
  }
  return `Mode: ${mode} (Code Mode)\n${condition.code}`
}

function formatRelative(targetMs: number, nowMs: number) {
  const diff = targetMs - nowMs
  const abs = Math.abs(diff)
  const seconds = Math.max(1, Math.round(abs / 1_000))
  const unit =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3_600
        ? `${Math.round(seconds / 60)}m`
        : seconds < 86_400
          ? `${Math.round(seconds / 3_600)}h`
          : `${Math.round(seconds / 86_400)}d`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

function previewLines(item: AutomationInfo, nowMs: number) {
  const lines: string[] = []
  if (item.until) lines.push(formatConditionLine("until", item.until))
  else if (item.if) lines.push(formatConditionLine("if", item.if))
  lines.push(`Prompt: ${singleLine(item.action.prompt)}`)
  const raw = item.lastOutput ? singleLine(item.lastOutput) : ""
  if (raw || item.lastOutcome) {
    const fired = item.lastFiredAt !== undefined ? ` ${formatRelative(item.lastFiredAt, nowMs)}` : ""
    const head = item.lastOutcome ? `${item.lastOutcome}${fired}` : `last${fired}`
    lines.push(`Last: ${raw ? `${head} — ${raw}` : head}`)
  }
  return lines
}

function StatusLabel(props: { item: AutomationInfo; now: number; loading: boolean }) {
  if (props.loading) return <>Updating …</>
  if (props.item.status === "active") {
    const due = props.item.nextDueAt !== undefined ? ` · ${formatRelative(props.item.nextDueAt, props.now)}` : ""
    return <span style={{ attributes: TextAttributes.BOLD }}>Active{due}</span>
  }
  if (props.item.status === "paused") {
    return <>{props.item.lastOutcome === "failed" ? "Paused (failed) !" : "Paused ○"}</>
  }
  if (props.item.lastOutcome === "expired") return <>Timed out !</>
  return <>Done ✓</>
}

export function DialogAutomations(props: { initialAutomationID?: string } = {}) {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const route = useRoute()
  const toast = useToast()
  const shortcuts = Keymap.useShortcuts()
  const theme = useTheme().surface("dialog")

  const [now, setNow] = createSignal(Date.now())
  const [focused, setFocused] = createSignal<string | undefined>(props.initialAutomationID)
  const [detailID, setDetailID] = createSignal<string | undefined>(undefined)
  const [toDelete, setToDelete] = createSignal<string | undefined>(undefined)
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())

  const currentSessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)

  const [schedules, { mutate, refetch }] = createResource(async () => {
    const list = await client.api.experimental.automation.list()
    return [...list]
  })

  onMount(() => {
    dialog.setSize("large")
    const tick = setInterval(() => setNow(Date.now()), 1_000)
    const poll = setInterval(() => void refetch(), 5_000)
    onCleanup(() => {
      clearInterval(tick)
      clearInterval(poll)
    })
  })

  const sessionLabel = (sessionID: string | undefined) => {
    if (!sessionID) return undefined
    const title = data.session.get(sessionID)?.title?.trim()
    if (title) return title
    return sessionID.slice(0, 12)
  }

  const ordered = createMemo(() => {
    const list = schedules.latest ?? schedules() ?? []
    const activeSession = currentSessionID()
    return [...list].toSorted((a, b) => {
      if (activeSession) {
        const aLocal = a.sessionID === activeSession ? 0 : 1
        const bLocal = b.sessionID === activeSession ? 0 : 1
        if (aLocal !== bLocal) return aLocal - bLocal
      }
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (rank !== 0) return rank
      return b.time.updated - a.time.updated
    })
  })

  createEffect(() => {
    const list = ordered()
    const current = focused()
    if (current && list.some((item) => item.id === current)) return
    setFocused(list[0]?.id)
  })

  const byID = createMemo(() => new Map(ordered().map((item) => [item.id, item])))
  const focusedItem = createMemo(() => (focused() ? byID().get(focused()!) : undefined))
  const detailItem = createMemo(() => (detailID() ? byID().get(detailID()!) : undefined))

  const statusColor = (item: AutomationInfo) => {
    if (item.status === "active") {
      return item.lastOutcome === "failed" ? theme.text.feedback.warning.base : theme.text.feedback.success.base
    }
    if (item.status === "paused" && item.lastOutcome === "failed") return theme.text.feedback.error.base
    if (item.status === "done" && item.lastOutcome === "expired") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  const markBusy = (id: string, active: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev)
      if (active) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const togglePause = (id: string) => {
    const item = byID().get(id)
    if (!item || item.status === "done" || busy().has(id)) return
    setToDelete(undefined)
    markBusy(id, true)
    const call =
      item.status === "active"
        ? client.api.experimental.automation.pause({ automationID: id })
        : client.api.experimental.automation.resume({ automationID: id })
    void call
      .then((updated) => {
        mutate((prev) => (prev ?? []).map((entry) => (entry.id === id ? updated : entry)))
      })
      .catch(toast.error)
      .finally(() => markBusy(id, false))
  }

  const removeSchedule = (id: string, confirmFirst = true) => {
    if (busy().has(id)) return
    if (confirmFirst && toDelete() !== id) {
      setToDelete(id)
      return
    }
    setToDelete(undefined)
    markBusy(id, true)
    void client.api.experimental.automation
      .delete({ automationID: id })
      .then(() => {
        if (detailID() === id) setDetailID(undefined)
        mutate((prev) => (prev ?? []).filter((entry) => entry.id !== id))
      })
      .catch(toast.error)
      .finally(() => markBusy(id, false))
  }

  const openSession = (sessionID: string | undefined) => {
    if (!sessionID) return
    route.navigate({ type: "session", sessionID })
    dialog.clear()
  }

  const options = createMemo((): DialogSelectOption<string>[] => {
    const activeSession = currentSessionID()
    const loadingIDs = busy()
    const currentNow = now()
    const selectedID = focused()
    return ordered().map((item) => {
      const deleting = toDelete() === item.id
      const pending = loadingIDs.has(item.id)
      const label = item.name?.trim() || Locale.truncate(singleLine(item.action.prompt), 46)
      const gate = formatGateShort(item)
      const trigger = formatWhen(item.when)
      const otherSession = activeSession && item.sessionID && item.sessionID !== activeSession
      const category = activeSession
        ? item.sessionID === activeSession
          ? "This session"
          : "Other sessions"
        : item.status === "active"
          ? "Active"
          : item.status === "paused"
            ? "Paused"
            : "Completed"
      const descParts = [gate, trigger, otherSession ? sessionLabel(item.sessionID) : undefined].filter(Boolean)
      const conditionText =
        item.until !== undefined
          ? item.until.type === "shell"
            ? item.until.run
            : item.until.code
          : item.if !== undefined
            ? item.if.type === "shell"
              ? item.if.run
              : item.if.code
            : ""
      return {
        value: item.id,
        title: deleting ? `Press ${shortcuts.get("dialog.automation.delete")} again to delete` : label,
        description: deleting ? undefined : descParts.join(" · "),
        details: !deleting && selectedID === item.id ? previewLines(item, currentNow) : undefined,
        category,
        searchText: [label, item.id, item.action.prompt, conditionText, trigger, sessionLabel(item.sessionID) ?? ""]
          .filter(Boolean)
          .join(" "),
        footer: <StatusLabel item={item} now={currentNow} loading={pending} />,
        footerColor: pending ? theme.text.muted : statusColor(item),
        bg: deleting ? theme.background.action.destructive.focused : undefined,
        fg: deleting ? theme.text.action.destructive.focused : undefined,
      }
    })
  })

  return (
    <box>
      <Show
        when={detailItem()}
        fallback={
          <DialogSelect
            title="Automations"
            searchInTitle
            titlePlaceholder="Search automations"
            options={options()}
            focusTarget={focused()}
            preserveSelection
            onMove={(option) => {
              setToDelete(undefined)
              setFocused(option.value)
            }}
            onSelect={(option) => {
              setToDelete(undefined)
              setDetailID(option.value)
            }}
            emptyView={
              <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET} gap={1}>
                <Show
                  when={!schedules.loading}
                  fallback={<Spinner color={theme.text.muted}>Loading automations…</Spinner>}
                >
                  <Show
                    when={!schedules.error}
                    fallback={<text fg={theme.text.feedback.error.base}>{errorMessage(schedules.error)}</text>}
                  >
                    <text fg={theme.text.muted}>
                      {(data.location.command.list(location.current ?? location.ref) ?? []).some(
                        (command) => command.name === "automate",
                      )
                        ? "No automations yet. Use /automate in a session to run a prompt on a timer, cron, or shell/code watch."
                        : 'No automations yet. Enable "experimental": { "automations": true } in opencode.json to use /automate in a session.'}
                    </text>
                  </Show>
                </Show>
              </box>
            }
            actions={[
              {
                command: "dialog.automation.toggle",
                title: (option) => {
                  const item = option ? byID().get(option.value) : focusedItem()
                  return item?.status === "paused" ? "resume" : "pause"
                },
                disabled: (option) => {
                  const item = option ? byID().get(option.value) : focusedItem()
                  return !item || item.status === "done"
                },
                onTrigger: (option) => {
                  setFocused(option.value)
                  togglePause(option.value)
                },
              },
              {
                command: "dialog.automation.delete",
                title: "delete",
                onTrigger: (option) => {
                  setFocused(option.value)
                  removeSchedule(option.value, true)
                },
              },
              {
                command: "dialog.automation.session",
                title: "open session",
                disabled: (option) => {
                  const item = option ? byID().get(option.value) : focusedItem()
                  return !item?.sessionID || item.sessionID === currentSessionID()
                },
                onTrigger: (option) => {
                  const item = byID().get(option.value)
                  openSession(item?.sessionID)
                },
              },
              {
                command: "dialog.automation.refresh",
                selection: "none",
                group: "secondary",
                title: "refresh",
                onTrigger: () => {
                  setToDelete(undefined)
                  void refetch()
                },
              },
            ]}
            footerHints={ordered().length > 0 ? [{ title: "inspect", label: "enter", group: "primary" }] : []}
          />
        }
      >
        {(item) => (
          <AutomationDetail
            item={item()}
            now={now()}
            sessionLabel={sessionLabel(item().sessionID)}
            canOpenSession={Boolean(item().sessionID && item().sessionID !== currentSessionID())}
            onBack={() => setDetailID(undefined)}
            onToggle={() => togglePause(item().id)}
            onDelete={() => removeSchedule(item().id, false)}
            onOpenSession={() => openSession(item().sessionID)}
          />
        )}
      </Show>
    </box>
  )
}

function AutomationDetail(props: {
  item: AutomationInfo
  now: number
  sessionLabel?: string
  canOpenSession: boolean
  onBack: () => void
  onToggle: () => void
  onDelete: () => void
  onOpenSession: () => void
}) {
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()
  const config = useConfig().data
  let scroll: ScrollBoxRenderable | undefined

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Back", group: "Dialog", run: props.onBack },
      ...(props.item.status !== "done"
        ? [
            {
              id: "dialog.automation.toggle",
              title: props.item.status === "paused" ? "Resume automation" : "Pause automation",
              group: "Dialog",
              run: props.onToggle,
            },
          ]
        : []),
      { id: "dialog.automation.delete", title: "Delete automation", group: "Dialog", run: props.onDelete },
      ...(props.canOpenSession
        ? [{ id: "dialog.automation.session", title: "Open session", group: "Dialog", run: props.onOpenSession }]
        : []),
    ],
  }))

  useKeyboard((event) => {
    if (event.name === "up") return scroll?.scrollBy(-1)
    if (event.name === "down") return scroll?.scrollBy(1)
    if (event.name === "pageup") return scroll?.scrollBy(-15)
    if (event.name === "pagedown") return scroll?.scrollBy(15)
  })

  const actions = () => [
    ...(props.item.status !== "done"
      ? [
          {
            title: props.item.status === "paused" ? "resume" : "pause",
            key: shortcuts.get("dialog.automation.toggle"),
            onTrigger: props.onToggle,
          },
        ]
      : []),
    ...(props.canOpenSession
      ? [{ title: "open session", key: shortcuts.get("dialog.automation.session"), onTrigger: props.onOpenSession }]
      : []),
    { title: "delete", key: shortcuts.get("dialog.automation.delete"), onTrigger: props.onDelete },
  ]

  const body = () => {
    const lines = [
      `ID: ${props.item.id}`,
      `Status: ${props.item.status}${props.item.lastOutcome ? ` (${props.item.lastOutcome})` : ""}`,
      `Trigger: ${formatWhen(props.item.when)} (${props.item.tz})`,
      props.item.nextDueAt !== undefined
        ? `Next due: ${Locale.datetime(props.item.nextDueAt)} (${formatRelative(props.item.nextDueAt, props.now)})`
        : undefined,
      props.item.endsAt !== undefined ? `Ends at: ${Locale.datetime(props.item.endsAt)}` : undefined,
      props.item.remainingRuns !== undefined ? `Remaining runs: ${props.item.remainingRuns}` : undefined,
      `Completed runs: ${props.item.runCount}`,
      props.sessionLabel ? `Session: ${props.sessionLabel} (${props.item.sessionID})` : undefined,
    ].filter(Boolean)

    const sections = [lines.join("\n")]
    if (props.item.until) sections.push(formatConditionFull("until", props.item.until))
    if (props.item.if) sections.push(formatConditionFull("if", props.item.if))
    sections.push(`Wake prompt:\n${props.item.action.prompt}`)
    if (props.item.lastOutput) sections.push(`Last output:\n${props.item.lastOutput}`)
    return sections.join("\n\n")
  }

  const title = () => props.item.name?.trim() || Locale.truncate(singleLine(props.item.action.prompt), 56)

  return (
    <DialogLayout
      header={
        <DialogHeader
          gap={2}
          onClose={props.onBack}
          titleView={
            <text
              attributes={TextAttributes.BOLD}
              fg={theme.text.base}
              flexGrow={1}
              minWidth={0}
              wrapMode="none"
              truncate
            >
              {title()}
            </text>
          }
        />
      }
      footer={{ actions: { primary: actions() } }}
      legacyFooter={<DialogFooter actions={{ secondary: actions(), primary: [{ title: "back", key: "esc" }] }} />}
    >
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={20}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <text fg={theme.text.base} wrapMode="word">
          {body()}
        </text>
      </scrollbox>
    </DialogLayout>
  )
}
