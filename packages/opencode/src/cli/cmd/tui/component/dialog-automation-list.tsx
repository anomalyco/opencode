import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useToast } from "@tui/ui/toast"
import { Locale } from "@/util/locale"
import { Filesystem } from "@/util/filesystem"
import { AutomationTransfer } from "@opencode-ai/util/automation-transfer"
import { mkdir } from "fs/promises"
import path from "path"
import { getFilename } from "@opencode-ai/util/path"
import { slugify } from "@opencode-ai/util/slugify"
import { createMemo, onMount } from "solid-js"
import { reconcile } from "solid-js/store"
import type { Automation, Project } from "@opencode-ai/sdk/v2"
import { DialogAutomationHistory } from "@tui/component/dialog-automation-history"

const templateHint = "Template variables are available"

function projectLabel(project: Project) {
  return project.name || getFilename(project.worktree)
}

function scheduleLabel(automation: Automation) {
  if (!automation.schedule) return "Manual"

  const lines = automation.schedule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!automation.enabled) {
    const schedule = lines[0] ?? automation.schedule
    return `Disabled - ${schedule}`
  }
  if (lines.length > 1) return `Multiple - ${lines.length}`
  return lines[0] ?? automation.schedule
}

function formatRun(value?: number) {
  if (!value) return "Never"

  return Locale.todayTimeOrDateTime(value)
}

export function DialogAutomationList() {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const toast = useToast()
  const keys = keybind.all

  const refreshAutomations = async () => {
    const list = await sdk.client.automation.list()
    const items = (list.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))
    sync.set("automation", reconcile(items))
  }

  const projectRoot = () => {
    if (sync.data.path.worktree && sync.data.path.worktree !== "/") return sync.data.path.worktree
    if (sync.data.path.directory) return sync.data.path.directory

    return process.cwd()
  }
  const projectAutomationDir = () => path.join(projectRoot(), ".opencode", "automations")
  const canOpenSession = (directory: string) => {
    if (!directory) return false
    if (sync.data.path.worktree && sync.data.path.worktree !== "/" && directory === sync.data.path.worktree) return true
    if (directory === sync.data.path.directory) return true
    return false
  }

  const writeProjectExport = async (items: Automation[], filename: string) => {
    if (items.length === 0) {
      toast.show({ message: "No automations to export", variant: "error" })
      return
    }

    const dir = projectAutomationDir()
    await mkdir(dir, { recursive: true })
    const output = JSON.stringify(AutomationTransfer.serialize(items), null, 2)
    const filepath = path.join(dir, filename)
    await Bun.write(filepath, output)
    toast.show({
      message: `Exported to ${path.join(".opencode", "automations", path.basename(filepath))}`,
      variant: "success",
    })
  }

  const exportSelected = async (automation: Automation) => {
    const suffix = slugify(automation.name) || automation.id.slice(-8)
    const filename = `automation-${suffix}.json`
    await writeProjectExport([automation], filename)
  }

  const exportAll = async () => {
    await writeProjectExport(sync.data.automation, "automations.json")
  }

  const importAutomations = async () => {
    const dir = projectAutomationDir()
    const exists = await Filesystem.isDir(dir)
    if (!exists) {
      toast.show({ message: "No .opencode/automations directory", variant: "error" })
      return
    }

    const glob = new Bun.Glob("*.json")
    const files: string[] = []
    for await (const match of glob.scan({ cwd: dir, absolute: true })) {
      files.push(match)
    }
    if (files.length === 0) {
      toast.show({ message: "No automation exports found", variant: "error" })
      return
    }

    const items = (
      await Promise.all(
        files.map((file) =>
          Bun.file(file)
            .json()
            .then((data) => AutomationTransfer.parse(data))
            .catch(() => undefined),
        ),
      )
    ).flatMap((item) => item ?? [])

    if (items.length === 0) {
      toast.show({ message: "Import failed", variant: "error" })
      return
    }

    const results = await Promise.all(
      items.map((item) =>
        sdk.client.automation
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
      toast.show({ message: "Import failed", variant: "error" })
      return
    }
    toast.show({ message: `Imported ${success} automation${success === 1 ? "" : "s"}`, variant: "success" })
    await refreshAutomations()
  }

  const options = createMemo(() =>
    sync.data.automation
      .slice()
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((automation) => {
        const projectCount = automation.projects.length
        const projects = Locale.pluralize(projectCount, "{} project", "{} projects")
        const schedule = scheduleLabel(automation)
        const summary = `${projects} - ${schedule}`
        const footer = `Next: ${formatRun(automation.nextRun)} | Last: ${formatRun(automation.lastRun)}`
        return {
          title: automation.name || "Untitled",
          description: summary,
          footer,
          value: automation,
        }
      }),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  const promptName = (value?: string) =>
    DialogPrompt.show(dialog, "Automation name", {
      placeholder: "Daily summary",
      value,
    })

  const promptPrompt = (value?: string) =>
    DialogPrompt.show(dialog, "Prompt", {
      placeholder: "Summarize today's progress",
      value,
      description: () => <text fg={theme.textMuted}>Templates: {templateHint}</text>,
    })

  const promptProjects = async (value?: string) => {
    const list = await sdk.client.project.list()
    const projects = (list.data ?? []).filter((item) => item.worktree && item.worktree !== "/")
    const available = projects.map((item) => projectLabel(item)).join(", ")
    const input = await DialogPrompt.show(dialog, "Projects", {
      placeholder: "project-a, project-b",
      value,
      description: () => (
        <text fg={theme.textMuted}>Comma-separated names or paths. Available: {available || "none"}</text>
      ),
    })
    if (input === null) return null
    return { input, projects }
  }

  const promptSchedule = (value?: string) =>
    DialogPrompt.show(dialog, "Cron schedule", {
      placeholder: "0 9 * * 1-5 (empty for manual)",
      value,
    })

  const promptEnabled = (value?: string) =>
    DialogPrompt.show(dialog, "Enable schedule? (y/n)", {
      placeholder: "y",
      value,
    })

  const resolveProjects = (input: string, projects: Project[]) => {
    const entries = input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    if (entries.length === 0) return []
    if (entries.length === 1 && entries[0] === "*") {
      return projects.map((item) => item.worktree)
    }
    return entries.map((entry) => {
      const match = projects.find((item) => {
        if (item.worktree === entry) return true
        if (item.name === entry) return true
        if (getFilename(item.worktree) === entry) return true
        return false
      })
      return match?.worktree ?? entry
    })
  }

  const returnToList = () => {
    dialog.replace(() => <DialogAutomationList />)
  }

  const createAutomation = async () => {
    const name = await promptName()
    if (name === null) return returnToList()
    if (!name.trim()) return returnToList()

    const prompt = await promptPrompt()
    if (prompt === null) return returnToList()
    if (!prompt.trim()) return returnToList()

    const projectsData = await promptProjects()
    if (!projectsData) return returnToList()
    const projectValues = resolveProjects(projectsData.input, projectsData.projects)
    if (projectValues.length === 0) return returnToList()

    const scheduleInput = await promptSchedule()
    if (scheduleInput === null) return returnToList()
    const schedule = scheduleInput.trim()
    const savedSchedule = schedule ? schedule : null

    let enabled = false
    if (schedule) {
      const enabledInput = await promptEnabled("y")
      if (enabledInput === null) return returnToList()
      const normalized = enabledInput.trim().toLowerCase()
      enabled = normalized.length === 0 || normalized.startsWith("y")
    }

    await sdk.client.automation.create({
      name: name.trim(),
      prompt: prompt.trim(),
      projects: projectValues,
      schedule: savedSchedule,
      enabled,
    })
    await refreshAutomations()
    dialog.replace(() => <DialogAutomationList />)
  }

  const editAutomation = async (automation: Automation) => {
    const name = await promptName(automation.name)
    if (name === null) return returnToList()
    const prompt = await promptPrompt(automation.prompt)
    if (prompt === null) return returnToList()

    const projectsDefault = automation.projects.join(", ")
    const projectsData = await promptProjects(projectsDefault)
    if (!projectsData) return returnToList()
    const projectsInput = projectsData.input.trim()
    const projectValues = projectsInput ? resolveProjects(projectsInput, projectsData.projects) : automation.projects

    const scheduleInput = await promptSchedule(automation.schedule ?? "")
    if (scheduleInput === null) return returnToList()
    const schedule = scheduleInput.trim()
    const savedSchedule = schedule ? schedule : null

    let enabled = false
    if (schedule) {
      const enabledInput = await promptEnabled(automation.enabled ? "y" : "n")
      if (enabledInput === null) return returnToList()
      enabled = enabledInput.trim().toLowerCase().startsWith("y")
    }

    await sdk.client.automation.update({
      automationID: automation.id,
      name: name.trim() || automation.name,
      prompt: prompt.trim() || automation.prompt,
      projects: projectValues.length ? projectValues : automation.projects,
      schedule: savedSchedule,
      enabled,
    })
    await refreshAutomations()
    dialog.replace(() => <DialogAutomationList />)
  }

  const confirmDelete = async () => {
    const input = await DialogPrompt.show(dialog, "Delete automation", {
      placeholder: "type DELETE",
      description: () => <text fg={theme.textMuted}>This permanently removes the automation.</text>,
    })
    dialog.replace(() => <DialogAutomationList />)
    return input
  }

  const clearHistory = async () => {
    const input = await DialogPrompt.show(dialog, "Clear run history", {
      placeholder: "type CLEAR",
      description: () => <text fg={theme.textMuted}>Clears run history for all automations.</text>,
    })
    dialog.replace(() => <DialogAutomationList />)
    if (input === null) return
    if (input.trim().toLowerCase() !== "clear") return
    await sdk.client.automation.clearHistory()
    await refreshAutomations()
  }

  return (
    <DialogSelect
      title="Automations"
      placeholder="Search automations..."
      options={options()}
      onSelect={(option) => {
        editAutomation(option.value)
      }}
      keybind={[
        {
          keybind: keys.automation_create?.[0],
          title: "create",
          requiresSelection: false,
          onTrigger: () => {
            createAutomation()
          },
        },
        {
          keybind: keys.automation_run?.[0],
          title: "run",
          onTrigger: async (option) => {
            if (!option) return
            await sdk.client.automation.run({ automationID: option.value.id })
            await refreshAutomations()
          },
        },
        {
          keybind: keys.automation_open?.[0],
          title: "open",
          onTrigger: (option) => {
            if (!option) return
            const session = option.value.lastSession
            if (!session) return
            if (!canOpenSession(session.directory)) {
              toast.show({ message: "Open this session from its project", variant: "error" })
              return
            }
            route.navigate({ type: "session", sessionID: session.id })
          },
        },
        {
          keybind: keys.automation_history?.[0],
          title: "history",
          onTrigger: (option) => {
            if (!option) return
            dialog.replace(
              () => <DialogAutomationHistory automation={option.value} />,
              () => {
                setTimeout(() => {
                  dialog.replace(() => <DialogAutomationList />)
                }, 0)
              },
            )
          },
        },
        {
          keybind: keys.automation_export?.[0],
          title: "export",
          onTrigger: (option) => {
            if (!option) return
            exportSelected(option.value)
          },
        },
        {
          keybind: keys.automation_export_all?.[0],
          title: "export all",
          requiresSelection: false,
          onTrigger: () => {
            exportAll()
          },
        },
        {
          keybind: keys.automation_import?.[0],
          title: "import",
          requiresSelection: false,
          onTrigger: () => {
            importAutomations()
          },
        },
        {
          keybind: keys.automation_clear_history?.[0],
          title: "clear history",
          requiresSelection: false,
          onTrigger: () => {
            clearHistory()
          },
        },
        {
          keybind: keys.automation_edit?.[0],
          title: "edit",
          onTrigger: (option) => {
            if (!option) return
            editAutomation(option.value)
          },
        },
        {
          keybind: keys.automation_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (!option) return
            const input = await confirmDelete()
            if (input === null) return
            if (input.trim() !== "DELETE") return
            await sdk.client.automation.remove({ automationID: option.value.id })
            await refreshAutomations()
          },
        },
      ]}
    />
  )
}
