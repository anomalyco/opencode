import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { Dialog } from "@opencode-ai/ui/dialog"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { DateTime } from "luxon"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { AutomationDayToggle } from "@/components/automation-day-toggle"
import { AutomationTimeRow } from "@/components/automation-time-row"
import { DialogAutomationDelete } from "@/components/dialog-automation-delete"
import { PromptEditor, promptText, type SlashCommand, type TemplateOption } from "@/components/prompt-editor"
import { DEFAULT_PROMPT, type Prompt } from "@/context/prompt"
import { getFilename } from "@opencode-ai/util/path"
import { createOpencodeClient, type Automation, type Project } from "@opencode-ai/sdk/v2/client"

const dayOrder = ["1", "2", "3", "4", "5", "6", "0"]
const defaultDays = ["1", "2", "3", "4", "5"]
const defaultTimes = ["09:00"]
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))

function sortDays(input: string[]) {
  return dayOrder.filter((day) => input.includes(day))
}

function parseDays(value: string) {
  if (value === "*") return dayOrder
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return
  if (parts.includes("*")) return dayOrder

  const values = parts.flatMap((part) => {
    if (/^[0-6]$/.test(part)) return [part]
    if (!/^[0-6]-[0-6]$/.test(part)) return []
    const start = Number(part[0])
    const end = Number(part[2])
    if (start > end) return []
    return Array.from({ length: end - start + 1 }, (_, i) => String(start + i))
  })

  if (values.length === 0) return
  if (values.some((item) => !/^[0-6]$/.test(item))) return

  return sortDays([...new Set(values)])
}

function parseTime(hour: string, minute: string) {
  if (!/^\d+$/.test(hour) || !/^\d+$/.test(minute)) return
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return
  if (h < 0 || h > 23) return
  if (m < 0 || m > 59) return
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function promptParts(value: string) {
  if (!value) return DEFAULT_PROMPT
  const parts: Prompt = []
  const regex = /@\S+/g
  let cursor = 0
  let position = 0

  const pushText = (content: string) => {
    if (!content) return
    parts.push({
      type: "text",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  for (const match of value.matchAll(regex)) {
    const mention = match[0]
    const start = match.index ?? cursor
    const previous = start > 0 ? value[start - 1] : ""
    if (start > 0 && !/\s/.test(previous)) continue
    pushText(value.slice(cursor, start))

    const path = mention.slice(1)
    if (!path) {
      pushText(mention)
      cursor = start + mention.length
      continue
    }

    parts.push({
      type: "file",
      path,
      content: mention,
      start: position,
      end: position + mention.length,
    })
    position += mention.length
    cursor = start + mention.length
  }

  pushText(value.slice(cursor))
  if (parts.length === 0) {
    return [{ type: "text", content: value, start: 0, end: value.length }] satisfies Prompt
  }
  return parts
}

function parseBuilderSchedule(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) return
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return
  const times: string[] = []
  let days: string[] | undefined
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length !== 5) return
    const minute = parts[0]
    const hour = parts[1]
    const day = parts[2]
    const month = parts[3]
    const week = parts[4]
    if (day !== "*" || month !== "*") return
    const parsedDays = parseDays(week)
    if (!parsedDays) return
    const time = parseTime(hour, minute)
    if (!time) return
    if (!days) {
      days = parsedDays
    }
    if (days.join(",") !== parsedDays.join(",")) {
      return
    }
    times.push(time)
  }
  return {
    days: days ?? dayOrder,
    times: [...new Set(times)].sort(),
  }
}

function buildSchedule(days: string[], times: string[]) {
  const normalizedDays = sortDays(days)
  const normalizedTimes = [...new Set(times)].filter(Boolean)
  if (normalizedDays.length === 0 || normalizedTimes.length === 0) return ""
  const dayList = normalizedDays.join(",")
  const lines = normalizedTimes
    .map((time) => {
      const parts = time.split(":")
      const hour = parts[0]
      const minute = parts[1]
      if (!hour || !minute) return undefined
      const h = String(Number(hour)).padStart(2, "0")
      const m = String(Number(minute)).padStart(2, "0")
      if (!parseTime(h, m)) return undefined
      return `${m} ${h} * * ${dayList}`
    })
    .filter((line): line is string => !!line)
  return lines.join("\n")
}

function projectLabel(project: Project) {
  return project.name || getFilename(project.worktree)
}

export function DialogAutomation(props: { automation?: Automation }) {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const command = useCommand()

  const initialSchedule = props.automation?.schedule ?? ""
  const initialPrompt = props.automation?.prompt ?? ""
  const parsed = parseBuilderSchedule(initialSchedule)

  const [store, setStore] = createStore({
    name: props.automation?.name ?? "",
    prompt: initialPrompt,
    parts: promptParts(initialPrompt),
    enabled: props.automation?.enabled ?? true,
    schedule: initialSchedule,
    mode: parsed ? ("picker" as const) : initialSchedule ? ("cron" as const) : ("picker" as const),
    days: parsed?.days ?? defaultDays,
    times: parsed?.times ?? defaultTimes,
    projects: props.automation?.projects ?? [],
    saving: false,
  })

  const [preview, setPreview] = createStore({
    loading: false,
    nextRun: undefined as number | undefined,
    error: "",
  })
  let previewTimeout: ReturnType<typeof setTimeout> | undefined
  let previewId = 0

  const title = () => (props.automation ? language.t("automations.edit.title") : language.t("automations.create.title"))
  const projects = createMemo(() =>
    globalSync.data.project
      .filter((project) => project.worktree && project.worktree !== "/")
      .slice()
      .sort((a, b) => projectLabel(a).localeCompare(projectLabel(b))),
  )
  const home = createMemo(() => globalSync.data.path.home)
  const dayOptions = createMemo(() => [
    { key: "1", label: language.t("automations.day.mon") },
    { key: "2", label: language.t("automations.day.tue") },
    { key: "3", label: language.t("automations.day.wed") },
    { key: "4", label: language.t("automations.day.thu") },
    { key: "5", label: language.t("automations.day.fri") },
    { key: "6", label: language.t("automations.day.sat") },
    { key: "0", label: language.t("automations.day.sun") },
  ])
  const presets = createMemo(() => [
    {
      id: "weekdays",
      label: language.t("automations.form.presets.weekdays"),
      days: defaultDays,
      times: defaultTimes,
    },
    {
      id: "daily",
      label: language.t("automations.form.presets.daily"),
      days: dayOrder,
      times: defaultTimes,
    },
  ])
  const directory = createMemo(() => store.projects[0] ?? "")
  const clients = new Map<string, ReturnType<typeof createOpencodeClient>>()
  const clientFor = (dir: string) => {
    const cached = clients.get(dir)
    if (cached) return cached
    const next = createOpencodeClient({
      baseUrl: globalSDK.url,
      fetch: platform.fetch,
      directory: dir,
      throwOnError: true,
    })
    clients.set(dir, next)
    return next
  }
  const [customCommands] = createResource(directory, (dir) => {
    if (!dir) return []
    return clientFor(dir)
      .command.list()
      .then((x) => x.data ?? [])
      .catch(() => [])
  })
  const [agents] = createResource(directory, (dir) => {
    if (!dir) return []
    return clientFor(dir)
      .app.agents()
      .then((x) => x.data ?? [])
      .catch(() => [])
  })
  const searchFiles = async (query: string) => {
    const dir = directory()
    if (!dir) return []
    return clientFor(dir)
      .find.files({ query, dirs: "true" })
      .then((x) => x.data ?? [])
      .catch(() => [])
  }
  const slashCommands = createMemo<SlashCommand[]>(() => {
    const builtin = command.options
      .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash!,
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))
    const custom = (customCommands() ?? []).map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
      source: cmd.source,
    }))
    return [...custom, ...builtin]
  })
  const templates = createMemo<TemplateOption[]>(() => [
    {
      value: "{{date}}",
      label: language.t("automations.template.date.label"),
      description: language.t("automations.template.date.description"),
    },
    {
      value: "{{project.name}}",
      label: language.t("automations.template.project.label"),
      description: language.t("automations.template.project.description"),
    },
    {
      value: "{{session.latest}}",
      label: language.t("automations.template.sessionLatest.label"),
      description: language.t("automations.template.sessionLatest.description"),
    },
    {
      value: "{{session.query:term}}",
      label: language.t("automations.template.sessionQuery.label"),
      description: language.t("automations.template.sessionQuery.description"),
    },
  ])
  const scheduleValue = createMemo(() => {
    if (store.mode === "cron") return store.schedule.trim()
    return buildSchedule(store.days, store.times)
  })
  const scheduleError = createMemo(() => {
    if (!store.enabled) return ""
    if (!scheduleValue()) return language.t("automations.form.schedule.invalid")
    if (preview.loading) return ""
    if (preview.error) {
      return language.t("automations.form.schedule.invalidCron", { error: preview.error })
    }
    return ""
  })
  const schedulePreview = createMemo(() => {
    if (!store.enabled) return ""
    if (!scheduleValue()) return ""
    if (preview.loading) return language.t("automations.form.schedule.calculating")
    if (preview.error) return ""
    const next = preview.nextRun
    const label = next
      ? DateTime.fromMillis(next).toLocaleString(DateTime.DATETIME_SHORT)
      : language.t("automations.time.never")
    return `${language.t("automations.form.schedule.nextRun")}: ${label}`
  })
  const handlePromptChange = (value: Prompt) => {
    setStore({ parts: value, prompt: promptText(value) })
  }
  const scheduleReady = createMemo(() => {
    if (!store.enabled) return true
    if (!scheduleValue()) return false
    if (preview.loading) return false
    if (preview.error) return false
    return true
  })
  const canSave = createMemo(() => {
    if (!store.name.trim()) return false
    if (!store.prompt.trim()) return false
    if (store.projects.length === 0) return false
    if (!scheduleReady()) return false
    return true
  })

  createEffect(
    on([() => store.enabled, scheduleValue], ([enabled, schedule]) => {
      previewId += 1
      const current = previewId
      if (previewTimeout) clearTimeout(previewTimeout)
      if (!enabled || !schedule) {
        setPreview({ loading: false, nextRun: undefined, error: "" })
        return
      }
      setPreview({ loading: true, nextRun: undefined, error: "" })
      previewTimeout = setTimeout(() => {
        globalSDK.client.automation
          .preview({ schedule })
          .then((result) => {
            if (current !== previewId) return
            const data = result.data
            setPreview({
              loading: false,
              nextRun: data?.nextRun,
              error: data?.error ?? "",
            })
          })
          .catch((error) => {
            if (current !== previewId) return
            const message = error instanceof Error ? error.message : String(error)
            setPreview({ loading: false, nextRun: undefined, error: message })
          })
      }, 200)
    }),
  )

  onCleanup(() => {
    if (previewTimeout) clearTimeout(previewTimeout)
    previewId += 1
  })

  function updateSchedule(value: string) {
    setStore("schedule", value)
  }

  function toggleDay(day: string, checked: boolean) {
    if (checked) {
      setStore("days", (prev) => sortDays([...prev, day]))
      return
    }
    setStore("days", (prev) => prev.filter((item) => item !== day))
  }

  function updateTime(index: number, value: string) {
    setStore("times", (prev) => prev.map((item, i) => (i === index ? value : item)))
  }

  function addTime() {
    setStore("times", (prev) => [...prev, "09:00"])
  }

  function applyPreset(preset: { days: string[]; times: string[] }) {
    setStore({ mode: "picker", days: [...preset.days], times: [...preset.times] })
  }

  function removeTime(index: number) {
    setStore("times", (prev) => prev.filter((_, i) => i !== index))
  }

  function toggleProject(directory: string, checked: boolean) {
    if (checked) {
      setStore("projects", (prev) => (prev.includes(directory) ? prev : [...prev, directory]))
      return
    }
    setStore("projects", (prev) => prev.filter((item) => item !== directory))
  }

  async function handleSave() {
    if (!canSave()) return
    setStore("saving", true)
    const schedule = scheduleValue()
    const savedSchedule = schedule ? schedule : null
    const payload = {
      name: store.name.trim(),
      projects: store.projects,
      prompt: store.prompt,
      schedule: savedSchedule,
      enabled: store.enabled,
    }
    const request = props.automation
      ? globalSDK.client.automation.update({ automationID: props.automation.id, ...payload })
      : globalSDK.client.automation.create(payload)
    await request.then(() => dialog.close()).finally(() => setStore("saving", false))
  }

  const deleteAutomation = async (automation: Automation) => {
    await globalSDK.client.automation.remove({ automationID: automation.id })
  }

  const openDelete = () => {
    const automation = props.automation
    if (!automation) return
    dialog.show(() => <DialogAutomationDelete automation={automation} onDelete={deleteAutomation} />)
  }

  return (
    <Dialog title={title()} size="x-large" class="w-full max-w-[720px] mx-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
        class="flex flex-col h-full min-h-0"
      >
        <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          <div class="flex flex-col gap-6 px-6 pb-6 pt-0">
            <div class="flex flex-col gap-4">
              <TextField
                autofocus
                label={language.t("automations.form.name")}
                placeholder={language.t("automations.form.name.placeholder")}
                value={store.name}
                onChange={(value) => setStore("name", value)}
              />

              <div class="bg-surface-raised-base px-4 rounded-lg">
                <div class="py-4">
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-14-medium text-text-strong">{language.t("automations.form.projects")}</span>
                      <span class="text-12-regular text-text-weak">
                        {language.t("automations.form.projects.count", { count: store.projects.length })}
                      </span>
                    </div>
                  </div>
                  <div class="mt-3 rounded-md border border-border-weak-base max-h-[160px] overflow-y-auto">
                    <Show
                      when={projects().length > 0}
                      fallback={
                        <div class="text-12-regular text-text-weak p-3">
                          {language.t("automations.form.projects.empty")}
                        </div>
                      }
                    >
                      <For each={projects()}>
                        {(project) => (
                          <div class="px-3 py-2 border-b border-border-weak-base last:border-none">
                            <Checkbox
                              checked={store.projects.includes(project.worktree)}
                              onChange={(checked) => toggleProject(project.worktree, checked)}
                              description={project.worktree.replace(home(), "~")}
                            >
                              {projectLabel(project)}
                            </Checkbox>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <div class="flex flex-col gap-0.5">
                  <span class="text-14-medium text-text-strong">{language.t("automations.form.prompt")}</span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("automations.form.prompt.description")}
                  </span>
                </div>
                <PromptEditor
                  value={store.parts}
                  placeholder={language.t("automations.form.prompt.placeholder")}
                  class="relative bg-surface-raised-base rounded-lg border border-border-weak-base"
                  editorClass="min-h-[140px]"
                  onChange={handlePromptChange}
                  slash={{
                    commands: slashCommands(),
                    keybind: command.keybind,
                  }}
                  at={{
                    agents: agents() ?? [],
                    recent: [],
                    search: searchFiles,
                  }}
                  templates={{
                    items: templates(),
                  }}
                />
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg">
                <div class="py-4 border-b border-border-weak-base flex items-start justify-between gap-4">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-14-medium text-text-strong">{language.t("automations.form.schedule")}</span>
                    <span class="text-12-regular text-text-weak">{language.t("automations.form.schedule.hint")}</span>
                  </div>
                  <Switch checked={store.enabled} onChange={(value) => setStore("enabled", value)} hideLabel>
                    {language.t("automations.form.schedule.enabled")}
                  </Switch>
                </div>

                <Show when={store.enabled}>
                  <div class="py-4 flex flex-col gap-4">
                    <div class="flex flex-col gap-2">
                      <span class="text-12-medium text-text-weak">{language.t("automations.form.presets")}</span>
                      <div class="flex flex-wrap gap-2">
                        <For each={presets()}>
                          {(preset) => (
                            <Button type="button" size="small" variant="ghost" onClick={() => applyPreset(preset)}>
                              {preset.label}
                            </Button>
                          )}
                        </For>
                      </div>
                    </div>
                    <RadioGroup
                      size="small"
                      options={["picker", "cron"] as const}
                      current={store.mode}
                      label={(value) =>
                        value === "picker"
                          ? language.t("automations.form.schedule.mode.picker")
                          : language.t("automations.form.schedule.mode.cron")
                      }
                      onSelect={(value) => {
                        if (!value) return
                        if (value === "cron") {
                          setStore({ mode: value, schedule: scheduleValue() })
                          return
                        }
                        const parsedSchedule = parseBuilderSchedule(store.schedule)
                        const cron = store.schedule.trim()
                        if (cron && !parsedSchedule) return
                        setStore("mode", value)
                        if (parsedSchedule) {
                          setStore({ days: parsedSchedule.days, times: parsedSchedule.times })
                        }
                      }}
                    />

                    <Show when={store.mode === "picker"}>
                      <div class="flex flex-col gap-3">
                        <label class="text-12-medium text-text-weak">{language.t("automations.form.days")}</label>
                        <div class="flex flex-wrap items-center gap-2 w-full">
                          <For each={dayOptions()}>
                            {(day) => (
                              <AutomationDayToggle
                                label={day.label}
                                active={store.days.includes(day.key)}
                                onChange={(value: boolean) => toggleDay(day.key, value)}
                              />
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                          <label class="text-12-medium text-text-weak">{language.t("automations.form.times")}</label>
                          <Button type="button" size="small" variant="ghost" icon="plus" onClick={addTime}>
                            {language.t("automations.form.times.add")}
                          </Button>
                        </div>
                        <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-2">
                          <Show
                            when={store.times.length > 0}
                            fallback={
                              <div class="text-12-regular text-text-weak px-2 py-1">
                                {language.t("automations.form.times.empty")}
                              </div>
                            }
                          >
                            <div class="flex flex-col gap-1.5">
                              <For each={store.times}>
                                {(time, index) => (
                                  <AutomationTimeRow
                                    index={index()}
                                    value={time}
                                    hours={hours}
                                    minutes={minutes}
                                    removeLabel={language.t("automations.form.times.remove")}
                                    onChange={(value: string) => updateTime(index(), value)}
                                    onRemove={() => removeTime(index())}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </div>

                      <TextField
                        label={language.t("automations.form.cron.preview")}
                        value={scheduleValue()}
                        multiline
                        class="min-h-[56px] font-mono text-11-regular"
                        readOnly
                        copyable
                      />
                    </Show>

                    <Show when={store.mode === "cron"}>
                      <TextField
                        label={language.t("automations.form.cron.expression")}
                        placeholder="0 9 * * 1-5"
                        value={store.schedule}
                        onChange={updateSchedule}
                        multiline
                        class="min-h-[72px] font-mono"
                      />
                    </Show>

                    <Show when={!!schedulePreview()}>
                      <div class="text-12-regular text-text-subtle">{schedulePreview()}</div>
                    </Show>
                    <Show when={!!scheduleError()}>
                      <div class="text-12-regular text-text-error">{scheduleError()}</div>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>

        <div class="shrink-0 px-6 py-4 border-t border-border-weak-base bg-surface-raised-stronger-non-alpha">
          <div class="flex justify-between gap-2">
            <Show when={props.automation} fallback={<div />}>
              <Button
                type="button"
                variant="ghost"
                size="large"
                icon="trash"
                onClick={openDelete}
                disabled={store.saving}
              >
                {language.t("common.delete")}
              </Button>
            </Show>
            <div class="flex gap-2">
              <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()} disabled={store.saving}>
                {language.t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" size="large" disabled={!canSave() || store.saving}>
                {store.saving ? language.t("common.saving") : language.t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
