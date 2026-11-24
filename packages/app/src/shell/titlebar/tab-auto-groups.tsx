import { Schema } from "effect"
import { createMemo, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { useSettings } from "@/settings/model"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import type { TabStripSection } from "./tab-strip"

const Collapsed = Persistence.struct({ collapsed: Persistence.array(Schema.String) })

type Group = { key: string; tabs: Tab[]; project: Project | undefined; server: string }

/**
 * The navigation prototype's automatic tab groups: the tabs that aren't pinned, by project or by server. Groups keep
 * the order their first tab has, so they never jump; the strip only reorders a tab within its group. Side tabs head
 * each group with its project or server and can collapse it, keeping the current tab; top tabs divide groups with a
 * line.
 */
export function createTabAutoGroups(input: {
  tabs: () => Tab[]
  hidden: (tab: Tab) => boolean
  current: () => Tab | undefined
}) {
  const settings = useSettings()
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const [state, setState] = persisted(Persist.global("navigation.tab-groups"), Collapsed, { collapsed: [] })

  const grouping = () => {
    const value = settings.appearance.tabGrouping()

    if (value === "server" && servers.visible.length < 2) return "none"

    return value
  }

  const projectOf = (tab: Tab) => {
    const ctx = global.serverCtx(tab.server)

    if (!ctx) return

    if (tab.type === "draft") return ctx.projects.forDirectory(tab.directory)
    const session = ctx.data.session.get(tab.sessionId)

    return session ? ctx.projects.forSession(session) : undefined
  }

  const groupKey = (tab: Tab, project: Project | undefined) => {
    if (grouping() === "server") return `server:${tab.server}`

    return project ? `project:${tab.server}\u0000${pathKey(project.worktree)}` : `project:${tab.server}\u0000`
  }

  const groups = createMemo(() => {
    if (grouping() === "none") return

    const byKey = new Map<string, Group>()

    input.tabs().forEach((tab) => {
      if (input.hidden(tab)) return
      const project = projectOf(tab)
      const key = groupKey(tab, project)
      const group = byKey.get(key)

      if (group) return group.tabs.push(tab)
      byKey.set(key, { key, tabs: [tab], project, server: tab.server })
    })

    return [...byKey.values()]
  })

  const collapsed = (key: string) => state.collapsed.includes(key)

  const toggle = (key: string) =>
    setState("collapsed", (current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )

  const label = (group: Group) => {
    if (grouping() === "server") {
      const conn = servers.visible.find((item) => ServerConnection.key(item) === group.server)

      return conn ? servers.label(conn) : group.server
    }

    return group.project ? displayName(group.project) : language.t("navigation.tabs.otherProject")
  }

  const isCurrent = (tab: Tab) => {
    const current = input.current()

    return !!current && tabKey(current) === tabKey(tab)
  }

  // A sections list keyed by group, as the tab strip takes it, for either orientation.
  const sections = (orientation: "horizontal" | "vertical") =>
    createMemo((): TabStripSection[] | undefined =>
      groups()?.map((group, index) => ({
        key: group.key,
        tabs: orientation === "vertical" && collapsed(group.key) ? group.tabs.filter(isCurrent) : group.tabs,
        hideAvatars: orientation === "vertical" && grouping() === "project",
        header:
          orientation === "vertical" ? (
            <GroupHeader
              label={label(group)}
              icon={
                grouping() === "server" || !group.project ? (
                  <Icon name={grouping() === "server" ? "server" : "outline-dots"} class="text-v2-icon-icon-muted" />
                ) : (
                  <ProjectIcon project={group.project} />
                )
              }
              collapsed={collapsed(group.key)}
              onToggle={() => toggle(group.key)}
            />
          ) : index > 0 ? (
            <div
              aria-hidden="true"
              data-slot="tab-group-divider"
              class="mx-1 h-4 w-px shrink-0 self-center bg-v2-border-border-muted"
            />
          ) : undefined,
      })),
    )

  return { grouping, sections }
}

function GroupHeader(props: { label: string; icon: JSX.Element; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-slot="tab-group-header"
      aria-expanded={!props.collapsed}
      class="group/tabgroup mt-2.5 flex h-6 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-start text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted first:mt-0 hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={props.onToggle}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span dir="auto" class="min-w-0 truncate">
        {props.label}
      </span>
      <Icon
        name="fill-triangle-down"
        class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-[transform,opacity] group-hover/tabgroup:opacity-100 group-focus-within/tabgroup:opacity-100 motion-reduce:transition-none"
        classList={{ "-rotate-90 rtl:rotate-90": props.collapsed }}
      />
    </button>
  )
}
