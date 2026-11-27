import type { SessionInfo } from "@opencode/client/promise"
import { DragDropProvider } from "@dnd-kit/solid"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import {
  DialogStoryRuntime,
  STORY_DIRECTORY,
  STORY_PROJECTS,
  STORY_SERVER,
} from "@/components-lab/dialog-story-runtime"
import { HomeSessionsView } from "@/home/sessions/view"
import { groupSessions } from "@/home/sessions/controller"
import { buildHomeSessionRecords, homeSessionLocation } from "@/home/sessions/records"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { normalizeProjectInfo } from "@/runtime/server/global-sync/utils"
import { SessionReferenceMenu } from "@/session/session-reference-menu"
import { InboxSessionCard, InboxSessionMenuItems } from "@/shell/titlebar/inbox"
import { PinMenuItems, PinnedSession, PinsProvider, usePins } from "@/shell/titlebar/pinned-area"
import { ProjectSessionRow } from "@/shell/titlebar/project-session-row"
import { RecentSessionTab } from "@/shell/titlebar/recent-sessions"
import { recentSessionKey } from "@/shell/titlebar/recent-sessions-model"
import { createSessionPins, PinnedSessionRow } from "@/shell/titlebar/sidebar-pins"
import { DraftTabItem, TabNavItem } from "@/shell/titlebar/tab-nav"

const surfaces = [
  "tab",
  "tab-pin-items",
  "tab-vertical",
  "draft-tab",
  "pinned-tab",
  "recent-row",
  "recent-row-pinned",
  "sidebar-pinned-row",
  "project-row",
  "inbox-card",
  "inbox-card-archived",
  "home-row",
  "mention",
] as const

type Args = { surface: (typeof surfaces)[number]; title: "real" | "fallback"; state: "idle" | "unread" | "never-run" }

const server = ServerConnection.key(STORY_SERVER)

const noop = () => {}

function storySession(args: Args): SessionInfo {
  const created = Date.UTC(2026, 10, 26, 9, 30)

  return {
    id: "ses_story_menu",
    projectID: STORY_PROJECTS[0].id,
    title: args.title === "real" ? "Review the session copy menu" : "New session - 2026-11-26T09:30:00.000Z",
    location: { directory: STORY_DIRECTORY },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created,
      updated: created,
      idle: args.state === "never-run" ? undefined : created + 60_000,
      viewed: args.state === "idle" ? created + 60_000 : undefined,
    },
  }
}

function MenuStory(props: Args) {
  const global = useGlobal()

  const session = createMemo(() => storySession(props))

  global.serverCtx(server)?.data.session.remember(session())

  let root!: HTMLDivElement

  onMount(() => {
    const timer = setTimeout(() => {
      const target = [
        "[data-component=home-session-row-container]",
        "[data-titlebar-tab-link]",
        "[data-titlebar-tab-item]",
        "[data-slot=sidebar-inbox-item]",
        "button, a",
      ]
        .map((selector) => root.querySelector<HTMLElement>(selector))
        .find((element) => !!element)

      if (!target) return
      const box = target.getBoundingClientRect()
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.left + Math.min(48, box.width / 2),
          clientY: box.top + box.height / 2,
        }),
      )
    }, 400)

    onCleanup(() => clearTimeout(timer))
  })

  return (
    <div ref={root} class="flex min-h-dvh w-full items-start justify-start bg-v2-background-bg-deep p-6">
      <div class="w-[280px]">
        <Surface {...props} session={session()} />
      </div>
    </div>
  )
}

function Surface(props: Args & { session: SessionInfo }) {
  const tab = (extra?: Partial<Parameters<typeof TabNavItem>[0]>): JSX.Element => (
    <div data-titlebar-tab-slot class="relative flex w-full shrink-0">
      <TabNavItem
        href="#"
        server={server}
        session={props.session}
        preparing={false}
        unread={props.state === "unread"}
        attention={false}
        loading={false}
        onNavigate={noop}
        onClose={noop}
        onCloseOthers={noop}
        onCloseAfter={noop}
        onDelete={noop}
        {...extra}
      />
    </div>
  )

  return (
    <Switch>
      <Match when={props.surface === "tab"}>{tab({ orientation: "horizontal" })}</Match>
      <Match when={props.surface === "tab-pin-items"}>
        {tab({
          orientation: "horizontal",
          contextMenuExtra: () => <PinMenuItems pin={{ server, sessionId: props.session.id }} />,
        })}
      </Match>
      <Match when={props.surface === "tab-vertical"}>
        {tab({
          orientation: "vertical",
          contextMenuExtra: () => <PinMenuItems pin={{ server, sessionId: props.session.id }} />,
        })}
      </Match>
      <Match when={props.surface === "draft-tab"}>
        <DraftTabItem
          href="#"
          title="New session"
          onNavigate={noop}
          onClose={noop}
          onCloseOthers={noop}
          onCloseAfter={noop}
        />
      </Match>
      <Match when={props.surface === "pinned-tab"}>
        <PinnedTabStory session={props.session} />
      </Match>
      <Match when={props.surface === "recent-row" || props.surface === "recent-row-pinned"}>
        <RecentSessionTab
          item={() => ({ key: recentSessionKey(server, props.session.id), server, session: props.session })}
          selected={() => false}
          shortcut={() => undefined}
          ref={noop}
          onUnreadChange={noop}
          meta={() => undefined}
          hideAvatar={() => false}
          pinned={props.surface === "recent-row-pinned"}
          canMoveUp={() => false}
          canMoveDown={() => true}
          onOpen={noop}
          onPin={noop}
          onUnpin={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onArchive={noop}
          onDelete={noop}
        />
      </Match>
      <Match when={props.surface === "sidebar-pinned-row"}>
        <SidebarPinnedRowStory session={props.session} />
      </Match>
      <Match when={props.surface === "project-row"}>
        <ProjectSessionRow server={server} session={props.session} openTab={false} active={false} onOpen={noop} />
      </Match>
      <Match when={props.surface === "inbox-card" || props.surface === "inbox-card-archived"}>
        <InboxSessionCard
          directory={props.session.location.directory}
          title={props.session.title}
          status={props.state === "unread" ? "done" : "ready"}
          since={props.session.time.idle}
          selected={false}
          now={Date.now()}
          branch="main"
          worktree={false}
          archived={props.surface === "inbox-card-archived"}
          onOpen={noop}
          onArchive={noop}
          onUnarchive={noop}
          onDelete={noop}
          actions={
            <InboxSessionMenuItems
              server={server}
              session={props.session}
              pinned={false}
              onRename={noop}
              onTogglePin={noop}
            />
          }
        />
      </Match>
      <Match when={props.surface === "home-row"}>
        <HomeRowStory session={props.session} />
      </Match>
      <Match when={props.surface === "mention"}>
        <MentionMenu session={props.session} />
      </Match>
    </Switch>
  )
}

function PinnedTabStory(props: { session: SessionInfo }) {
  const pins = usePins()

  const pin = { server, sessionId: props.session.id }

  // Pins persist in the lab's storage, so unpin on the way out to leave the other stories unpinned.
  if (!pins.pinned(pin)) pins.pin(pin)
  onCleanup(() => pins.unpin(pin))

  return <PinnedSession pin={pin} orientation="vertical" />
}

function SidebarPinnedRowStory(props: { session: SessionInfo }) {
  const pins = createSessionPins()

  return (
    <DragDropProvider>
      <PinnedSessionRow
        item={{ key: recentSessionKey(server, props.session.id), server, session: props.session }}
        index={0}
        pins={pins}
        open
        active={false}
        shortcut={undefined}
        ref={noop}
        onUnreadChange={noop}
        onOpen={noop}
        onClose={noop}
      />
    </DragDropProvider>
  )
}

function HomeRowStory(props: { session: SessionInfo }) {
  const language = useLanguage()

  const projects = STORY_PROJECTS.map(normalizeProjectInfo)

  const records = createMemo(() =>
    buildHomeSessionRecords({
      sessions: () => [props.session],
      projectDirectories: () => undefined,
      projects: () => projects,
    }),
  )

  return (
    <div class="w-[560px]">
      <HomeSessionsView
        language={language}
        groups={groupSessions(records(), language)}
        listView={{ status: "ready", revealing: false }}
        desktop
        location={(record) => homeSessionLocation(record.session.location.directory, "main")}
        onRevealLocations={noop}
        showProjectName
        server={server}
        canCreateSession
        searchValue=""
        searchPlaceholder=""
        searchOpen={false}
        searchLoading={false}
        searchResults={[]}
        searchActive=""
        searchNoResultsLabel=""
        titleOpacity={() => 1}
        isOpenTab={() => false}
        onCreateSession={noop}
        onRetry={noop}
        onOpenSession={noop}
        onArchiveSession={async () => {}}
        onRenameSession={async () => true}
        onExportSession={noop}
        isExportingSession={() => false}
        onDeleteSession={noop}
        onSetHoverTarget={noop}
        onSetThumbTrack={noop}
        onSetContent={noop}
        onSetHeader={noop}
        onWheel={noop}
        onSetSearchRoot={noop}
        onSetSearchInput={noop}
        onSetSearchList={noop}
        onSearchFocus={noop}
        onSearchBlur={noop}
        onSearchInput={noop}
        onSearchClose={noop}
        onSearchMove={noop}
        onSearchSelectActive={noop}
        onSearchHighlight={noop}
        onSearchSelect={noop}
      />
    </div>
  )
}

function MentionMenu(props: { session: SessionInfo }) {
  const [target, setTarget] = createSignal<{ sessionID: string; x: number; y: number }>()

  onMount(() => setTimeout(() => setTarget({ sessionID: props.session.id, x: 40, y: 40 }), 400))

  return (
    <SessionReferenceMenu
      target={target()}
      currentSessionID={undefined}
      onOpenSession={noop}
      onClose={() => setTarget(undefined)}
    />
  )
}

export default {
  title: "App/Session/Session menus",
  id: "app-session-menus",
  parameters: { layout: "fullscreen" },
  args: { surface: "tab", title: "real", state: "idle" },
  argTypes: {
    surface: { control: "select", options: surfaces },
    title: { control: "select", options: ["real", "fallback"] },
    state: { control: "select", options: ["idle", "unread", "never-run"] },
  },
  render: (args: Args) => (
    <DialogStoryRuntime>
      <PinsProvider currentTab={() => undefined}>
        {/* Remounts per state so each one seeds its session and opens its menu again. */}
        <Show when={`${args.surface}:${args.title}:${args.state}`} keyed>
          <MenuStory {...args} />
        </Show>
      </PinsProvider>
    </DialogStoryRuntime>
  ),
}

export const Tab = {}

export const TabWithPinItems = { args: { surface: "tab-pin-items" } }

export const VerticalTab = { args: { surface: "tab-vertical" } }

export const DraftTab = { args: { surface: "draft-tab" } }

export const PinnedTab = { args: { surface: "pinned-tab" } }

export const RecentRow = { args: { surface: "recent-row" } }

export const RecentRowPinned = { args: { surface: "recent-row-pinned" } }

export const SidebarPinnedRow = { args: { surface: "sidebar-pinned-row" } }

export const ProjectRow = { args: { surface: "project-row" } }

export const InboxCard = { args: { surface: "inbox-card" } }

export const InboxCardArchived = { args: { surface: "inbox-card-archived" } }

export const HomeRow = { args: { surface: "home-row" } }

export const Mention = { args: { surface: "mention" } }

export const FallbackTitle = { args: { title: "fallback" } }

export const Unread = { args: { state: "unread" } }
