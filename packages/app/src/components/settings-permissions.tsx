import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, createMemo, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

type PermissionAction = "allow" | "ask" | "deny"

type PermissionObject = Record<string, PermissionAction>
type PermissionValue = PermissionAction | PermissionObject | string[] | undefined
type PermissionMap = Record<string, PermissionValue>

type PermissionItem = {
  id: string
  title: string
  description: string
}

const ACTIONS = [
  { value: "allow", label: "settings.permissions.action.allow" },
  { value: "ask", label: "settings.permissions.action.ask" },
  { value: "deny", label: "settings.permissions.action.deny" },
] as const

const ITEMS = [
  {
    id: "read",
    title: "settings.permissions.tool.read.title",
    description: "settings.permissions.tool.read.description",
  },
  {
    id: "edit",
    title: "settings.permissions.tool.edit.title",
    description: "settings.permissions.tool.edit.description",
  },
  {
    id: "glob",
    title: "settings.permissions.tool.glob.title",
    description: "settings.permissions.tool.glob.description",
  },
  {
    id: "grep",
    title: "settings.permissions.tool.grep.title",
    description: "settings.permissions.tool.grep.description",
  },
  {
    id: "list",
    title: "settings.permissions.tool.list.title",
    description: "settings.permissions.tool.list.description",
  },
  {
    id: "bash",
    title: "settings.permissions.tool.bash.title",
    description: "settings.permissions.tool.bash.description",
  },
  {
    id: "task",
    title: "settings.permissions.tool.task.title",
    description: "settings.permissions.tool.task.description",
  },
  {
    id: "skill",
    title: "settings.permissions.tool.skill.title",
    description: "settings.permissions.tool.skill.description",
  },
  {
    id: "lsp",
    title: "settings.permissions.tool.lsp.title",
    description: "settings.permissions.tool.lsp.description",
  },
  {
    id: "todoread",
    title: "settings.permissions.tool.todoread.title",
    description: "settings.permissions.tool.todoread.description",
  },
  {
    id: "todowrite",
    title: "settings.permissions.tool.todowrite.title",
    description: "settings.permissions.tool.todowrite.description",
  },
  {
    id: "webfetch",
    title: "settings.permissions.tool.webfetch.title",
    description: "settings.permissions.tool.webfetch.description",
  },
  {
    id: "websearch",
    title: "settings.permissions.tool.websearch.title",
    description: "settings.permissions.tool.websearch.description",
  },
  {
    id: "codesearch",
    title: "settings.permissions.tool.codesearch.title",
    description: "settings.permissions.tool.codesearch.description",
  },
  {
    id: "external_directory",
    title: "settings.permissions.tool.external_directory.title",
    description: "settings.permissions.tool.external_directory.description",
  },
  {
    id: "doom_loop",
    title: "settings.permissions.tool.doom_loop.title",
    description: "settings.permissions.tool.doom_loop.description",
  },
] as const

const VALID_ACTIONS = new Set<PermissionAction>(["allow", "ask", "deny"])

function toMap(value: unknown): PermissionMap {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as PermissionMap

  const action = getAction(value)
  if (action) return { "*": action }

  return {}
}

function getAction(value: unknown): PermissionAction | undefined {
  if (typeof value === "string" && VALID_ACTIONS.has(value as PermissionAction)) return value as PermissionAction
  return
}

function getRuleDefault(value: unknown): PermissionAction | undefined {
  const action = getAction(value)
  if (action) return action

  if (!value || typeof value !== "object" || Array.isArray(value)) return

  return getAction((value as Record<string, unknown>)["*"])
}

export const SettingsPermissions: Component = () => {
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const actions = createMemo(
    (): Array<{ value: PermissionAction; label: string }> =>
      ACTIONS.map((action) => ({
        value: action.value,
        label: language.t(action.label),
      })),
  )

  const permission = createMemo(() => {
    return toMap(globalSync.data.config.permission)
  })

  const actionFor = (id: string): PermissionAction => {
    const value = permission()[id]
    const direct = getRuleDefault(value)
    if (direct) return direct

    const wildcard = getRuleDefault(permission()["*"])
    if (wildcard) return wildcard

    return "allow"
  }

  const setPermission = async (id: string, action: PermissionAction) => {
    const before = globalSync.data.config.permission
    const map = toMap(before)
    const existing = map[id]

    const nextValue =
      existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing, "*": action } : action

    globalSync.set("config", "permission", { ...map, [id]: nextValue })
    globalSync.updateConfig({ permission: { [id]: nextValue } }).catch((err: unknown) => {
      globalSync.set("config", "permission", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("settings.permissions.toast.updateFailed.title"), description: message })
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 p-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.permissions.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.permissions.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-6 p-8 pt-6 max-w-[720px]">
        <div class="flex flex-col gap-2">
          <h3 class="text-14-medium text-text-strong">{language.t("settings.permissions.section.tools")}</h3>
          <div class="border border-border-weak-base rounded-lg overflow-hidden">
            <For each={ITEMS}>
              {(item) => (
                <SettingsRow title={language.t(item.title)} description={language.t(item.description)}>
                  <Select
                    options={actions()}
                    current={actions().find((o) => o.value === actionFor(item.id))}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(option) => option && setPermission(item.id, option.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
