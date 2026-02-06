import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DateTime } from "luxon"
import { createMemo, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { DialogAutomation } from "@/components/dialog-automation"
import { DialogAutomationDelete } from "@/components/dialog-automation-delete"
import { DialogConfirm } from "@/components/dialog-confirm"
import { AutomationTransfer } from "@opencode-ai/util/automation-transfer"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { slugify } from "@opencode-ai/util/slugify"
import { useNavigate } from "@solidjs/router"
import type { Automation, AutomationRun } from "@opencode-ai/sdk/v2/client"

export default function AutomationsPage() {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const navigate = useNavigate()
  let importRef!: HTMLInputElement

  const automations = createMemo(() =>
    (globalSync.data.automation ?? [])
      .filter((item): item is Automation => !!item && typeof item === "object")
      .slice()
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
  )

  const formatTime = (value?: number) => {
    if (!value) return language.t("automations.time.never")
    return DateTime.fromMillis(value).toRelative() ?? DateTime.fromMillis(value).toLocaleString(DateTime.DATETIME_SHORT)
  }

  const projectLabel = (directory: string) => {
    const project = globalSync.data.project.find((item) => item.worktree === directory)
    if (project?.name) return project.name
    return getFilename(directory)
  }

  const openSession = (session?: { id: string; directory: string }) => {
    if (!session) return
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  const projectList = (automation: Automation) =>
    (automation.projects ?? [])
      .filter((directory) => directory && directory !== "/")
      .map((directory) => projectLabel(directory))
      .join(", ")

  const scheduleLabel = (automation: Automation) => {
    if (!automation.schedule) return language.t("automations.schedule.manual")
    const lines = automation.schedule
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (!automation.enabled) {
      const schedule = lines[0] ?? automation.schedule
      return language.t("automations.schedule.disabled", { schedule })
    }
    if (lines.length > 1) return language.t("automations.schedule.multi", { count: lines.length })
    return lines[0] ?? automation.schedule
  }

  const openCreate = () => dialog.show(() => <DialogAutomation />)
  const openEdit = (automation: Automation) => dialog.show(() => <DialogAutomation automation={automation} />)

  const runAutomation = async (automation: Automation) => {
    const result = await globalSDK.client.automation.run({ automationID: automation.id }).catch(() => undefined)
    if (!result?.data) {
      showToast({ title: language.t("common.requestFailed") })
      return
    }
    const index = (globalSync.data.automation ?? []).findIndex((item) => item.id === result.data?.id)
    if (index >= 0) globalSync.set("automation", index, result.data)
    showToast({ title: language.t("automations.run.started") })
  }

  const deleteAutomation = async (automation: Automation) => {
    await globalSDK.client.automation.remove({ automationID: automation.id })
  }

  const clearHistory = async () => {
    await globalSDK.client.automation.clearHistory()
  }

  const downloadExport = (items: Automation[], filename: string) => {
    if (items.length === 0) {
      showToast({ title: language.t("automations.export.empty") })
      return
    }
    const payload = AutomationTransfer.serialize(
      items.map((item) => ({
        name: item.name,
        projects: item.projects,
        prompt: item.prompt,
        schedule: item.schedule ?? null,
        enabled: item.enabled,
      })),
    )
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const exportAll = () => {
    downloadExport(automations(), "automations.json")
  }

  const exportAutomation = (automation: Automation) => {
    const name = slugify(String(automation.name ?? ""))
    const suffix = name || automation.id.slice(-8)
    downloadExport([automation], `automation-${suffix}.json`)
  }

  const handleImport = async (event: Event & { currentTarget: HTMLInputElement }) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    const data = await file
      .text()
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (!data) {
      showToast({ title: language.t("automations.import.failed") })
      return
    }

    const items = AutomationTransfer.parse(data)
    if (items.length === 0) {
      showToast({ title: language.t("automations.import.failed") })
      return
    }

    const results = await Promise.all(
      items.map((item) =>
        globalSDK.client.automation
          .create({
            name: item.name,
            prompt: item.prompt,
            projects: item.projects,
            schedule: item.schedule ?? null,
            enabled: item.enabled,
          })
          .then(() => true)
          .catch(() => false),
      ),
    )

    const success = results.filter(Boolean).length
    if (success === 0) {
      showToast({ title: language.t("automations.import.failed") })
      return
    }
    const list = await globalSDK.client.automation.list().catch(() => undefined)
    if (list?.data) {
      globalSync.set(
        "automation",
        list.data.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))),
      )
    }
    showToast({ title: language.t("automations.import.success", { count: success }) })
  }

  const openClearHistory = () =>
    dialog.show(() => (
      <DialogConfirm
        title={language.t("automations.history.clear.title")}
        message={language.t("automations.history.clear.confirm")}
        confirmLabel={language.t("automations.history.clear.button")}
        cancelLabel={language.t("common.cancel")}
        onConfirm={clearHistory}
      />
    ))

  function DialogAutomationHistory(props: { automation: Automation }) {
    const [state, setState] = createStore({
      loading: true,
      error: "",
      runs: [] as AutomationRun[],
    })
    const runs = createMemo(() => (Array.isArray(state.runs) ? state.runs : []))

    onMount(() => {
      globalSDK.client.automation
        .history({ automationID: props.automation.id, limit: 25 })
        .then((result) => {
          const data = Array.isArray(result.data) ? result.data : []
          setState({ loading: false, error: "", runs: data })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          setState({ loading: false, error: message, runs: [] })
        })
    })

    const formatStatus = (run: AutomationRun) =>
      run.status === "success"
        ? language.t("automations.history.status.success")
        : language.t("automations.history.status.failed")

    const formatRunTime = (value?: number) => {
      if (!value || !Number.isFinite(value)) return language.t("automations.time.unknown")
      return DateTime.fromMillis(value).toLocaleString(DateTime.DATETIME_SHORT)
    }

    return (
      <Dialog title={language.t("automations.history.title")} size="large">
        <div class="flex flex-col gap-4 px-6 pb-6">
          <Show when={!state.loading}>
            <Show when={!state.error} fallback={<div class="text-12-regular text-text-error">{state.error}</div>}>
              <Show
                when={runs().length > 0}
                fallback={<div class="text-12-regular text-text-weak">{language.t("automations.history.empty")}</div>}
              >
                <div class="bg-surface-raised-base rounded-lg overflow-x-auto w-full">
                  <table class="w-full min-w-[680px] table-fixed text-left">
                    <colgroup>
                      <col class="w-[28%]" />
                      <col class="w-[24%]" />
                      <col class="w-[14%]" />
                      <col class="w-[34%]" />
                      <col class="w-[48px]" />
                    </colgroup>
                    <thead class="text-12-medium text-text-weak">
                      <tr>
                        <th class="px-4 py-2 font-medium">{language.t("automations.history.table.time")}</th>
                        <th class="px-4 py-2 font-medium">{language.t("automations.history.table.project")}</th>
                        <th class="px-4 py-2 font-medium">{language.t("automations.history.table.status")}</th>
                        <th class="px-4 py-2 font-medium">{language.t("automations.history.table.session")}</th>
                        <th class="px-4 py-2" aria-hidden="true" />
                      </tr>
                    </thead>
                    <tbody>
                      <For each={runs()}>
                        {(run) => (
                          <tr class="border-t border-border-weak-base">
                            <td class="px-4 py-3 text-12-regular text-text-weak">{formatRunTime(run.time)}</td>
                            <td class="px-4 py-3 text-12-regular text-text-weak">
                              <div class="truncate">{projectLabel(run.directory)}</div>
                            </td>
                            <td class="px-4 py-3 text-12-regular text-text-weak">{formatStatus(run)}</td>
                            <td class="px-4 py-3 text-12-regular text-text-weak">
                              <div class="truncate max-w-full">{run.sessionID ?? "-"}</div>
                            </td>
                            <td class="px-4 py-3">
                              <div class="flex items-center justify-end">
                                <Show when={run.sessionID}>
                                  <Tooltip value={language.t("automations.action.openSession")}>
                                    <IconButton
                                      icon="square-arrow-top-right"
                                      variant="ghost"
                                      onClick={() =>
                                        openSession(
                                          run.sessionID ? { id: run.sessionID, directory: run.directory } : undefined,
                                        )
                                      }
                                    />
                                  </Tooltip>
                                </Show>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </Dialog>
    )
  }

  const openDelete = (automation: Automation) =>
    dialog.show(() => <DialogAutomationDelete automation={automation} onDelete={deleteAutomation} />)
  const openHistory = (automation: Automation) => dialog.show(() => <DialogAutomationHistory automation={automation} />)

  return (
    <div class="flex flex-col w-full h-full overflow-y-auto bg-background-stronger px-4 pb-10 sm:px-6 sm:pb-10">
      <div class="flex flex-col gap-3 pt-6 pb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-16-medium text-text-strong">{language.t("automations.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("automations.description")}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 sm:justify-end">
          <input
            ref={(el) => (importRef = el)}
            type="file"
            accept="application/json"
            class="hidden"
            onChange={handleImport}
          />
          <Button variant="ghost" icon="cloud-upload" onClick={() => importRef?.click()}>
            {language.t("automations.import.action")}
          </Button>
          <Button variant="ghost" icon="download" onClick={exportAll}>
            {language.t("automations.export.all")}
          </Button>
          <Button variant="ghost" onClick={openClearHistory}>
            {language.t("automations.history.clear.action")}
          </Button>
          <Button icon="plus" class="pl-2 pr-3" onClick={openCreate}>
            {language.t("automations.create.button")}
          </Button>
        </div>
      </div>

      <Show
        when={(automations() ?? []).length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <Icon name="task" size="large" class="text-icon-weak-base" />
            <div class="text-14-medium text-text-strong mt-4">{language.t("automations.empty.title")}</div>
            <div class="text-12-regular text-text-weak mt-1">{language.t("automations.empty.description")}</div>
            <Button class="mt-5" onClick={openCreate}>
              {language.t("automations.create.button")}
            </Button>
          </div>
        }
      >
        <div class="bg-surface-raised-base rounded-lg overflow-x-auto w-full">
          <table class="w-full min-w-[960px] table-fixed text-left">
            <colgroup>
              <col class="w-[38%]" />
              <col class="w-[25%]" />
              <col class="w-[15%]" />
              <col class="w-[15%]" />
              <col class="w-[220px]" />
            </colgroup>
            <thead class="text-12-medium text-text-weak">
              <tr>
                <th class="px-4 py-2 font-medium">{language.t("automations.table.name")}</th>
                <th class="px-4 py-2 font-medium">{language.t("automations.table.schedule")}</th>
                <th class="px-4 py-2 font-medium">{language.t("automations.table.next")}</th>
                <th class="px-4 py-2 font-medium">{language.t("automations.table.last")}</th>
                <th class="px-4 py-2" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              <For each={automations()}>
                {(automation) => (
                  <tr class="border-t border-border-weak-base">
                    <td class="px-4 py-3">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="text-14-medium text-text-strong truncate">{automation.name}</span>
                          <Show when={!automation.enabled}>
                            <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                              {language.t("automations.badge.disabled")}
                            </span>
                          </Show>
                        </div>
                        <div class="text-12-regular text-text-weak truncate">{projectList(automation)}</div>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-12-regular text-text-weak">
                      <div class="truncate">{scheduleLabel(automation)}</div>
                    </td>
                    <td class="px-4 py-3 text-12-regular text-text-weak">{formatTime(automation.nextRun)}</td>
                    <td class="px-4 py-3 text-12-regular text-text-weak">{formatTime(automation.lastRun)}</td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2">
                        <Show when={automation.lastSession}>
                          <Tooltip value={language.t("automations.action.openSession")}>
                            <IconButton
                              icon="square-arrow-top-right"
                              variant="ghost"
                              onClick={() => openSession(automation.lastSession)}
                            />
                          </Tooltip>
                        </Show>
                        <Tooltip value={language.t("automations.action.history")}>
                          <IconButton icon="bullet-list" variant="ghost" onClick={() => openHistory(automation)} />
                        </Tooltip>
                        <Tooltip value={language.t("automations.action.edit")}>
                          <IconButton icon="pencil-line" variant="ghost" onClick={() => openEdit(automation)} />
                        </Tooltip>
                        <Tooltip value={language.t("automations.action.export")}>
                          <IconButton icon="download" variant="ghost" onClick={() => exportAutomation(automation)} />
                        </Tooltip>
                        <Tooltip value={language.t("automations.action.delete")}>
                          <IconButton icon="trash" variant="ghost" onClick={() => openDelete(automation)} />
                        </Tooltip>
                        <Tooltip value={language.t("automations.action.run")}>
                          <IconButton
                            icon="play"
                            iconSize="normal"
                            variant="ghost"
                            onClick={() => runAutomation(automation)}
                          />
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  )
}
