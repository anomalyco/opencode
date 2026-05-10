import { base64Encode } from "@opencode-ai/core/util/encode"
import type {
  Automation,
  AutomationCreateInput,
  AutomationFinding,
  AutomationRun,
  AutomationUpdateInput,
  SnapshotFileDiff,
} from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Select } from "@opencode-ai/ui/select"
import { Switch as Toggle } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { batch, createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelKey } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { formatServerError } from "@/utils/server-errors"

type PageTab = "automations" | "inbox"
type RunView = "inbox" | "all"
type Mode = "new" | "edit"
type ScheduleType = Automation["schedule"]["type"]
type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
type ExecutionMode = Automation["executionMode"]
type AutomationKind = Automation["kind"]
type PermissionProfile = Automation["permissionProfile"]
type NotificationBehavior = Automation["notificationBehavior"]
type ReasoningEffort = NonNullable<Automation["reasoningEffort"]>

type FormState = {
  title: string
  enabled: boolean
  kind: AutomationKind
  prompt: string
  scheduleType: ScheduleType
  everyMinutes: number
  time: string
  timezone: string
  days: Weekday[]
  executionMode: ExecutionMode
  model: string
  reasoningEffort: ReasoningEffort
  permissionProfile: PermissionProfile
  notificationBehavior: NotificationBehavior
  maxRuntimeMinutes: string
  startsAt: string
  endsAt: string
}

const scheduleTypes: ScheduleType[] = ["interval", "daily", "weekly"]
const executionModes: ExecutionMode[] = ["local", "worktree"]
const automationKinds: AutomationKind[] = ["standalone", "thread"]
const reasoningEfforts: ReasoningEffort[] = ["none", "low", "medium", "high"]
const permissionProfiles: PermissionProfile[] = [
  "read_only",
  "repo_write_no_network",
  "repo_write_with_tests",
  "repo_write_network_requires_approval",
]
const notificationBehaviors: NotificationBehavior[] = ["auto_archive_no_findings", "inbox"]
const weekdays: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const inboxStatuses: AutomationRun["status"][] = ["completed_with_findings", "failed", "needs_approval"]
const activeStatuses: AutomationRun["status"][] = ["queued", "preparing", "running", "needs_approval"]

function timezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function defaultForm(model: string): FormState {
  return {
    title: "",
    enabled: true,
    kind: "standalone",
    prompt: "",
    scheduleType: "interval",
    everyMinutes: 60,
    time: "09:00",
    timezone: timezone(),
    days: ["mon", "tue", "wed", "thu", "fri"],
    executionMode: "local",
    model,
    reasoningEffort: "none",
    permissionProfile: "read_only",
    notificationBehavior: "auto_archive_no_findings",
    maxRuntimeMinutes: "",
    startsAt: "",
    endsAt: "",
  }
}

function toDateTimeLocal(value?: number) {
  if (!value) return ""
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocal(value: string) {
  if (!value.trim()) return undefined
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
}

function formFromAutomation(automation: Automation, fallbackModel: string): FormState {
  const base = defaultForm(fallbackModel)
  const schedule = automation.schedule
  return {
    ...base,
    title: automation.title,
    enabled: automation.enabled,
    kind: automation.kind,
    prompt: automation.prompt,
    scheduleType: schedule.type,
    everyMinutes: schedule.type === "interval" ? schedule.everyMinutes : base.everyMinutes,
    time: schedule.type === "interval" ? base.time : schedule.time,
    timezone: schedule.type === "interval" ? base.timezone : schedule.timezone,
    days: schedule.type === "weekly" ? [...schedule.days] : base.days,
    executionMode: automation.executionMode,
    model: automation.model,
    reasoningEffort: automation.reasoningEffort ?? "none",
    permissionProfile: automation.permissionProfile,
    notificationBehavior: automation.notificationBehavior,
    maxRuntimeMinutes: automation.maxRuntimeMinutes ? String(automation.maxRuntimeMinutes) : "",
    startsAt: toDateTimeLocal(automation.time.starts),
    endsAt: toDateTimeLocal(automation.time.ends),
  }
}

function isInboxRun(run: AutomationRun) {
  return inboxStatuses.includes(run.status)
}

function isActiveRun(run: AutomationRun) {
  return activeStatuses.includes(run.status)
}

function label(value: string) {
  if (value === "none") return "Off"
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function automationKindLabel(value: AutomationKind) {
  return value === "thread" ? "Thread (accumulate context)" : "Standalone (new context)"
}

function executionModeLabel(value: ExecutionMode) {
  return value === "worktree" ? "Dedicated Git worktree" : "Project folder"
}

function permissionProfileLabel(value: PermissionProfile) {
  return label(value)
}

function formatTime(value?: number) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatSchedule(schedule: Automation["schedule"]) {
  if (schedule.type === "interval") return `Every ${schedule.everyMinutes} min`
  if (schedule.type === "daily") return `Daily at ${schedule.time}`
  return `${schedule.days.map(label).join(", ")} at ${schedule.time}`
}

function statusClass(status: AutomationRun["status"]) {
  if (status === "completed_with_findings") return "text-icon-warning-active"
  if (status === "failed") return "text-icon-critical-base"
  if (status === "needs_approval") return "text-icon-info-active"
  if (status === "completed_no_findings") return "text-icon-success-base"
  if (activeStatuses.includes(status)) return "text-icon-info-active"
  return "text-text-base"
}

function formatFindingsCount(count: number) {
  return count === 1 ? "1 finding" : `${count} findings`
}

function jsonText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return
  if ("summary" in value && typeof value.summary === "string") return value.summary
  if ("message" in value && typeof value.message === "string") return value.message
  if ("error" in value && typeof value.error === "string") return value.error
  if (!("data" in value) || typeof value.data !== "object" || value.data === null) return
  if ("message" in value.data && typeof value.data.message === "string") return value.data.message
  if ("summary" in value.data && typeof value.data.summary === "string") return value.data.summary
}

function parseJsonText(text: string) {
  try {
    return jsonText(JSON.parse(text))
  } catch {
    return undefined
  }
}

function cleanAutomationText(value?: string) {
  const text = value?.trim()
  if (!text) return ""
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const candidate = fenced.startsWith("json\n") ? fenced.slice(5).trim() : fenced
  return parseJsonText(candidate) ?? text
}

function normalizedAutomationText(value?: string) {
  return cleanAutomationText(value).replace(/\s+/g, " ").trim().toLowerCase()
}

function shouldShowRunSummary(summary: string, findings: AutomationFinding[]) {
  const normalized = normalizedAutomationText(summary)
  if (!normalized) return false
  if (findings.length !== 1) return true
  const details = normalizedAutomationText(findings[0]?.details)
  if (!details) return true
  if (details === normalized) return false
  return findings[0]?.title !== "Automation report" || !details.startsWith(normalized)
}

export default function AutomationsPage() {
  const sdk = useSDK()
  const local = useLocal()
  const language = useLanguage()
  const sync = useSync()
  const navigate = useNavigate()

  const currentModel = createMemo(() => {
    const model = local.model.current()
    return model ? `${model.provider.id}/${model.id}` : ""
  })

  const [state, setState] = createStore({
    tab: "automations" as PageTab,
    mode: "new" as Mode,
    runView: "inbox" as RunView,
    selectedAutomationID: undefined as string | undefined,
    selectedRunID: undefined as string | undefined,
    busy: undefined as string | undefined,
  })
  const [form, setForm] = createStore<FormState>(defaultForm(currentModel()))
  const [diff, setDiff] = createSignal<{ runID: string; files: SnapshotFileDiff[] } | undefined>()
  const [diffLoading, setDiffLoading] = createSignal(false)
  const modelOptions = createMemo(() =>
    local.model.list().filter((model) => local.model.visible({ providerID: model.provider.id, modelID: model.id })),
  )
  const selectedModel = createMemo(() => {
    const [providerID, modelID] = form.model.split("/")
    return modelOptions().find((model) => model.provider.id === providerID && model.id === modelID)
  })
  const automationModel = createMemo(() => ({
    ...local.model,
    current: selectedModel,
    set(item: ModelKey | undefined) {
      if (!item) return
      setForm("model", `${item.providerID}/${item.modelID}`)
    },
  }))
  const modelTriggerLabel = createMemo(() => {
    const model = selectedModel()
    if (model) return model.name
    return form.model.trim() || currentModel() || "Default model"
  })
  const executionModeOptions = createMemo(() => {
    if (sync.project?.vcs === "git" || form.executionMode === "worktree") return executionModes
    return executionModes.filter((mode) => mode !== "worktree")
  })
  const loadAutomations = async () => {
    const result = await sdk.client.automation.list()
    return result.data ?? []
  }

  const loadRuns = async () => {
    const result = await sdk.client.automation.runs({ limit: "100" })
    return result.data ?? []
  }

  const [automations, automationActions] = createResource(() => sdk.directory, loadAutomations)
  const [runs, runActions] = createResource(() => sdk.directory, loadRuns)
  const [findings] = createResource(
    () => state.selectedRunID,
    async (runID) => {
      if (!runID) return []
      const result = await sdk.client.automation.run.findings({ runID })
      return result.data ?? []
    },
  )

  const automationList = createMemo(() => automations() ?? [])
  const runList = createMemo(() => runs() ?? [])
  const inboxRuns = createMemo(() => runList().filter((run) => isInboxRun(run) && !run.time.archived))
  const visibleRuns = createMemo(() => (state.runView === "inbox" ? inboxRuns() : runList()))
  const unreadCount = createMemo(() => inboxRuns().filter((run) => !run.time.read).length)
  const selectedAutomation = createMemo(() =>
    automationList().find((automation) => automation.id === state.selectedAutomationID),
  )
  const selectedRun = createMemo(() => runList().find((run) => run.id === state.selectedRunID))
  const latestRunByAutomation = createMemo(() => {
    const map = new Map<string, AutomationRun>()
    for (const run of runList()) {
      if (!map.has(run.automationID)) map.set(run.automationID, run)
    }
    return map
  })

  const reload = async () => {
    await Promise.all([automationActions.refetch(), runActions.refetch()])
  }

  const reloadRuns = async () => {
    await runActions.refetch()
  }

  const showError = (error: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(error, language.t),
    })
  }

  const runAction = async (busy: string, action: () => Promise<void>, success?: string) => {
    if (state.busy) return
    setState("busy", busy)
    try {
      await action()
      if (success) {
        showToast({ variant: "success", icon: "circle-check", title: success })
      }
    } catch (error) {
      showError(error)
    } finally {
      setState("busy", undefined)
    }
  }

  const selectAutomation = (automation: Automation) => {
    batch(() => {
      setState("mode", "edit")
      setState("selectedAutomationID", automation.id)
      setForm(reconcile(formFromAutomation(automation, currentModel())))
    })
  }

  const newAutomation = () => {
    batch(() => {
      setState("mode", "new")
      setState("selectedAutomationID", undefined)
      setForm(reconcile(defaultForm(currentModel())))
    })
  }

  const buildPayload = (): AutomationCreateInput | undefined => {
    const title = form.title.trim()
    const prompt = form.prompt.trim()
    if (!title || !prompt) {
      showToast({
        variant: "error",
        title: "Missing fields",
        description: "Title and prompt are required.",
      })
      return
    }
    if (form.scheduleType === "weekly" && form.days.length === 0) {
      showToast({
        variant: "error",
        title: "Missing schedule",
        description: "Choose at least one weekday.",
      })
      return
    }
    const startsAt = fromDateTimeLocal(form.startsAt)
    const endsAt = fromDateTimeLocal(form.endsAt)
    if (startsAt && endsAt && startsAt >= endsAt) {
      showToast({
        variant: "error",
        title: "Invalid window",
        description: "The end time must be after the start time.",
      })
      return
    }

    const maxRuntimeMinutes = form.maxRuntimeMinutes.trim() ? Number(form.maxRuntimeMinutes) : undefined
    if (maxRuntimeMinutes !== undefined && (!Number.isFinite(maxRuntimeMinutes) || maxRuntimeMinutes < 1)) {
      showToast({
        variant: "error",
        title: "Invalid runtime",
        description: "Max runtime must be a positive number.",
      })
      return
    }

    const schedule: AutomationCreateInput["schedule"] =
      form.scheduleType === "interval"
        ? { type: "interval", everyMinutes: Math.max(1, Math.floor(form.everyMinutes || 1)) }
        : form.scheduleType === "daily"
          ? { type: "daily", time: form.time, timezone: form.timezone.trim() || timezone() }
          : { type: "weekly", days: [...form.days], time: form.time, timezone: form.timezone.trim() || timezone() }

    return {
      title,
      enabled: form.enabled,
      kind: form.kind,
      prompt,
      schedule,
      executionMode: form.executionMode,
      model: form.model.trim() || undefined,
      reasoningEffort: form.reasoningEffort,
      permissionProfile: form.permissionProfile,
      notificationBehavior: form.notificationBehavior,
      maxRuntimeMinutes: maxRuntimeMinutes === undefined ? undefined : Math.floor(maxRuntimeMinutes),
      startsAt,
      endsAt,
    }
  }

  const saveAutomation = (event: SubmitEvent) => {
    event.preventDefault()
    const payload = buildPayload()
    if (!payload) return
    void runAction(
      "save",
      async () => {
        const result =
          state.mode === "edit" && state.selectedAutomationID
            ? await sdk.client.automation.update({
                automationID: state.selectedAutomationID,
                automationUpdateInput: payload satisfies AutomationUpdateInput,
              })
            : await sdk.client.automation.create({ automationCreateInput: payload })
        await reload()
        if (result.data) selectAutomation(result.data)
      },
      state.mode === "edit" ? "Automation updated" : "Automation created",
    )
  }

  const updateEnabled = (automation: Automation, enabled: boolean) => {
    void runAction(
      `${automation.id}:enabled`,
      async () => {
        await sdk.client.automation.update({
          automationID: automation.id,
          automationUpdateInput: { enabled },
        })
        await reload()
      },
      enabled ? "Automation enabled" : "Automation disabled",
    )
  }

  const runNow = (automation: Automation) => {
    void runAction(
      `${automation.id}:run`,
      async () => {
        const result = await sdk.client.automation.runNow({ automationID: automation.id })
        await reload()
        if (result.data) {
          setState("tab", "inbox")
          setState("runView", "all")
          setState("selectedRunID", result.data.id)
        }
      },
      "Automation queued",
    )
  }

  const duplicateAutomation = (automation: Automation) => {
    void runAction(
      `${automation.id}:duplicate`,
      async () => {
        const result = await sdk.client.automation.duplicate({ automationID: automation.id })
        await reload()
        if (result.data) selectAutomation(result.data)
      },
      "Automation duplicated",
    )
  }

  const deleteAutomation = (automation: Automation) => {
    if (!window.confirm(`Delete "${automation.title}"?`)) return
    void runAction(
      `${automation.id}:delete`,
      async () => {
        await sdk.client.automation.delete({ automationID: automation.id })
        await reload()
        newAutomation()
      },
      "Automation deleted",
    )
  }

  const viewRuns = (automation: Automation) => {
    const latest = runList().find((run) => run.automationID === automation.id)
    batch(() => {
      setState("tab", "inbox")
      setState("runView", "all")
      setState("selectedRunID", latest?.id)
    })
  }

  const markRunRead = (run: AutomationRun, read = true) => {
    void runAction(`${run.id}:read`, async () => {
      await sdk.client.automation.run.read({ runID: run.id, read })
      await reload()
    })
  }

  const selectRun = (run: AutomationRun) => {
    setState("selectedRunID", run.id)
    if (isInboxRun(run) && !run.time.read && !run.time.archived) markRunRead(run, true)
  }

  const archiveRun = (run: AutomationRun) => {
    void runAction(
      `${run.id}:archive`,
      async () => {
        await sdk.client.automation.run.archive({ runID: run.id, archived: true })
        await reload()
      },
      "Run archived",
    )
  }

  const cancelRun = (run: AutomationRun) => {
    void runAction(
      `${run.id}:cancel`,
      async () => {
        await sdk.client.automation.run.cancel({ runID: run.id })
        await reload()
      },
      "Run cancelled",
    )
  }

  const openTranscript = (run: AutomationRun) => {
    if (!run.sessionID) return
    navigate(`/${base64Encode(run.worktreePath ?? run.directory)}/session/${run.sessionID}`)
  }

  const loadDiff = (run: AutomationRun) => {
    void runAction(`${run.id}:diff`, async () => {
      setDiffLoading(true)
      try {
        const result = await sdk.client.automation.run.diff({ runID: run.id })
        setDiff({ runID: run.id, files: result.data ?? [] })
      } finally {
        setDiffLoading(false)
      }
    })
  }

  const setScheduleType = (value: ScheduleType | undefined) => {
    if (!value) return
    setForm("scheduleType", value)
  }

  const setExecutionMode = (value: ExecutionMode | undefined) => {
    if (!value) return
    batch(() => {
      setForm("executionMode", value)
      if (value === "local" && form.permissionProfile === "repo_write_no_network") {
        setForm("permissionProfile", "read_only")
      }
      if (value === "worktree" && form.permissionProfile === "read_only") {
        setForm("permissionProfile", "repo_write_no_network")
      }
    })
  }

  const toggleDay = (day: Weekday) => {
    setForm(
      "days",
      produce((days) => {
        const index = days.indexOf(day)
        if (index === -1) days.push(day)
        else days.splice(index, 1)
      }),
    )
  }

  createEffect(() => {
    const items = automationList()
    if (automations.loading) return
    if (state.mode === "new") return
    if (state.selectedAutomationID && items.some((automation) => automation.id === state.selectedAutomationID)) return
    const first = items[0]
    if (first) selectAutomation(first)
    else newAutomation()
  })

  createEffect(() => {
    const items = visibleRuns()
    if (state.selectedRunID && items.some((run) => run.id === state.selectedRunID)) return
    setState("selectedRunID", items[0]?.id)
  })

  let previousRunID: string | undefined
  createEffect(() => {
    const runID = state.selectedRunID
    if (previousRunID === runID) return
    previousRunID = runID
    setDiff(undefined)
  })

  onMount(() => {
    const timer = setInterval(() => {
      if (state.tab !== "inbox") return
      void reloadRuns()
    }, 15_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="size-full min-w-0 min-h-0 bg-background-base flex flex-col overflow-hidden">
      <div class="shrink-0 border-b border-border-weak-base px-6 py-4 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-18-medium text-text-strong">Automations</h1>
          <div class="text-12-regular text-text-base truncate">{sdk.directory}</div>
        </div>
        <div class="flex items-center gap-2">
          <Show when={unreadCount() > 0}>
            <div class="rounded-md bg-surface-base px-2 py-1 text-12-medium text-text-strong">
              {unreadCount()} unread
            </div>
          </Show>
          <Button size="small" icon="plus-small" onClick={newAutomation}>
            New Automation
          </Button>
        </div>
      </div>

      <Tabs
        value={state.tab}
        onChange={(value) => setState("tab", value as PageTab)}
        class="flex-1 min-h-0 flex flex-col"
      >
        <Tabs.List class="shrink-0 px-6 pt-3">
          <Tabs.Trigger value="automations">Automations</Tabs.Trigger>
          <Tabs.Trigger value="inbox">Inbox ({unreadCount()})</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="automations" class="flex-1 min-h-0">
          <div class="size-full grid grid-cols-[320px_minmax(0,1fr)] max-lg:grid-cols-1 overflow-hidden">
            <div class="border-r border-border-weak-base min-h-0 flex flex-col max-lg:border-r-0 max-lg:border-b">
              <div class="shrink-0 px-4 py-3 flex items-center justify-between">
                <div class="text-12-medium text-text-weak">Configured</div>
                <Show when={automations.loading}>
                  <div class="text-12-regular text-text-weak">Loading</div>
                </Show>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto">
                <Show
                  when={automationList().length > 0}
                  fallback={<div class="px-4 py-8 text-14-regular text-text-base">No automations yet.</div>}
                >
                  <For each={automationList()}>
                    {(automation) => {
                      const latest = () => latestRunByAutomation().get(automation.id)
                      return (
                        <div
                          class="w-full border-t border-border-weaker-base flex items-start hover:bg-surface-base transition-colors"
                          classList={{
                            "bg-surface-base": state.selectedAutomationID === automation.id,
                          }}
                        >
                          <button
                            type="button"
                            class="flex-1 min-w-0 px-4 py-3 text-left"
                            onClick={() => selectAutomation(automation)}
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="text-14-medium text-text-strong truncate">{automation.title}</div>
                                <div class="mt-1 text-12-regular text-text-base truncate">
                                  {formatSchedule(automation.schedule)}
                                </div>
                              </div>
                              <Show when={!automation.enabled}>
                                <span class="shrink-0 text-11-medium text-text-weak">Off</span>
                              </Show>
                            </div>
                            <div class="mt-2 flex items-center justify-between gap-2 text-12-regular">
                              <span class="text-text-weak truncate">
                                {executionModeLabel(automation.executionMode)}
                              </span>
                              <span class={latest() ? statusClass(latest()!.status) : "text-text-weak"}>
                                {latest() ? label(latest()!.status) : "No runs"}
                              </span>
                            </div>
                          </button>
                          <div class="shrink-0 px-3 pt-3">
                            <Toggle
                              checked={automation.enabled}
                              hideLabel
                              onChange={(checked) => updateEnabled(automation, checked)}
                            >
                              Enabled
                            </Toggle>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </Show>
              </div>
            </div>

            <form onSubmit={saveAutomation} class="min-h-0 overflow-y-auto">
              <div class="max-w-5xl px-6 py-5 flex flex-col gap-6">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h2 class="text-16-medium text-text-strong">
                      {state.mode === "new" ? "New Automation" : "Edit Automation"}
                    </h2>
                    <Show when={selectedAutomation()}>
                      {(automation) => (
                        <div class="text-12-regular text-text-base">
                          Next run: {formatTime(automation().time.nextRun)}
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="flex items-center gap-2">
                    <Toggle checked={form.enabled} onChange={(checked) => setForm("enabled", checked)}>
                      Enabled
                    </Toggle>
                  </div>
                </div>

                <div class="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
                  <TextField label="Title" value={form.title} onChange={(value) => setForm("title", value)} />
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Kind</div>
                    <Select
                      options={automationKinds}
                      current={form.kind}
                      label={automationKindLabel}
                      onSelect={(value) => value && setForm("kind", value)}
                      class="w-full"
                    />
                  </div>
                </div>

                <TextField
                  label="Prompt"
                  multiline
                  class="min-h-32"
                  value={form.prompt}
                  onChange={(value) => setForm("prompt", value)}
                />

                <div class="grid grid-cols-3 max-xl:grid-cols-2 max-lg:grid-cols-1 gap-4">
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Schedule</div>
                    <Select
                      options={scheduleTypes}
                      current={form.scheduleType}
                      label={label}
                      onSelect={setScheduleType}
                      class="w-full"
                    />
                  </div>

                  <Show
                    when={form.scheduleType === "interval"}
                    fallback={
                      <>
                        <TextField
                          label="Time"
                          type="time"
                          value={form.time}
                          onChange={(value) => setForm("time", value)}
                        />
                        <TextField
                          label="Timezone"
                          value={form.timezone}
                          onChange={(value) => setForm("timezone", value)}
                        />
                      </>
                    }
                  >
                    <TextField
                      label="Every minutes"
                      type="number"
                      min={1}
                      value={String(form.everyMinutes)}
                      onChange={(value) => setForm("everyMinutes", Math.max(1, Math.floor(Number(value) || 1)))}
                    />
                  </Show>
                </div>

                <Show when={form.scheduleType === "weekly"}>
                  <div class="flex flex-wrap gap-2">
                    <For each={weekdays}>
                      {(day) => (
                        <button
                          type="button"
                          class="h-8 px-3 rounded-md border border-border-base text-12-medium text-text-base hover:bg-surface-base"
                          classList={{
                            "bg-surface-base text-text-strong": form.days.includes(day),
                          }}
                          onClick={() => toggleDay(day)}
                        >
                          {label(day).slice(0, 3)}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="grid grid-cols-3 max-xl:grid-cols-2 max-lg:grid-cols-1 gap-4">
                  <TextField
                    label="Starts"
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(value) => setForm("startsAt", value)}
                  />
                  <TextField
                    label="Ends"
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(value) => setForm("endsAt", value)}
                  />
                  <TextField
                    label="Max runtime minutes"
                    type="number"
                    min={1}
                    value={form.maxRuntimeMinutes}
                    onChange={(value) => setForm("maxRuntimeMinutes", value)}
                  />
                </div>

                <div class="grid grid-cols-3 max-xl:grid-cols-2 max-lg:grid-cols-1 gap-4">
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Execution</div>
                    <Select
                      options={executionModeOptions()}
                      current={form.executionMode}
                      label={executionModeLabel}
                      onSelect={setExecutionMode}
                      class="w-full"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Model</div>
                    <ModelSelectorPopover
                      model={automationModel()}
                      triggerAs={Button}
                      triggerProps={{
                        variant: "secondary",
                        size: "normal",
                        class: "w-full min-w-0 justify-between text-13-regular text-text-base group",
                      }}
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <Show when={selectedModel()?.provider.id}>
                          <ProviderIcon
                            id={selectedModel()?.provider.id ?? ""}
                            class="size-4 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-150"
                          />
                        </Show>
                        <span class="truncate">{modelTriggerLabel()}</span>
                      </span>
                      <Icon name="chevron-down" size="small" class="shrink-0" />
                    </ModelSelectorPopover>
                  </div>
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Reasoning</div>
                    <Select
                      options={reasoningEfforts}
                      current={form.reasoningEffort}
                      label={label}
                      onSelect={(value) => value && setForm("reasoningEffort", value)}
                      class="w-full"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Permissions</div>
                    <Select
                      options={permissionProfiles}
                      current={form.permissionProfile}
                      label={permissionProfileLabel}
                      onSelect={(value) => value && setForm("permissionProfile", value)}
                      class="w-full"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak">Completion</div>
                    <Select
                      options={notificationBehaviors}
                      current={form.notificationBehavior}
                      label={(value) => (value === "inbox" ? "Always inbox" : "Archive no findings")}
                      onSelect={(value) => value && setForm("notificationBehavior", value)}
                      class="w-full"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3 pt-2 border-t border-border-weak-base">
                  <div class="flex items-center gap-2">
                    <Show when={selectedAutomation()}>
                      {(automation) => (
                        <>
                          <Button type="button" size="small" icon="enter" onClick={() => runNow(automation())}>
                            Run Now
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            icon="copy"
                            onClick={() => duplicateAutomation(automation())}
                          >
                            Duplicate
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            icon="trash"
                            onClick={() => deleteAutomation(automation())}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </Show>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={selectedAutomation()}>
                      {(automation) => (
                        <Button type="button" size="small" variant="ghost" onClick={() => viewRuns(automation())}>
                          View Runs
                        </Button>
                      )}
                    </Show>
                    <Button type="submit" size="small" disabled={!!state.busy}>
                      {state.mode === "new" ? "Create" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </Tabs.Content>

        <Tabs.Content value="inbox" class="flex-1 min-h-0">
          <div class="size-full grid grid-cols-[380px_minmax(0,1fr)] max-lg:grid-cols-1 overflow-hidden">
            <div class="border-r border-border-weak-base min-h-0 flex flex-col max-lg:border-r-0 max-lg:border-b">
              <div class="shrink-0 px-4 py-3 flex items-center justify-between gap-3">
                <Select
                  options={["inbox", "all"] as RunView[]}
                  current={state.runView}
                  label={(value) => (value === "inbox" ? "Inbox" : "All runs")}
                  onSelect={(value) => value && setState("runView", value)}
                  size="small"
                />
                <Button size="small" variant="ghost" onClick={() => void reload()}>
                  Refresh
                </Button>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto">
                <Show
                  when={visibleRuns().length > 0}
                  fallback={<div class="px-4 py-8 text-14-regular text-text-base">No runs to show.</div>}
                >
                  <For each={visibleRuns()}>
                    {(run) => {
                      const automation = () => automationList().find((item) => item.id === run.automationID)
                      return (
                        <button
                          type="button"
                          class="w-full border-t border-border-weaker-base px-4 py-3 text-left hover:bg-surface-base transition-colors"
                          classList={{ "bg-surface-base": state.selectedRunID === run.id }}
                          onClick={() => selectRun(run)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="text-14-medium text-text-strong truncate">
                                {automation()?.title ?? "Automation run"}
                              </div>
                              <div class="mt-1 text-12-regular text-text-base truncate">
                                {formatTime(run.time.queued)}
                              </div>
                            </div>
                            <Show when={isInboxRun(run) && !run.time.read && !run.time.archived}>
                              <span class="shrink-0 rounded-sm bg-surface-base px-1.5 py-0.5 text-11-medium text-text-strong">
                                New
                              </span>
                            </Show>
                          </div>
                          <div class="mt-2 flex items-center justify-between gap-2 text-12-regular">
                            <span class={statusClass(run.status)}>{label(run.status)}</span>
                            <span class="text-text-weak">
                              {run.time.archived ? "Archived" : formatFindingsCount(run.findingsCount)}
                            </span>
                          </div>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </div>
            </div>

            <div class="min-h-0 overflow-y-auto">
              <Show
                when={selectedRun()}
                fallback={<div class="px-6 py-8 text-14-regular text-text-base">Select a run.</div>}
              >
                {(run) => {
                  const automation = () => automationList().find((item) => item.id === run().automationID)
                  const files = () => (diff()?.runID === run().id ? diff()!.files : undefined)
                  const runFindings = () => (findings() ?? []) as AutomationFinding[]
                  const runSummary = () => cleanAutomationText(run().summary ?? run().error)
                  return (
                    <div class="max-w-5xl px-6 py-5 flex flex-col gap-6">
                      <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                          <h2 class="text-16-medium text-text-strong truncate">
                            {automation()?.title ?? "Automation run"}
                          </h2>
                          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12-regular text-text-base">
                            <span>{formatTime(run().time.queued)}</span>
                            <span class={statusClass(run().status)}>{label(run().status)}</span>
                            <span>{executionModeLabel(run().executionModeSnapshot)}</span>
                            <Show when={run().time.archived}>
                              <span>Archived</span>
                            </Show>
                            <span class="truncate">{run().modelSnapshot}</span>
                          </div>
                        </div>
                        <div class="flex items-center gap-1">
                          <Show when={run().sessionID}>
                            <Tooltip value="Open transcript" placement="top">
                              <IconButton
                                icon="new-session"
                                variant="ghost"
                                aria-label="Open transcript"
                                onClick={() => openTranscript(run())}
                              />
                            </Tooltip>
                          </Show>
                          <Tooltip value="View diff" placement="top">
                            <IconButton
                              icon="code-lines"
                              variant="ghost"
                              aria-label="View diff"
                              disabled={diffLoading()}
                              onClick={() => loadDiff(run())}
                            />
                          </Tooltip>
                          <Show when={isActiveRun(run())}>
                            <Tooltip value="Cancel run" placement="top">
                              <IconButton
                                icon="close"
                                variant="ghost"
                                aria-label="Cancel run"
                                onClick={() => cancelRun(run())}
                              />
                            </Tooltip>
                          </Show>
                        </div>
                      </div>

                      <Show when={shouldShowRunSummary(runSummary(), runFindings())}>
                        <div class="border-t border-border-weak-base pt-4">
                          <div class="text-12-medium text-text-weak mb-2">Summary</div>
                          <Markdown text={runSummary()} class="text-14-regular text-text-base" />
                        </div>
                      </Show>

                      <div class="border-t border-border-weak-base pt-4">
                        <div class="flex items-center justify-between gap-3 mb-3">
                          <div class="text-12-medium text-text-weak">Findings</div>
                          <div class="flex items-center gap-2">
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              onClick={() => markRunRead(run(), !run().time.read)}
                            >
                              {run().time.read ? "Mark as Unread" : "Mark Read"}
                            </Button>
                            <Button type="button" size="small" variant="ghost" onClick={() => archiveRun(run())}>
                              Archive
                            </Button>
                            <Show when={automation()}>
                              {(item) => (
                                <Button type="button" size="small" variant="ghost" onClick={() => runNow(item())}>
                                  Re-run
                                </Button>
                              )}
                            </Show>
                          </div>
                        </div>
                        <Show
                          when={runFindings().length > 0}
                          fallback={<div class="text-14-regular text-text-base">No findings recorded.</div>}
                        >
                          <div class="flex flex-col border border-border-weak-base rounded-md overflow-hidden">
                            <For each={runFindings()}>
                              {(finding) => (
                                <div class="border-t first:border-t-0 border-border-weaker-base p-3">
                                  <div class="flex items-start justify-between gap-3">
                                    <div class="text-14-medium text-text-strong">{finding.title}</div>
                                    <div class="text-12-medium text-text-weak">{label(finding.severity)}</div>
                                  </div>
                                  <Markdown
                                    text={cleanAutomationText(finding.details)}
                                    class="mt-1 text-13-regular text-text-base"
                                  />
                                  <Show when={finding.recommendedNextAction}>
                                    {(action) => (
                                      <div class="mt-3">
                                        <div class="text-12-medium text-text-weak mb-1">Recommended Next Action</div>
                                        <Markdown
                                          text={cleanAutomationText(action())}
                                          class="text-13-regular text-text-base"
                                        />
                                      </div>
                                    )}
                                  </Show>
                                  <Show when={finding.filesChanged.length > 0}>
                                    <div class="mt-2 text-12-regular text-text-weak truncate">
                                      {finding.filesChanged.join(", ")}
                                    </div>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>

                      <Show when={files()}>
                        {(diffFiles) => (
                          <div class="border-t border-border-weak-base pt-4">
                            <div class="text-12-medium text-text-weak mb-3">Diff</div>
                            <Show
                              when={diffFiles().length > 0}
                              fallback={<div class="text-14-regular text-text-base">No file changes captured.</div>}
                            >
                              <div class="flex flex-col gap-3">
                                <For each={diffFiles()}>
                                  {(file) => (
                                    <div class="border border-border-weak-base rounded-md overflow-hidden">
                                      <div class="px-3 py-2 bg-surface-base flex items-center justify-between gap-3 text-12-regular">
                                        <span class="text-text-strong truncate">{file.file}</span>
                                        <span class="text-text-weak shrink-0">
                                          +{file.additions} -{file.deletions}
                                        </span>
                                      </div>
                                      <pre class="max-h-72 overflow-auto p-3 text-12-regular text-text-base whitespace-pre-wrap select-text">
                                        {file.patch}
                                      </pre>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </div>
                  )
                }}
              </Show>
            </div>
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
