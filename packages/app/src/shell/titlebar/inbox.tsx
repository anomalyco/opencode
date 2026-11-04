import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { ActivityRing } from "@opencode/ui/activity-ring"
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
import type { LocalProject } from "@/shell/state/layout"
import { sessionTabTitle } from "./tab-title"
import { sessionTitle } from "@/session/title"
import { createSessionInbox, inboxArchived, inboxBusy, type InboxEntry, type InboxStatus } from "./inbox-model"
import { compareWorking, workingSince } from "./inbox-working"

const RECENT_LIMIT = 10

const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
})

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const inbox = createSessionInbox({ archived: true })

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
  })

  const sections = createMemo(() => {
    const list = inbox.entries()

    // Archived sessions are available through the Archived search dialog, not in the sidebar list.
    const active = list.filter((entry) => !inboxArchived(entry))

    const needs = active.filter((entry) => entry.status === "approval" || entry.status === "input")

    const recent = active
      .filter((entry) => !inboxBusy(entry.status) && entry.session.time.idle !== undefined)
      .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0))
      .slice(0, RECENT_LIMIT)

    // `time.updated` moves with every message of a run, so keep Working ordered by run start.
    const working = active.filter((entry) => entry.status === "working").toSorted(compareWorking)

    const current = list.find((entry) => inbox.selected(entry))

    return {
      needs,
      inbox: recent,
      current:
        current && ![...needs, ...recent, ...working].some((entry) => entry.key === current.key) ? [current] : [],
      archived: list.some(inboxArchived),
      working,
    }
  })

  const selectedWorking = createMemo(() => sections().working.find((entry) => inbox.selected(entry))?.key)

  // Expand when a working session becomes current, not on each update or manual collapse.
  createEffect(() => {
    if (!ready() || !selectedWorking()) return
    setState("workingExpanded", true)
  })

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().working.forEach((entry) => {
      if (entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // Git info is not stored on the session, so eagerly load it for every shown row.
  createEffect(() => {
    const visible = sections()

    inbox.loadBranches([...visible.needs, ...visible.current, ...visible.working, ...visible.inbox])
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

  // Takes an accessor so only the For tracks the section. Reading it here would recreate the For, remounting every
  // row on any session change and resetting the list's scroll.
  const rows = (list: () => InboxEntry[]) => (
    <For each={list().map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <InboxSessionCard
              project={entry().ctx.projects.forSession(entry().session)}
              directory={entry().session.location.directory}
              title={entry().session.title}
              status={entry().status}
              server={servers.tag(entry().conn)}
              since={
                entry().status === "working"
                  ? workingSince(entry().session)
                  : inboxBusy(entry().status)
                    ? (workingSince(entry().session) ?? entry().session.time.updated)
                    : (entry().session.time.idle ?? entry().session.time.updated)
              }
              selected={inbox.selected(entry())}
              now={inbox.now()}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              onOpen={() => inbox.open(entry())}
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
    <InboxSessionList
      needsCount={sections().needs.length}
      currentCount={sections().current.length}
      recentCount={sections().inbox.length}
      workingCount={sections().working.length}
      archived={sections().archived}
      workingExpanded={state.workingExpanded}
      onToggleWorking={() => setState("workingExpanded", !state.workingExpanded)}
      onArchived={async () => {
        const { DialogSessionSearch } = await import("@/shell/commands/session-search")

        void dialog.show(() => <DialogSessionSearch archived />)
      }}
      needs={rows(() => sections().needs)}
      current={rows(() => sections().current)}
      recent={rows(() => sections().inbox)}
      working={rows(() => sections().working)}
    />
  )
}

export function InboxSessionList(props: {
  needsCount: number
  currentCount: number
  recentCount: number
  workingCount: number
  archived: boolean
  workingExpanded: boolean
  onToggleWorking: () => void
  onArchived: () => void
  needs: JSX.Element
  current: JSX.Element
  recent: JSX.Element
  working: JSX.Element
}) {
  const language = useLanguage()

  return (
    <div data-slot="sidebar-inbox" class="flex min-h-0 flex-1 flex-col">
      <div data-slot="sidebar-inbox-scroll" class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
        <Show when={props.currentCount > 0}>
          <div class="flex shrink-0 flex-col gap-0.5 pb-2.5">{props.current}</div>
        </Show>
        <Show when={props.needsCount > 0}>
          <div class="flex shrink-0 flex-col gap-2 pb-2.5">
            <SectionHeader label={language.t("sidebar.inbox.section.needsAttention")} />
            <div class="flex flex-col gap-0.5">{props.needs}</div>
          </div>
        </Show>
        <Show
          when={props.recentCount > 0}
          fallback={
            <Show when={props.needsCount === 0 && props.currentCount === 0 && props.workingCount === 0}>
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
          }
        >
          <div class="flex shrink-0 flex-col gap-2">
            <SectionHeader label={language.t("sidebar.inbox.section.recent")} />
            <div class="flex flex-col gap-0.5">{props.recent}</div>
          </div>
        </Show>
        <Show when={props.archived}>
          <div class="shrink-0 pt-3">
            <Button variant="ghost-muted" size="normal" class="w-full justify-start px-2" onClick={props.onArchived}>
              {language.t("sidebar.inbox.section.archived")}
            </Button>
          </div>
        </Show>
      </div>
      {/* Working sessions sit in a shelf pinned below the scrolling list. */}
      <Show when={props.workingCount > 0}>
        <div data-slot="sidebar-inbox-working" class="relative flex max-h-[40%] shrink-0 flex-col gap-2 pt-[7px]">
          <span
            aria-hidden="true"
            class="pointer-events-none absolute top-0 h-px bg-v2-border-border-muted"
            style={{
              "inset-inline-start": "calc(1px - var(--sidebar-inset-start, 11px))",
              "inset-inline-end": "calc(1px - (var(--sidebar-inset-end, 3px) + var(--sidebar-divider-bleed, 0px)))",
            }}
          />
          <SectionHeader
            label={language.t("sidebar.inbox.section.working")}
            expanded={props.workingExpanded}
            shimmer={!props.workingExpanded}
            onToggle={props.onToggleWorking}
          />
          <Show when={props.workingExpanded}>
            <div class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">{props.working}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function SectionHeader(props: { label: string; expanded?: boolean; shimmer?: boolean; onToggle?: () => void }) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">
        <Show when={props.shimmer} fallback={props.label}>
          <TextShimmer text={props.label} active />
        </Show>
      </span>
      <Show when={props.onToggle}>
        <Icon
          name="fill-triangle-down"
          size="small"
          class="shrink-0 transition-transform"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
    </>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div class="flex h-6 shrink-0 items-center gap-1.5 px-2 text-[13px] leading-4 font-medium text-v2-text-text-muted">
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          aria-expanded={props.expanded}
          class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

export function InboxSessionCard(props: {
  project?: LocalProject
  directory: string
  title?: string
  status: InboxStatus
  server?: string
  since: number | undefined
  selected: boolean
  now: number
  branch: string | undefined
  worktree: boolean
  archived: boolean
  onOpen: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const status = () => props.status

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const statusLabel = (value: InboxStatus) =>
    value === "ready" ? undefined : language.t(`sidebar.inbox.status.${value}`)

  const age = () => {
    if (props.since === undefined) return

    const seconds = Math.max(0, Math.floor((props.now - props.since) / 1000))

    if (status() === "working" && seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

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
        class="group flex h-[54px] w-full shrink-0 flex-col gap-1.5 rounded-[6px] p-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-70": status() === "working" && !props.selected,
          "opacity-50": props.archived && !props.selected,
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center gap-2">
          <span class="flex size-4 shrink-0 items-center justify-center">
            <SessionTabAvatarView project={props.project} directory={props.directory} unread={false} />
          </span>
          <span
            dir="auto"
            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base"
          >
            {sessionTabTitle(props.title, language.t("session.tab.session"))}
          </span>
        </span>
        <span class="relative flex h-4 w-full min-w-0 shrink-0 items-center gap-2 ps-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
          <Show when={props.server}>
            {(name) => (
              <Tooltip placement="right" value={name()} class="absolute start-0 top-0 flex size-4 shrink-0">
                <Icon name="server" aria-label={name()} class="text-v2-icon-icon-muted" />
              </Tooltip>
            )}
          </Show>
          <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-v2-icon-icon-muted">
            <span dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
              {displayName(props.project ?? { worktree: props.directory })}
            </span>
            <Show when={props.worktree}>
              <Tooltip placement="right" value={props.directory} class="flex shrink-0">
                <Icon name="outline-worktree" />
              </Tooltip>
            </Show>
            <Show when={props.branch}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex shrink-0">
                  <Icon name="branch" />
                </Tooltip>
              )}
            </Show>
          </span>
          <span
            class="ms-auto flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums"
            role={status() === "ready" ? undefined : "status"}
          >
            <Show when={status() !== "ready"}>
              <span class="sr-only">{statusLabel(status())}</span>
              <Show
                when={status() === "working"}
                fallback={
                  <span
                    aria-hidden="true"
                    class="size-[7px] shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": status() === "approval" || status() === "input",
                      "bg-v2-state-fg-danger": status() === "failed",
                      "bg-v2-background-bg-accent": status() === "done",
                    }}
                  />
                }
              >
                <ActivityRing class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </Show>
            {/* Announce only the state, not each age update. */}
            <Show when={age()}>
              {(label) => (
                <span aria-hidden={status() === "ready" ? undefined : "true"} class="text-v2-text-text-faint">
                  {label()}
                </span>
              )}
            </Show>
          </span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
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
