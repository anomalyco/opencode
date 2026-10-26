import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName } from "@opencode/ui/project-avatar"
import { useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { sessionTabTitle } from "./tab-title"
import { sessionTitle } from "@/session/title"
import {
  createSessionInbox,
  groupInboxByProject,
  inboxArchived,
  inboxProjectKey,
  inboxProjects,
  partitionInboxEntries,
  type InboxEntry,
  type InboxStatus,
} from "./inbox-model"

// `since` is when the inbox was first used; Recent only lists sessions that finished a run after it.
const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  since: Persistence.optional(Schema.Number),
  pinned: Persistence.optional(Persistence.array(Schema.String)),
  project: Persistence.optional(Schema.String),
  groupByProject: Persistence.optional(Schema.Boolean),
  collapsedProjects: Persistence.optional(Persistence.array(Schema.String)),
})

const ALL_PROJECTS = ""

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const inbox = createSessionInbox({ archived: true })

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
  })

  const projectName = (entry: InboxEntry) =>
    displayName(entry.ctx.projects.forSession(entry.session) ?? { worktree: entry.session.location.directory })

  const projects = createMemo(() => inboxProjects(inbox.entries(), projectName))
  const projectLabels = createMemo(() => new Map(projects().map((item) => [item.key, item.label])))

  const sections = createMemo(() =>
    partitionInboxEntries(inbox.entries(), {
      since: state.since,
      pinned: state.pinned,
      project: state.project,
    }),
  )

  const activeProject = createMemo(() => {
    const key = sections().project

    if (!key) return undefined

    return projects().find((item) => item.key === key)
  })

  const recentGroups = createMemo(() =>
    groupInboxByProject(sections().inbox, (entry) => projectLabels().get(inboxProjectKey(entry)) ?? projectName(entry)),
  )

  const pinnedSet = createMemo(() => new Set(state.pinned ?? []))

  const togglePin = (key: string) => {
    const current = state.pinned ?? []
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]

    setState("pinned", next.length > 0 ? next : undefined)
  }

  const collapsedSet = createMemo(() => new Set(state.collapsedProjects ?? []))

  const toggleProjectGroup = (key: string) => {
    const current = state.collapsedProjects ?? []
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]

    setState("collapsedProjects", next.length > 0 ? next : undefined)
  }

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().working.forEach((entry) => {
      if (entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // The inbox starts empty and fills as sessions finish runs.
  createEffect(() => {
    if (ready() && state.since === undefined) setState("since", Date.now())
  })

  // Git info is not stored on the session, so eagerly load it for every shown row.
  createEffect(() => {
    const visible = sections()

    inbox.loadBranches([...visible.needs, ...visible.pinned, ...visible.working, ...visible.inbox, ...visible.archived])
  })

  function DeleteDialog(props: { entry: InboxEntry }) {
    const confirm = async () => {
      await inbox.remove(props.entry)
      dialog.close()
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", {
              name: sessionTitle(props.entry.session.title) ?? language.t("command.session.new"),
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  const rows = (list: InboxEntry[]) => (
    <For each={list.map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <InboxRow
              entry={entry()}
              selected={inbox.selected(entry())}
              pinned={pinnedSet().has(entry().key)}
              now={inbox.now()}
              branchLoading={inbox.branchLoading(entry())}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              onOpen={() => inbox.open(entry())}
              onTogglePin={() => togglePin(entry().key)}
              onArchive={() => void inbox.archive(entry())}
              onUnarchive={() => void inbox.unarchive(entry())}
              onDelete={() => dialog.show(() => <DeleteDialog entry={entry()} />)}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <div data-slot="sidebar-inbox" class="flex min-h-0 flex-1 flex-col">
      <Show when={projects().length > 1 || sections().project !== undefined || !!state.groupByProject}>
        <div data-slot="sidebar-inbox-filter" class="flex shrink-0 items-center pb-1">
          <Menu modal={false} placement="bottom-start">
            <Menu.Trigger
              as="button"
              type="button"
              class="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 text-start text-[12px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
            >
              <Show when={activeProject()}>
                {(item) => (
                  <span class="flex size-4 shrink-0 items-center justify-center">
                    <SessionTabAvatarView
                      project={item().entry.ctx.projects.forSession(item().entry.session)}
                      directory={item().directory}
                      unread={false}
                    />
                  </span>
                )}
              </Show>
              <span class="min-w-0 truncate">
                {activeProject()?.label ?? language.t("sidebar.inbox.filter.allProjects")}
              </span>
              <Icon name="chevron-down" size="small" class="ms-auto shrink-0" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.RadioGroup
                  value={sections().project ?? ALL_PROJECTS}
                  onChange={(value) => setState("project", value === ALL_PROJECTS ? undefined : value)}
                >
                  <Menu.RadioItem value={ALL_PROJECTS}>{language.t("sidebar.inbox.filter.allProjects")}</Menu.RadioItem>
                  <For each={projects()}>
                    {(item) => (
                      <Menu.RadioItem value={item.key} badge={String(item.count)}>
                        {item.label}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
                <Menu.Separator />
                <Menu.CheckboxItem
                  checked={!!state.groupByProject}
                  onChange={(checked) => setState("groupByProject", checked ? true : undefined)}
                >
                  {language.t("sidebar.inbox.groupByProject")}
                </Menu.CheckboxItem>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </Show>
      <div data-slot="sidebar-inbox-scroll" class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-1">
        <Show when={sections().needs.length > 0}>
          <div class="flex shrink-0 flex-col gap-px pb-3">
            <SectionHeader label={language.t("sidebar.inbox.section.needsAttention")} count={sections().needs.length} />
            {rows(sections().needs)}
          </div>
        </Show>
        <Show when={sections().pinned.length > 0}>
          <div class="flex shrink-0 flex-col gap-px pb-3">
            <SectionHeader label={language.t("sidebar.inbox.section.pinned")} count={sections().pinned.length} />
            {rows(sections().pinned)}
          </div>
        </Show>
        <Show
          when={sections().inbox.length > 0}
          fallback={
            <Show
              when={
                sections().needs.length === 0 &&
                sections().pinned.length === 0 &&
                sections().working.length === 0 &&
                sections().archived.length === 0
              }
            >
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
          }
        >
          <Show when={sections().needs.length > 0 || sections().pinned.length > 0}>
            <SectionHeader label={language.t("sidebar.inbox.section.recent")} />
          </Show>
          <Show when={state.groupByProject && !sections().project} fallback={rows(sections().inbox)}>
            <For each={recentGroups()}>
              {(group) => {
                const expanded = () => !collapsedSet().has(group.key)

                return (
                  <div class="flex shrink-0 flex-col gap-px pb-1">
                    <SectionHeader
                      label={group.label}
                      count={group.entries.length}
                      expanded={expanded()}
                      onToggle={() => toggleProjectGroup(group.key)}
                    />
                    {rows(group.entries.filter((entry) => expanded() || inbox.selected(entry)))}
                  </div>
                )
              }}
            </For>
          </Show>
        </Show>
        <Show when={sections().archived.length > 0}>
          <div class="flex shrink-0 flex-col gap-px pt-3">
            <SectionHeader label={language.t("sidebar.inbox.section.archived")} />
            {rows(sections().archived)}
          </div>
        </Show>
      </div>
      {/* Working sessions sit in a shelf pinned below the scrolling list. */}
      <Show when={sections().working.length > 0}>
        <div
          data-slot="sidebar-inbox-working"
          class="flex max-h-[40%] shrink-0 flex-col gap-px border-t border-v2-border-border-muted pt-1.5"
        >
          <SectionHeader
            label={language.t("sidebar.inbox.section.working")}
            count={sections().working.length}
            expanded={state.workingExpanded}
            onToggle={() => setState("workingExpanded", !state.workingExpanded)}
          />
          <div class="flex min-h-0 flex-col gap-px overflow-y-auto">
            {/* A collapsed shelf still shows the session that is open. */}
            {rows(sections().working.filter((entry) => state.workingExpanded || inbox.selected(entry)))}
          </div>
        </div>
      </Show>
    </div>
  )
}

function SectionHeader(props: { label: string; count?: number; expanded?: boolean; onToggle?: () => void }) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">{props.label}</span>
      <Show when={props.count}>
        <span class="shrink-0 tabular-nums text-v2-text-text-faint">{props.count}</span>
      </Show>
      <Show when={props.onToggle}>
        <Icon
          name="chevron-down"
          size="small"
          class="ms-auto shrink-0 transition-transform"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
    </>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div class="flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted">
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          aria-expanded={props.expanded}
          class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-start text-[12px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

function InboxRow(props: {
  entry: InboxEntry
  selected: boolean
  pinned: boolean
  now: number
  branchLoading: boolean
  branch: string | undefined
  worktree: boolean
  archived: boolean
  onOpen: () => void
  onTogglePin: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const servers = useServers()
  const project = createMemo(() => props.entry.ctx.projects.forSession(props.entry.session))
  const status = () => props.entry.status

  const nonReadyStatus = (): Exclude<InboxStatus, "ready"> | undefined => {
    const current = status()

    return current === "ready" ? undefined : current
  }

  const unread = () => status() !== "ready" && status() !== "working"

  // Sessions on the current server are not marked.
  const tag = () => servers.tag(props.entry.conn)

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const elapsed = () => {
    // `time.updated` moves when a prompt is enqueued, so it marks when the current run was requested.
    const seconds = Math.max(0, Math.floor((props.now - props.entry.session.time.updated) / 1000))

    return seconds < 60 ? language.plural("sidebar.inbox.elapsed.seconds", seconds) : compact(seconds)
  }

  const age = () => {
    const seconds = Math.max(
      0,
      Math.floor((props.now - (props.entry.session.time.idle ?? props.entry.session.time.updated)) / 1000),
    )

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        data-slot="sidebar-inbox-item"
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        class="group flex w-full shrink-0 flex-col gap-0.5 rounded-[6px] px-1.5 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-02"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-70": status() === "working" && !props.selected,
          "opacity-50": props.archived && !props.selected,
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-4 w-full min-w-0 items-center gap-1.5 text-[12px] leading-4 text-v2-text-text-faint">
          <span class="flex size-4 shrink-0 items-center justify-center">
            <SessionTabAvatarView
              project={project()}
              directory={props.entry.session.location.directory}
              unread={false}
            />
          </span>
          <span class="min-w-0 truncate">
            {displayName(project() ?? { worktree: props.entry.session.location.directory })}
          </span>
          <span class="ms-auto shrink-0 tabular-nums" role={status() === "ready" ? undefined : "status"}>
            <Show when={nonReadyStatus()} fallback={age()}>
              {(activeStatus) => (
                <span
                  classList={{
                    "text-v2-state-fg-warning": activeStatus() === "approval" || activeStatus() === "input",
                    "text-v2-state-fg-info": activeStatus() === "working",
                    "text-v2-state-fg-danger": activeStatus() === "failed",
                    "text-v2-state-fg-success": activeStatus() === "done",
                  }}
                >
                  <Show
                    when={activeStatus() === "working"}
                    fallback={language.t(`sidebar.inbox.status.${activeStatus()}`)}
                  >
                    {/* Announce only the status: the ticking duration would be re-read every second. */}
                    <span class="sr-only">{language.t("sidebar.inbox.status.working")}</span>
                    {/* Keep the status colour under the sweep. */}
                    <span
                      aria-hidden="true"
                      class="[&_[data-component=text-shimmer]]:[--text-shimmer-base-color:var(--v2-state-fg-info)]"
                    >
                      <TextShimmer
                        text={language.t("sidebar.inbox.status.workingFor", { duration: elapsed() })}
                        active
                      />
                    </span>
                  </Show>
                </span>
              )}
            </Show>
          </span>
        </span>
        <span
          dir="auto"
          class="w-full min-w-0 truncate text-[13px] leading-4"
          // Rows recede once read so unread results stand out.
          classList={{
            "font-medium text-v2-text-text-base": unread(),
            "text-v2-text-text-muted": !unread(),
          }}
        >
          {sessionTabTitle(props.entry.session.title, language.t("session.tab.session"))}
        </span>
        <Show when={props.branchLoading || props.branch || props.worktree || tag()}>
          <span class="flex h-4 w-full min-w-0 items-center gap-1 text-[12px] leading-4 text-v2-text-text-faint">
            <Show when={props.branchLoading}>
              <span
                aria-hidden="true"
                class="h-2.5 w-24 max-w-full animate-pulse rounded-full bg-v2-background-bg-layer-03"
              />
            </Show>
            <Show when={!props.branchLoading && (props.branch || props.worktree)}>
              <span class="flex min-w-0 items-center gap-1">
                {/* The worktree icon stands in for the branch icon to mark sessions outside the project checkout. */}
                <Icon name={props.worktree ? "outline-worktree" : "branch"} size="small" class="shrink-0" />
                <Show when={props.branch}>
                  {(name) => (
                    <span dir="ltr" class="min-w-0 truncate">
                      {name()}
                    </span>
                  )}
                </Show>
              </span>
            </Show>
            <Show when={tag()}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="ms-auto flex shrink-0">
                  <Icon name="server" size="small" aria-label={name()} />
                </Tooltip>
              )}
            </Show>
          </span>
        </Show>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show when={!props.archived}>
            <Menu.Item onSelect={props.onTogglePin}>
              {language.t(props.pinned ? "sidebar.inbox.unpin" : "sidebar.inbox.pin")}
            </Menu.Item>
          </Show>
          <Show
            when={props.archived}
            fallback={<Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>}
          >
            <Menu.Item onSelect={props.onUnarchive}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
          </Show>
          <Menu.Separator />
          <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
