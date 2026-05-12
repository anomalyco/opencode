import type { Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { A, useParams } from "@solidjs/router"
import { type Accessor, createMemo, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { working } from "../session/session-working"
import { hasProjectPermissions, workspaceKey } from "./helpers"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element | null => {
  if (!props.project?.worktree) return null
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const loaded = createMemo(() => dirs().some((directory) => globalSync.loaded(directory)))
  const loadingSessions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return store.sessions === "loading"
    }),
  )
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.session, store.permission, directory, (item) => {
        return !permission.autoResponds(item, directory)
      })
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))

  return (
    <div
      data-loaded={loaded() ? "true" : "false"}
      data-component={loadingSessions() ? "project-icon-loading" : undefined}
      class={`relative size-8 shrink-0 rounded overflow-hidden ${props.class ?? ""}`}
    >
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={
            loaded() && props.project.id === OPENCODE_PROJECT_ID
              ? "https://opencode.ai/favicon.svg"
              : loaded()
                ? props.project.icon?.override
                : undefined
          }
          {...(loaded()
            ? getAvatarColors(props.project.icon?.color)
            : {
                background: "var(--color-surface-base-hover)",
                foreground: "var(--color-text-weak)",
              })}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={loadingSessions()}>
        <div data-slot="sheen" class="pointer-events-none absolute inset-0 z-[5]" />
      </Show>
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
      <Show when={props.working}>
        <div class="absolute bottom-px right-px size-3 rounded-full bg-background-base z-10 flex items-center justify-center">
          <Spinner class="size-[9px]" />
        </div>
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  slug: string
  root?: string
  mobile?: boolean
  dense?: boolean
  reduced?: boolean
  sidebarExpanded: Accessor<boolean>
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  generateSessionTitle: (session: Session) => Promise<void>
}

const SessionRow = (props: {
  session: Session
  mobile?: boolean
  dense?: boolean
  active?: boolean
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  sidebarOpened: Accessor<boolean>
  warmPress: () => void
  warmFocus: () => void
  cancelHoverPrefetch: () => void
  detail?: Accessor<boolean | undefined>
  reduced?: boolean
}): JSX.Element => (
  <A
    href={`/${base64Encode(props.session.directory)}/session/${props.session.id}`}
    class={`flex items-center gap-1 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
    onPointerDown={props.warmPress}
    onFocus={props.warmFocus}
    onClick={() => {
      if (props.sidebarOpened()) return
    }}
  >
    <div class="flex items-center gap-1 w-full">
      <Show when={props.isWorking() || props.hasPermissions() || props.hasError() || props.unseenCount() > 0}>
        <div
          class="shrink-0 size-6 flex items-center justify-center"
          style={{
            color: props.active ? "var(--sidebar-session-accent)" : (props.tint() ?? "var(--icon-interactive-base)"),
          }}
        >
          <Switch>
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
      </Show>
      <span
        classList={{
          "text-16-medium grow-1 min-w-0 overflow-hidden text-ellipsis truncate": true,
          "transition-colors": !props.reduced,
          "text-text-base": !props.active,
        }}
        style={props.active ? { color: "var(--sidebar-session-accent)" } : undefined}
      >
        {props.session.title}
      </span>
    </div>
  </A>
)

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
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
    return working(status, sessionStore.message[props.session.id])
  })
  const isActive = createMemo(() => props.session.id === params.id)
  const detail = createMemo(() => {
    if (!props.root) return
    return workspaceKey(props.session.directory) !== workspaceKey(props.root)
  })

  const tint = createMemo(() => messageAgentColor(sessionStore.message[props.session.id], sessionStore.agent))
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore.session, props.session.id, params.id)
  })

  const hoverAllowed = createMemo(() => !props.mobile && props.sidebarExpanded())
  const hoverEnabled = createMemo(() => hoverAllowed())
  const tooltip = createMemo(() => !props.reduced && (props.mobile || !props.sidebarExpanded()))
  const copy = () => {
    const text = `Session ID: ${props.session.id}\nProject path: ${props.session.directory}`
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard
    console.debug("[sidebar-session] copy info", { id: props.session.id, dir: props.session.directory })
    if (!clip?.writeText) {
      console.debug("[sidebar-session] clipboard unavailable", { id: props.session.id })
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: "Clipboard unavailable",
      })
      return
    }
    void clip.writeText(text).then(
      () => {
        console.debug("[sidebar-session] copied info", { id: props.session.id, dir: props.session.directory })
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: text,
        })
      },
      (err: unknown) => {
        console.debug("[sidebar-session] copy failed", { id: props.session.id, err })
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      },
    )
  }

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
  const item = (
    <SessionRow
      session={props.session}
      mobile={props.mobile}
      dense={props.dense}
      active={isActive()}
      tint={tint}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      sidebarOpened={layout.sidebar.opened}
      warmHover={() => undefined}
      warmPress={() => warm(2, "high")}
      warmFocus={() => warm(2, "high")}
      cancelHoverPrefetch={cancelHoverPrefetch}
      detail={detail}
      reduced={props.reduced}
    />
  )

  return (
    <div
      data-session-id={props.session.id}
      data-component="sidebar-session"
      data-active={isActive() ? "true" : "false"}
      classList={{
        "group/session relative flex items-center w-full min-w-0 rounded-[22px] cursor-default pl-2 pr-3 border border-transparent": true,
        "transition-[background-color,border-color,box-shadow]": !props.reduced,
      }}
    >
      <div class="min-w-0 grow">
        <Show
          when={!tooltip()}
          fallback={
            <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={10}>
              {item}
            </Tooltip>
          }
        >
          {item}
        </Show>
      </div>

      <div class="shrink-0 flex items-center gap-1">
        <div
          class="overflow-hidden flex items-center gap-1"
          classList={{
            "transition-[width,opacity]": !props.reduced,
            "w-[52px] opacity-100 pointer-events-auto": !!props.mobile,
            "w-0 opacity-0 pointer-events-none": !props.mobile || !!props.reduced,
            "group-hover/session:w-[52px] group-hover/session:opacity-100 group-hover/session:pointer-events-auto":
              !props.reduced,
            "group-focus-within/session:w-[52px] group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto":
              !props.reduced,
          }}
        >
          <Show
            when={!props.reduced}
            fallback={
              <>
                <IconButton
                  icon="copy"
                  variant="ghost"
                  class="size-6 rounded-md shrink-0"
                  aria-label={language.t("session.copyInfo")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    copy()
                  }}
                />
                <IconButton
                  icon="archive"
                  variant="ghost"
                  class="size-6 rounded-md shrink-0"
                  aria-label={language.t("common.archive")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void props.archiveSession(props.session)
                  }}
                />
              </>
            }
          >
            <>
              <Tooltip value={language.t("session.copyInfo")} placement="top">
                <IconButton
                  icon="copy"
                  variant="ghost"
                  class="size-6 rounded-md shrink-0"
                  aria-label={language.t("session.copyInfo")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    copy()
                  }}
                />
              </Tooltip>
              <Tooltip value={language.t("common.archive")} placement="top">
                <IconButton
                  icon="archive"
                  variant="ghost"
                  class="size-6 rounded-md shrink-0"
                  aria-label={language.t("common.archive")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void props.archiveSession(props.session)
                  }}
                />
              </Tooltip>
            </>
          </Show>
        </div>
        <Show when={detail()}>
          <div class="shrink-0 size-6 flex items-center justify-center">
            <Icon name="branch" size="normal" class="text-icon-success-base" />
          </div>
        </Show>
      </div>
      <Show when={currentChild()} keyed>
        {(child) => (
          <div class="w-full">
            <SessionItem {...props} session={child} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  reduced?: boolean
  sidebarExpanded: Accessor<boolean>
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        if (layout.sidebar.opened()) return
      }}
    >
      <div class="flex items-center gap-1 w-full">
        <div class="shrink-0 size-6 flex items-center justify-center">
          <Icon
            name="plus"
            size="small"
            classList={{ "text-icon-weak": true, "group-hover/session:text-icon-base": !props.reduced }}
          />
        </div>
        <span
          classList={{
            "text-14-regular text-text-weak grow-1 min-w-0 overflow-hidden text-ellipsis truncate": true,
            "group-hover/session:text-text-strong transition-colors": !props.reduced,
          }}
        >
          {label}
        </span>
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div
      classList={{
        "group/session relative w-full min-w-0 rounded-lg cursor-default pl-2 pr-3": true,
        "transition-colors hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover":
          !props.reduced,
      }}
    >
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
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
        {() => <div class="h-8 w-full rounded-lg bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}

export const SessionGroupHeader = (props: { label: string }): JSX.Element => (
  <div class="px-4 pt-3 pb-1 first:pt-1 flex justify-end">
    <span class="text-[11px] font-medium uppercase tracking-wider text-text-weak opacity-60">
      {props.label}
    </span>
  </div>
)

export const SessionSearchBar = (props: {
  value: Accessor<string>
  onInput: (value: string) => void
  placeholder: string
  reduced?: boolean
}): JSX.Element => (
  <div class="px-3 py-2">
    <div
      classList={{
        "flex items-center gap-2 px-2.5 h-8 rounded-lg border border-transparent": true,
        "transition-colors focus-within:bg-surface-base focus-within:border-border-weak-base": !props.reduced,
      }}
    >
      <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
      <input
        type="text"
        value={props.value()}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="flex-1 bg-transparent outline-none text-text-base placeholder:text-text-weak"
        style={{ "font-size": "13px" }}
      />
      <Show when={props.value()}>
        <IconButton
          icon="close-small"
          variant="ghost"
          class="size-5 rounded"
          onClick={() => props.onInput("")}
        />
      </Show>
    </div>
  </div>
)
