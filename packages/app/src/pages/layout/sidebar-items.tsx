import { A, useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject, getAvatarColors } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { base64Encode } from "@opencode-ai/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import { type Message, type Session, type TextPart, type UserMessage } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createMemo, onCleanup, type Accessor, type JSX } from "solid-js"
import { agentColor } from "@/utils/agent"
import { hasProjectPermissions } from "./helpers"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

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
  slug: string
  mobile?: boolean
  dense?: boolean
  popover?: boolean
  children: Map<string, string[]>
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
}

const SessionRow = (props: {
  session: Session
  slug: string
  mobile?: boolean
  dense?: boolean
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  sidebarOpened: Accessor<boolean>
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  scheduleHoverPrefetch: () => void
  cancelHoverPrefetch: () => void
}): JSX.Element => (
  <A
    href={`/${props.slug}/session/${props.session.id}`}
    class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none transition-[padding] ${props.mobile ? "pr-7" : ""} group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7 ${props.dense ? "py-0.5" : "py-1"}`}
    onPointerEnter={props.scheduleHoverPrefetch}
    onPointerLeave={props.cancelHoverPrefetch}
    onMouseEnter={props.scheduleHoverPrefetch}
    onMouseLeave={props.cancelHoverPrefetch}
    onFocus={() => props.prefetchSession(props.session, "high")}
    onClick={() => {
      props.setHoverSession(undefined)
      if (props.sidebarOpened()) return
      props.clearHoverProjectSoon()
    }}
  >
    <div class="flex items-center gap-1 w-full">
      <div
        class="shrink-0 size-6 flex items-center justify-center"
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
      <span class="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate">
        {props.session.title}
      </span>
      <Show when={props.session.summary}>
        {(summary) => (
          <div class="group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
            <DiffChanges changes={summary()} />
          </div>
        )}
      </Show>
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
}): JSX.Element => (
  <HoverCard
    openDelay={1000}
    closeDelay={props.sidebarHovering() ? 600 : 0}
    placement="right-start"
    gutter={16}
    shift={-2}
    trigger={props.trigger}
    mount={!props.mobile ? props.nav() : undefined}
    open={props.hoverSession() === props.session.id}
    onOpenChange={(open) => props.setHoverSession(open ? props.session.id : undefined)}
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
    const status = sessionStore.session_status[props.session.id]
    return status?.type === "busy" || status?.type === "retry"
  })

  const tint = createMemo(() => {
    const messages = sessionStore.message[props.session.id]
    if (!messages) return undefined
    let user: Message | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role !== "user") continue
      user = message
      break
    }
    if (!user?.agent) return undefined

    const agent = sessionStore.agent.find((a) => a.name === user.agent)
    return agentColor(user.agent, agent?.color)
  })

  const hoverMessages = createMemo(() =>
    sessionStore.message[props.session.id]?.filter((message): message is UserMessage => message.role === "user"),
  )
  const hoverReady = createMemo(() => sessionStore.message[props.session.id] !== undefined)
  const hoverAllowed = createMemo(() => !props.mobile && props.sidebarExpanded())
  const hoverEnabled = createMemo(() => (props.popover ?? true) && hoverAllowed())
  const isActive = createMemo(() => props.session.id === params.id)

  const hoverPrefetch = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const cancelHoverPrefetch = () => {
    if (hoverPrefetch.current === undefined) return
    clearTimeout(hoverPrefetch.current)
    hoverPrefetch.current = undefined
  }
  const scheduleHoverPrefetch = () => {
    if (hoverPrefetch.current !== undefined) return
    hoverPrefetch.current = setTimeout(() => {
      hoverPrefetch.current = undefined
      props.prefetchSession(props.session)
    }, 200)
  }

  onCleanup(cancelHoverPrefetch)

  const messageLabel = (message: Message) => {
    const parts = sessionStore.part[message.id] ?? []
    const text = parts.find((part): part is TextPart => part?.type === "text" && !part.synthetic && !part.ignored)
    return text?.text
  }
  const item = (
    <SessionRow
      session={props.session}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      tint={tint}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      setHoverSession={props.setHoverSession}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      sidebarOpened={layout.sidebar.opened}
      prefetchSession={props.prefetchSession}
      scheduleHoverPrefetch={scheduleHoverPrefetch}
      cancelHoverPrefetch={cancelHoverPrefetch}
    />
  )

  return (
    <div
      data-session-id={props.session.id}
      class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3
             hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
    >
      <Show
        when={hoverEnabled()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={10}>
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
            if (!isActive()) {
              layout.pendingMessage.set(`${base64Encode(props.session.directory)}/${props.session.id}`, message.id)
              navigate(`${props.slug}/session/${props.session.id}`)
              return
            }
            window.history.replaceState(null, "", `#message-${message.id}`)
            window.dispatchEvent(new HashChangeEvent("hashchange"))
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
          <Icon name="plus-small" size="small" class="text-icon-weak" />
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
