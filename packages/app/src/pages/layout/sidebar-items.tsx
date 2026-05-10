import type { Message, Session, TextPart, UserMessage } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { A, useNavigate, useParams } from "@solidjs/router"
import { type Accessor, createMemo, createSignal, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { hasProjectPermissions } from "./helpers"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"
  if (icon?.override) return icon?.override
  if (icon?.color) return undefined
  return icon?.url
}

export const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element => {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={
            props.project.id === OPENCODE_PROJECT_ID ? "https://opencode.ai/favicon.svg" : props.project.icon?.override
          }
          {...getAvatarColors(props.project.icon?.color)}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  lookup?: ReadonlyMap<string, Session>
  prefixes?: ReadonlyMap<string, string>
  prefix?: string
  slug: string
  mobile?: boolean
  dense?: boolean
  popover?: boolean
  collapsible?: boolean
  children: ReadonlyMap<string, string[]>
  depth?: number
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<boolean>
}

const SessionRow = (props: {
  session: Session
  prefix?: string
  slug: string
  mobile?: boolean
  dense?: boolean
  depth?: number
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  sidebarOpened: Accessor<boolean>
  warmHover: () => void
  warmPress: () => void
  warmFocus: () => void
  cancelHoverPrefetch: () => void
}): JSX.Element => (
  <A
    href={`/${props.slug}/session/${props.session.id}`}
    class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none transition-[padding] ${props.mobile ? "pr-7" : ""} group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7 ${props.dense ? "py-0.5" : "py-1"}`}
    onPointerDown={props.warmPress}
    onPointerEnter={props.warmHover}
    onPointerLeave={props.cancelHoverPrefetch}
    onFocus={props.warmFocus}
    onClick={() => {
      props.setHoverSession(undefined)
      if (props.sidebarOpened()) return
      props.clearHoverProjectSoon()
    }}
  >
    <div class={`flex gap-1 w-full ${props.prefix ? "items-start" : "items-center"}`}>
      <div
        class={`shrink-0 size-6 flex items-center justify-center ${props.prefix ? "mt-0.5" : ""}`}
        style={{ color: props.tint() ?? "var(--icon-interactive-base)" }}
      >
        <Switch fallback={<Icon name="dash" size="small" class="text-icon-weak" />}>
          <Match when={props.isWorking()}>
            <Spinner class="size-[15px]" />
          </Match>
          <Match when={props.hasPermissions()}>
            <div class="size-1.5 rounded-full bg-surface-warning-strong" />
          </Match>
          <Match when={props.hasError()}>
            <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
          </Match>
          <Match when={props.unseenCount() > 0}>
            <div class="size-1.5 rounded-full bg-text-interactive-base" />
          </Match>
        </Switch>
      </div>
      <div class="flex flex-col grow-1 min-w-0">
        <span class="text-14-regular text-text-strong min-w-0 overflow-hidden text-ellipsis truncate">
          {props.session.title}
        </span>
        <Show when={props.prefix}>
          {(value) => (
            <span class="text-[11px] leading-4 text-text-weak truncate whitespace-nowrap">
              {value()}
            </span>
          )}
        </Show>
      </div>
    </div>
  </A>
)

const SessionHoverPreview = (props: {
  mobile?: boolean
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  session: Session
  sidebarHovering: Accessor<boolean>
  hoverReady: Accessor<boolean>
  hoverMessages: Accessor<UserMessage[] | undefined>
  language: ReturnType<typeof useLanguage>
  isActive: Accessor<boolean>
  slug: string
  setHoverSession: (id: string | undefined) => void
  messageLabel: (message: Message) => string | undefined
  onMessageSelect: (message: Message) => void
  trigger: JSX.Element
}): JSX.Element => {
  let ref: HTMLDivElement | undefined

  return (
    <HoverCard
      openDelay={1000}
      closeDelay={props.sidebarHovering() ? 600 : 0}
      placement="right-start"
      gutter={16}
      shift={-2}
      trigger={<div ref={ref}>{props.trigger}</div>}
      open={props.hoverSession() === props.session.id}
      onOpenChange={(open) => {
        if (!open) {
          props.setHoverSession(undefined)
          return
        }
        if (!ref?.matches(":hover")) return
        props.setHoverSession(props.session.id)
      }}
    >
      <Show
        when={props.hoverReady()}
        fallback={<div class="text-12-regular text-text-weak">{props.language.t("session.messages.loading")}</div>}
      >
        <div class="overflow-y-auto overflow-x-hidden max-h-72 h-full">
          <MessageNav
            messages={props.hoverMessages() ?? []}
            current={undefined}
            getLabel={props.messageLabel}
            onMessageSelect={props.onMessageSelect}
            size="normal"
            class="w-60"
          />
        </div>
      </Show>
    </HoverCard>
  )
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
  const navigate = useNavigate()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const [sessionStore] = globalSync.child(props.session.directory)
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    const pending = (sessionStore.message[props.session.id] ?? []).findLast(
      (message) =>
        message.role === "assistant" &&
        typeof (message as { time?: { completed?: unknown } }).time?.completed !== "number",
    )
    const status = sessionStore.session_status[props.session.id]
    return (
      pending !== undefined ||
      status?.type === "busy" ||
      status?.type === "retry" ||
      (status !== undefined && status.type !== "idle")
    )
  })

  const tint = createMemo(() => {
    return messageAgentColor(sessionStore.message[props.session.id], sessionStore.agent)
  })

  const hoverMessages = createMemo(() =>
    sessionStore.message[props.session.id]?.filter((message): message is UserMessage => message.role === "user"),
  )
  const hoverReady = createMemo(() => hoverMessages() !== undefined)
  const hoverAllowed = createMemo(() => !props.mobile && props.sidebarExpanded())
  const hoverEnabled = createMemo(() => (props.popover ?? true) && hoverAllowed())
  const isActive = createMemo(() => props.session.id === params.id)

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    props.prefetchSession(props.session, priority)

    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  const hoverPrefetch = {
    current: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const cancelHoverPrefetch = () => {
    if (hoverPrefetch.current === undefined) return
    clearTimeout(hoverPrefetch.current)
    hoverPrefetch.current = undefined
  }
  const scheduleHoverPrefetch = () => {
    warm(1, "high")
    if (hoverPrefetch.current !== undefined) return
    hoverPrefetch.current = setTimeout(() => {
      hoverPrefetch.current = undefined
      warm(2, "low")
    }, 80)
  }

  onCleanup(cancelHoverPrefetch)

  const messageLabel = (message: Message) => {
    const parts = sessionStore.part[message.id] ?? []
    const text = parts.find((part): part is TextPart => part?.type === "text" && !part.synthetic && !part.ignored)
    return text?.text
  }
  const prefix = createMemo(() => props.prefix ?? props.prefixes?.get(props.session.id))
  const item = (
    <SessionRow
      session={props.session}
      prefix={prefix()}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      depth={props.depth}
      tint={tint}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      setHoverSession={props.setHoverSession}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      sidebarOpened={layout.sidebar.opened}
      warmHover={scheduleHoverPrefetch}
      warmPress={() => warm(2, "high")}
      warmFocus={() => warm(2, "high")}
      cancelHoverPrefetch={cancelHoverPrefetch}
    />
  )

  const depth = () => props.depth ?? 0
  const pad = () => `${8 + depth() * 12}px`
  const childIds = createMemo(() => props.children.get(props.session.id) ?? [])
  const childSessions = createMemo(() =>
    childIds()
      .map((id) => props.lookup?.get(id) ?? sessionStore.session.find((s) => s.id === id))
      .filter((s): s is Session => s !== undefined && !s.time?.archived),
  )

  const [collapsed, setCollapsed] = createSignal(!!props.collapsible)
  const hasChildren = createMemo(() => childSessions().length > 0)
  const showToggle = createMemo(() => props.collapsible && hasChildren())

  return (
    <>
      <div
        data-session-id={props.session.id}
        class="group/session relative w-full rounded-md cursor-default pr-3 transition-colors
               hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
        style={{ "padding-left": pad() }}
      >
        <Show when={showToggle()}>
          <button
            type="button"
            aria-label={collapsed() ? language.t("common.expand") : language.t("common.collapse")}
            aria-expanded={!collapsed()}
            data-action="session-children-toggle"
            class="absolute left-1 top-0 bottom-0 flex items-center justify-center w-5 z-10 text-icon-weak hover:text-icon-base focus:outline-none"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
          >
            <Icon name={collapsed() ? "chevron-right" : "chevron-down"} size="small" />
          </button>
        </Show>

        <Show
          when={hoverEnabled()}
          fallback={
            <Tooltip
              placement={props.mobile ? "bottom" : "right"}
              value={prefix() ? `${prefix()} · ${props.session.title}` : props.session.title}
              gutter={10}
            >
              {item}
            </Tooltip>
          }
        >
          <SessionHoverPreview
            mobile={props.mobile}
            nav={props.nav}
            hoverSession={props.hoverSession}
            session={props.session}
            sidebarHovering={props.sidebarHovering}
            hoverReady={hoverReady}
            hoverMessages={hoverMessages}
            language={language}
            isActive={isActive}
            slug={props.slug}
            setHoverSession={props.setHoverSession}
            messageLabel={messageLabel}
            onMessageSelect={(message) => {
              if (!isActive())
                layout.pendingMessage.set(`${base64Encode(props.session.directory)}/${props.session.id}`, message.id)

              navigate(`${props.slug}/session/${props.session.id}#message-${message.id}`)
            }}
            trigger={item}
          />
        </Show>

        <div
          class={`absolute ${props.dense ? "top-0.5 right-0.5" : "top-1 right-1"} flex items-center gap-0.5 transition-opacity`}
          classList={{
            "opacity-100 pointer-events-auto": !!props.mobile,
            "opacity-0 pointer-events-none": !props.mobile,
            "group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
            "group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
          }}
        >
          <Tooltip value={language.t("common.archive")} placement="top">
            <IconButton
              icon="archive"
              variant="ghost"
              class="size-6 rounded-md"
              aria-label={language.t("common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void props.archiveSession(props.session)
              }}
            />
          </Tooltip>
        </div>
      </div>
      <Show when={!collapsed()}>
        <For each={childSessions()}>
          {(child) => (
            <SessionItem
              session={child}
              list={props.list}
              navList={props.navList}
              lookup={props.lookup}
              prefixes={props.prefixes}
              slug={props.slug}
              mobile={props.mobile}
              dense={props.dense}
              popover={props.popover}
              collapsible={props.collapsible}
              children={props.children}
              depth={depth() + 1}
              sidebarExpanded={props.sidebarExpanded}
              sidebarHovering={props.sidebarHovering}
              nav={props.nav}
              hoverSession={props.hoverSession}
              setHoverSession={props.setHoverSession}
              clearHoverProjectSoon={props.clearHoverProjectSoon}
              prefetchSession={props.prefetchSession}
              archiveSession={props.archiveSession}
            />
          )}
        </For>
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  setHoverSession: (id: string | undefined) => void
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        props.setHoverSession(undefined)
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="flex items-center gap-1 w-full">
        <div class="shrink-0 size-6 flex items-center justify-center">
          <Icon name="new-session" size="small" class="text-icon-weak" />
        </div>
        <span class="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate">
          {label}
        </span>
      </div>
    </A>
  )

  return (
    <div class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active">
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10}>
            {item}
          </Tooltip>
        }
      >
        {item}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
