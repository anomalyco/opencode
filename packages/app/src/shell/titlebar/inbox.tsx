import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createEffect, createMemo, For, Show } from "solid-js"
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
import { pathKey } from "@/workspaces/path-key"
import { sessionTabTitle } from "./tab-title"
import { sessionTitle } from "@/session/title"
import { createSessionInbox, inboxArchived, inboxBusy, type InboxEntry, type SessionInbox } from "./inbox-model"

// `since` is when the inbox was first used; it only lists sessions that finished a run after it. `project` is the
// project filter, absent for all projects.
const InboxState = Persistence.struct({
  since: Persistence.optional(Schema.Number),
  project: Persistence.optional(Schema.String),
})

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const inbox = createSessionInbox({ archived: true })

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {})

  const projectOf = (entry: InboxEntry) => {
    const project = entry.ctx.projects.forSession(entry.session)
    const tag = servers.tag(entry.conn)
    const name = displayName(project ?? { worktree: entry.session.location.directory })

    return {
      key: `${entry.server}\0${project?.id ?? pathKey(entry.session.location.directory)}`,
      name,
      // Projects on another server keep the server in the picker, where two can share a name.
      label: tag ? `${name} · ${tag}` : name,
    }
  }

  const finished = (entry: InboxEntry) =>
    !inboxBusy(entry.status) && state.since !== undefined && (entry.session.time.idle ?? 0) >= state.since

  // Every session the inbox lists: running, waiting on you, or finished since the inbox was first used.
  const listed = createMemo(() => inbox.entries().filter((entry) => inboxBusy(entry.status) || finished(entry)))

  const projects = createMemo(() => [
    ...new Map(
      listed()
        .map((entry) => projectOf(entry))
        .map((project) => [project.key, project]),
    ).values(),
  ])

  // A filter whose project left the inbox shows everything rather than an empty list.
  const filter = () => (projects().some((project) => project.key === state.project) ? state.project : undefined)

  // Rows name their project only when the list mixes projects; otherwise it repeats on every row.
  const named = () => projects().length > 1 && !filter()

  const shown = createMemo(() => {
    const key = filter()

    return key ? listed().filter((entry) => projectOf(entry).key === key) : listed()
  })

  // Live rows want something from you or are still running; read rows settle into one line below them. Opening a live
  // row marks it read, so it stays live while it is open instead of jumping into Settled under the pointer.
  const live = createMemo((previous: Set<string>) => {
    const keys = shown().flatMap((entry) => {
      const unread = finished(entry) && !inboxArchived(entry) && entry.status !== "ready"
      const kept = previous.has(entry.key) && inbox.selected(entry)

      return inboxBusy(entry.status) || unread || kept ? [entry.key] : []
    })

    return new Set(keys)
  }, new Set<string>())

  const sections = createMemo(() => {
    const list = shown()
    const rank = (entry: InboxEntry) => (entry.status === "approval" || entry.status === "input" ? 0 : 1)

    // The latest activity: when a run finished, or when the running one was requested.
    const activity = (entry: InboxEntry) =>
      inboxBusy(entry.status) ? entry.session.time.updated : (entry.session.time.idle ?? 0)

    const settled = list
      .filter((entry) => !live().has(entry.key))
      .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0))

    return {
      // What needs you comes first, then everything else by its latest activity.
      live: list
        .filter((entry) => live().has(entry.key))
        .toSorted((a, b) => rank(a) - rank(b) || activity(b) - activity(a)),
      settled: settled.filter((entry) => !inboxArchived(entry)),
      archived: settled.filter(inboxArchived),
    }
  })

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().live.forEach((entry) => {
      if (entry.status !== "working" || entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // The inbox starts empty and fills as sessions finish runs.
  createEffect(() => {
    if (ready() && state.since === undefined) setState("since", Date.now())
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

  const menu = (entry: () => InboxEntry) => (
    <Menu.Context.Portal>
      <Menu.Context.Content>
        <Show
          when={inboxArchived(entry())}
          fallback={<Menu.Item onSelect={() => void inbox.archive(entry())}>{language.t("common.archive")}</Menu.Item>}
        >
          <Menu.Item onSelect={() => void inbox.unarchive(entry())}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
        </Show>
        <Menu.Separator />
        <Menu.Item onSelect={() => dialog.show(() => <DeleteDialog entry={entry()} />)}>
          {language.t("common.delete")}…
        </Menu.Item>
      </Menu.Context.Content>
    </Menu.Context.Portal>
  )

  const rows = (list: InboxEntry[], settled: boolean) => (
    <For each={list.map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <Menu.Context modal={false}>
              <Show
                when={settled}
                fallback={
                  <LiveRow entry={entry()} inbox={inbox} project={named() ? projectOf(entry()).name : undefined} />
                }
              >
                <SettledRow entry={entry()} inbox={inbox} project={named() ? projectOf(entry()).name : undefined} />
              </Show>
              {menu(entry)}
            </Menu.Context>
          )}
        </Show>
      )}
    </For>
  )

  const empty = () =>
    sections().live.length === 0 && sections().settled.length === 0 && sections().archived.length === 0

  return (
    <div data-slot="sidebar-inbox" class="@container flex min-h-0 flex-1 flex-col">
      {/* One picker scales to any number of projects, so it replaces per-project tabs. */}
      <Show when={projects().length > 1}>
        <div class="flex shrink-0 px-1.5 pb-1.5">
          <Menu modal={false} placement="bottom-start" gutter={4}>
            <Menu.Trigger
              as="button"
              type="button"
              class="flex h-6 min-w-0 items-center gap-1 rounded-[6px] text-[12px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:text-v2-text-text-base"
            >
              <span class="truncate">
                {projects().find((project) => project.key === filter())?.label ??
                  language.t("sidebar.inbox.project.all")}
              </span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-v2-text-text-faint" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.RadioGroup value={filter() ?? ""} onChange={(value) => setState("project", value || undefined)}>
                  <Menu.RadioItem value="" closeOnSelect>
                    {language.t("sidebar.inbox.project.all")}
                  </Menu.RadioItem>
                  <Menu.Separator />
                  <For each={projects().toSorted((a, b) => a.label.localeCompare(b.label))}>
                    {(project) => (
                      <Menu.RadioItem value={project.key} closeOnSelect>
                        {project.label}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </Show>
      <div data-slot="sidebar-inbox-scroll" data-scrollable class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
        <Show when={!empty()}>
          <div class="flex shrink-0 flex-col gap-px">{rows(sections().live, false)}</div>
        </Show>
        <Show when={empty()}>
          <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
            {language.t("sidebar.inbox.empty")}
          </div>
        </Show>
        <Show when={sections().settled.length > 0}>
          <SectionDivider label={language.t("sidebar.inbox.section.settled")} />
          <div class="flex shrink-0 flex-col">{rows(sections().settled, true)}</div>
        </Show>
        <Show when={sections().archived.length > 0}>
          <SectionDivider label={language.t("sidebar.inbox.section.archived")} />
          <div class="flex shrink-0 flex-col opacity-50">{rows(sections().archived, true)}</div>
        </Show>
      </div>
    </div>
  )
}

function SectionDivider(props: { label: string }) {
  return (
    <div class="mx-1.5 mt-3 mb-1 flex shrink-0 items-center gap-2 text-[11px] leading-4 font-medium text-v2-text-text-faint">
      <span class="shrink-0">{props.label}</span>
      <span aria-hidden="true" class="h-px flex-1 bg-v2-border-border-muted" />
    </div>
  )
}

const rowClass =
  "w-full min-w-0 shrink-0 rounded-[6px] px-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-02"

/**
 * A session that wants something or is still running: avatar, "project / title" and its state, then what it is
 * asking, aligned with the text so nothing sits under the avatar.
 */
function LiveRow(props: { entry: InboxEntry; inbox: SessionInbox; project?: string }) {
  const status = () => props.entry.status

  // The pending request's own words: the command or resource for a permission, the question for a form.
  const message = () => {
    if (status() === "approval") {
      const request = props.inbox.permission(props.entry)

      return request && { text: request.message ?? request.resources.join(" "), code: !request.message }
    }

    if (status() !== "input") return

    const form = props.inbox.form(props.entry)

    return form && { text: form.fields[0].description ?? form.fields[0].title ?? form.title, code: false }
  }

  return (
    <Menu.Context.Trigger
      as="button"
      type="button"
      data-slot="sidebar-inbox-item"
      data-status={status()}
      data-state={props.inbox.selected(props.entry) ? "active" : undefined}
      class={`${rowClass} grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-1.5 gap-y-1 py-1.5`}
      onClick={() => props.inbox.open(props.entry)}
    >
      <span class="flex h-4 items-center">
        <Avatar entry={props.entry} />
      </span>
      <Heading entry={props.entry} project={props.project} />
      {/* The state owns a column across both lines, so the message wraps before it. */}
      <span class="row-span-2 ms-1.5 flex h-4 items-center">
        <State entry={props.entry} now={props.inbox.now()} />
      </span>
      <Show when={message()}>
        {(value) => (
          <span
            dir="auto"
            class="col-start-2 line-clamp-2 min-w-0 text-[12px] leading-4 [overflow-wrap:anywhere] text-v2-text-text-muted"
            classList={{ "font-mono text-[13px] font-[440] tracking-[-0.04px]": value().code }}
          >
            {value().text}
          </span>
        )}
      </Show>
    </Menu.Context.Trigger>
  )
}

/** A read session: one quiet line. */
function SettledRow(props: { entry: InboxEntry; inbox: SessionInbox; project?: string }) {
  return (
    <Menu.Context.Trigger
      as="button"
      type="button"
      data-slot="sidebar-inbox-item"
      data-status={props.entry.status}
      data-state={props.inbox.selected(props.entry) ? "active" : undefined}
      class={`${rowClass} group flex h-[26px] items-center gap-1.5 text-v2-text-text-faint hover:text-v2-text-text-muted data-[state=active]:text-v2-text-text-base`}
      onClick={() => props.inbox.open(props.entry)}
    >
      <span class="flex opacity-60 group-hover:opacity-100 group-data-[state=active]:opacity-100">
        <Avatar entry={props.entry} />
      </span>
      <Heading entry={props.entry} project={props.project} settled />
      <span class="ms-1.5 shrink-0 text-[12px] leading-4 tabular-nums">
        <Age entry={props.entry} now={props.inbox.now()} />
      </span>
    </Menu.Context.Trigger>
  )
}

/** The project avatar; a session on another server names it in the tooltip. */
function Avatar(props: { entry: InboxEntry }) {
  const servers = useServers()
  const project = createMemo(() => props.entry.ctx.projects.forSession(props.entry.session))

  const avatar = () => (
    <SessionTabAvatarView project={project()} directory={props.entry.session.location.directory} unread={false} />
  )

  return (
    <Show when={servers.tag(props.entry.conn)} fallback={avatar()}>
      {(name) => (
        <Tooltip placement="right" value={name()} class="flex">
          {avatar()}
        </Tooltip>
      )}
    </Show>
  )
}

/** "project / title", or the title alone when the project is given away by the list. Below 240px the avatar alone
 * names the project, so the title keeps its room. */
function Heading(props: { entry: InboxEntry; project?: string; settled?: boolean }) {
  const language = useLanguage()

  return (
    <span class="flex h-4 min-w-0 flex-1 items-center gap-1 text-[13px] leading-4">
      <Show when={props.project}>
        <span
          class="max-w-[45%] shrink-0 truncate @max-[239px]:hidden"
          classList={{ "text-v2-text-text-muted": !props.settled }}
        >
          {props.project}
        </span>
        <span
          aria-hidden="true"
          class="shrink-0 @max-[239px]:hidden"
          classList={{ "text-v2-text-text-faint": !props.settled }}
        >
          /
        </span>
      </Show>
      <span dir="auto" class="min-w-0 truncate" classList={{ "font-medium text-v2-text-text-base": !props.settled }}>
        {sessionTabTitle(props.entry.session.title, language.t("session.tab.session"))}
      </span>
    </span>
  )
}

/** One slot, text only: what the session wants from you, that it failed, how long it has run, or its age. */
function State(props: { entry: InboxEntry; now: number }) {
  const language = useLanguage()
  const status = () => props.entry.status

  return (
    <span
      class="shrink-0 text-[12px] leading-4 tabular-nums"
      role={inboxBusy(status()) || status() === "failed" ? "status" : undefined}
    >
      <Show when={status() === "approval"}>
        <span class="text-v2-state-fg-warning">{language.t("sidebar.inbox.action.approve")}</span>
      </Show>
      <Show when={status() === "input"}>
        <span class="text-v2-state-fg-warning">{language.t("sidebar.inbox.action.answer")}</span>
      </Show>
      <Show when={status() === "failed"}>
        <span class="text-v2-state-fg-danger">{language.t("sidebar.inbox.status.failed")}</span>
      </Show>
      <Show when={status() === "working"}>
        {/* Announce only the status: the ticking duration would be re-read every second. */}
        <span class="sr-only">{language.t("sidebar.inbox.status.working")}</span>
        {/* Keep the status colour under the sweep. */}
        <span
          aria-hidden="true"
          class="[&_[data-component=text-shimmer]]:[--text-shimmer-base-color:var(--v2-state-fg-info)]"
        >
          <TextShimmer
            text={language.t("sidebar.inbox.status.workingFor", {
              duration: elapsed(language, props.now, props.entry.session.time.updated),
            })}
            active
          />
        </span>
      </Show>
      <Show when={status() === "done" || status() === "ready"}>
        <span class="text-v2-text-text-faint">
          <Age entry={props.entry} now={props.now} />
        </span>
      </Show>
    </span>
  )
}

function Age(props: { entry: InboxEntry; now: number }) {
  const language = useLanguage()

  const seconds = () =>
    Math.max(0, Math.floor((props.now - (props.entry.session.time.idle ?? props.entry.session.time.updated)) / 1000))

  return <>{seconds() < 60 ? language.t("sidebar.inbox.time.now") : compact(language, seconds())}</>
}

// `time.updated` moves when a prompt is enqueued, so it marks when the current run was requested.
function elapsed(language: ReturnType<typeof useLanguage>, now: number, since: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))

  return seconds < 60 ? language.plural("sidebar.inbox.elapsed.seconds", seconds) : compact(language, seconds)
}

function compact(language: ReturnType<typeof useLanguage>, seconds: number) {
  if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

  if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

  return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
}
