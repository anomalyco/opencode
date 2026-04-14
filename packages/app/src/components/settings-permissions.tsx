import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, For, createMemo, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"

type PermissionAction = "allow" | "ask" | "deny"

type PermissionObject = Record<string, PermissionAction>
type PermissionValue = PermissionAction | PermissionObject | string[] | undefined
type PermissionMap = Record<string, PermissionValue>

type PermissionItem = {
  id: string
  title: string
  description: string
}

const ACTIONS: Array<{ value: PermissionAction; label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
]

const ITEMS: PermissionItem[] = [
  { id: "read", title: "Read", description: "Reading a file (matches the file path)" },
  { id: "edit", title: "Edit", description: "Modify files, including edits, writes, patches, and multi-edits" },
  { id: "glob", title: "Glob", description: "Match files using glob patterns" },
  { id: "grep", title: "Grep", description: "Search file contents using regular expressions" },
  { id: "list", title: "List", description: "List files within a directory" },
  { id: "bash", title: "Bash", description: "Run shell commands" },
  { id: "task", title: "Task", description: "Launch sub-agents" },
  { id: "skill", title: "Skill", description: "Load a skill by name" },
  { id: "lsp", title: "LSP", description: "Run language server queries" },
  { id: "todoread", title: "Todo Read", description: "Read the todo list" },
  { id: "todowrite", title: "Todo Write", description: "Update the todo list" },
  { id: "webfetch", title: "Web Fetch", description: "Fetch content from a URL" },
  { id: "websearch", title: "Web Search", description: "Search the web" },
  { id: "codesearch", title: "Code Search", description: "Search code on the web" },
  { id: "external_directory", title: "External Directory", description: "Access files outside the project directory" },
  { id: "doom_loop", title: "Doom Loop", description: "Detect repeated tool calls with identical input" },
]

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
      showToast({ title: "Failed to update permissions", description: message })
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-background-base border-b border-border-weak-base">
        <div class="flex flex-col gap-1 p-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">Permissions</h2>
          <p class="text-14-regular text-text-weak">Control what tools the server can use by default.</p>
        </div>
      </div>

      <div class="flex flex-col gap-6 p-8 pt-6 max-w-[720px]">
        <div class="flex flex-col gap-2">
          <h3 class="text-14-medium text-text-strong">Appearance</h3>
          <div class="border border-border-weak-base rounded-lg overflow-hidden">
            <For each={ITEMS}>
              {(item) => (
                <SettingsRow title={item.title} description={item.description}>
                  <Select
                    options={ACTIONS}
                    current={ACTIONS.find((o) => o.value === actionFor(item.id))}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(option) => option && setPermission(item.id, option.value)}
                    variant="secondary"
                    size="small"
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
