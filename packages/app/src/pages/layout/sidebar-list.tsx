import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { sortedRootSessions, displayName } from "./helpers"
import { SessionStatusIndicator } from "./sidebar-session-status"

function relativeTime(timestamp: number, now: number, language: ReturnType<typeof useLanguage>) {
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return language.t("common.time.justNow")
  if (minutes < 60) return language.t("common.time.minutesAgo.short", { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return language.t("common.time.hoursAgo.short", { count: hours })
  const days = Math.floor(hours / 24)
  return language.t("common.time.daysAgo.short", { count: days })
}

type ProjectGroup = {
  project: LocalProject
  sessions: Session[]
  slug: string
}

export const SidebarListContent = (props: {
  projects: Accessor<LocalProject[]>
  sortNow: Accessor<number>
  onNewSession: (directory: string) => void
  onOpenSettings: () => void
  onOpenProject: () => void
  archiveSession: (session: Session) => Promise<void>
  openProjectLabel: Accessor<string>
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  newSessionLabel: Accessor<string>
  newSessionKeybind: Accessor<string | undefined>
  currentSessionId: Accessor<string | undefined>
  threadsLabel: Accessor<string>
  helpLabel: Accessor<string>
  onOpenHelp: () => void
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const groups = createMemo((): ProjectGroup[] =>
    props.projects().map((project) => {
      const [store] = globalSync.child(project.worktree, { bootstrap: false })
      const sessions = sortedRootSessions(store, props.sortNow())
      return { project, sessions, slug: base64Encode(project.worktree) }
    }),
  )

  return (
    <div class="flex flex-col h-full w-full bg-background-stronger">
      {/* Projects header */}
      <div class="shrink-0 px-3 pt-4 pb-1 flex items-center justify-between">
        <span class="text-12-medium text-text-weak px-3">{props.threadsLabel()}</span>
        <Tooltip value={props.openProjectLabel()} placement="top">
          <IconButton
            icon="folder-add-left"
            variant="ghost"
            class="size-6 rounded-md"
            aria-label={props.openProjectLabel()}
            onClick={props.onOpenProject}
          />
        </Tooltip>
      </div>

      {/* Session list grouped by project */}
      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 py-1">
        <For each={groups()}>
          {(group) => (
            <ProjectGroupItem
              group={group}
              onNewSession={props.onNewSession}
              archiveSession={props.archiveSession}
              newSessionLabel={props.newSessionLabel}
              currentSessionId={props.currentSessionId}
              sortNow={props.sortNow}
              language={language}
            />
          )}
        </For>
      </div>

      {/* Bottom - Settings */}
      <div class="shrink-0 px-3 py-3 border-t border-border-weak-base flex flex-col gap-0.5">
        <TooltipKeybind placement="top" title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-2 rounded-md text-14-medium text-text-base hover:bg-surface-raised-base-hover transition-colors text-left"
            onClick={props.onOpenSettings}
          >
            <Icon name="settings-gear" size="small" class="text-icon-base" />
            {props.settingsLabel()}
          </button>
        </TooltipKeybind>
      </div>
    </div>
  )
}

const ProjectGroupItem = (props: {
  group: ProjectGroup
  onNewSession: (directory: string) => void
  archiveSession: (session: Session) => Promise<void>
  newSessionLabel: Accessor<string>
  currentSessionId: Accessor<string | undefined>
  sortNow: Accessor<number>
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <div class="mb-1">
      <div class="group/project flex items-center gap-1 px-2 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors">
        <button
          type="button"
          class="flex items-center gap-2 min-w-0 flex-1 text-left"
          onClick={() => setCollapsed(!collapsed())}
        >
          <Icon
            name="chevron-right"
            size="small"
            class="text-icon-base shrink-0 transition-transform"
            classList={{ "rotate-90": !collapsed() }}
          />
          <span class="text-14-medium text-text-base truncate">{displayName(props.group.project)}</span>
        </button>
        <Tooltip value={`${props.newSessionLabel()} in ${displayName(props.group.project)}`} placement="top">
          <IconButton
            icon="edit"
            variant="ghost"
            class="size-6 rounded-md shrink-0 opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto group-focus-within/project:opacity-100 group-focus-within/project:pointer-events-auto transition-opacity"
            aria-label={`${props.newSessionLabel()} in ${displayName(props.group.project)}`}
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              props.onNewSession(props.group.project.worktree)
            }}
          />
        </Tooltip>
      </div>
      <Show when={!collapsed()}>
        <div class="flex flex-col gap-0.5">
          <For each={props.group.sessions}>
            {(session) => (
              <SessionRow
                session={session}
                slug={props.group.slug}
                currentSessionId={props.currentSessionId}
                sortNow={props.sortNow}
                archiveSession={props.archiveSession}
                language={props.language}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const SessionRow = (props: {
  session: Session
  slug: string
  currentSessionId: Accessor<string | undefined>
  sortNow: Accessor<number>
  archiveSession: (session: Session) => Promise<void>
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const [confirming, setConfirming] = createSignal(false)
  const active = createMemo(() => props.currentSessionId() === props.session.id)
  const time = createMemo(() => {
    const updated = props.session.time.updated ?? props.session.time.created
    return relativeTime(updated, props.sortNow(), props.language)
  })

  return (
    <A
      href={`/${props.slug}/session/${props.session.id}`}
      class="group/session relative flex items-center justify-between w-full px-3 py-1.5 pl-7 rounded-md text-left cursor-default transition-colors hover:bg-surface-raised-base-hover"
      classList={{
        "bg-surface-base-active": active(),
      }}
      onMouseLeave={() => setConfirming(false)}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <SessionStatusIndicator session={props.session} />
      </div>
      <span class="text-14-regular text-text-strong truncate min-w-0 flex-1">{props.session.title}</span>
      <div class="flex items-center gap-1 shrink-0 ml-2">
        {/* Diff changes + time: visible by default, hidden on hover */}
        <div class="flex items-center gap-2 group-hover/session:hidden">
          <Show when={props.session.summary} fallback={<span class="text-12-regular text-text-weak">{time()}</span>}>
            {(summary) => <DiffChanges changes={summary()} />}
          </Show>
        </div>
        {/* Archive button: hidden by default, visible on hover */}
        <div class="hidden group-hover/session:flex items-center">
          <Show
            when={confirming()}
            fallback={
              <Tooltip value={props.language.t("common.archive")} placement="top">
                <IconButton
                  icon="archive"
                  variant="ghost"
                  class="size-6 rounded-md"
                  aria-label={props.language.t("common.archive")}
                  onClick={(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setConfirming(true)
                  }}
                />
              </Tooltip>
            }
          >
            <button
              type="button"
              class="px-2 py-0.5 rounded-md text-12-medium text-text-weak hover:text-text-strong hover:bg-surface-raised-base-hover transition-colors"
              onClick={(event: MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                void props.archiveSession(props.session)
              }}
            >
              {props.language.t("common.cancel")}
            </button>
          </Show>
        </div>
      </div>
    </A>
  )
}
