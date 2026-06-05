import { For, Match, Show, Switch, createMemo, createSignal, onCleanup } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Avatar as AvatarV2 } from "@opencode-ai/ui/v2/avatar-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { getAvatarColors, useLayout, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { useServerSync } from "@/context/server-sync"
import { displayName, getProjectAvatarSource, hasProjectPermissions } from "@/pages/layout/helpers"
import { isProjectBottomBarActive, projectBottomBarHref } from "./session-mobile-bottom-bar-helpers"

export type SessionMobileTab = "session" | "changes"

/**
 * Floating, Telegram-style bottom navigation shown only below `md`. It gives
 * mobile users a way to jump home and switch between open projects (deep-linking
 * into each project's session list). Desktop is unaffected
 * because the whole bar is gated with `md:hidden`.
 */
export function SessionMobileBottomBar(props: {
  activeDirectory?: string
}) {
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()

  const projects = createMemo(() => layout.projects.list())

  // Deep-link into the project's session list (the addressable Home route),
  // NOT a brand-new session. Mark the project open/recent first so it stays in sync.
  function openProject(project: LocalProject) {
    const root = project.worktree
    layout.projects.open(root)
    layout.projects.touch(root)
    navigate(projectBottomBarHref(project))
  }

  return (
    <div class="md:hidden shrink-0 flex justify-center px-3 pt-1.5 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <nav
        class="flex w-full max-w-md items-center gap-2 rounded-[14px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 py-2 shadow-[var(--v2-elevation-overlay)]"
        aria-label={language.t("home.projects")}
      >
        <a
          href="/"
          class="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-v2-icon-icon-muted transition-colors duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none active:bg-v2-overlay-simple-overlay-pressed [&_[data-slot=icon-svg]]:size-5"
          aria-label={language.t("home.title")}
        >
          <IconV2 name="grid-plus" />
        </a>

        <Show when={projects().length > 0}>
          <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <For each={projects()}>
              {(project, index) => (
                <ProjectBarTile
                  project={project}
                  index={index()}
                  total={projects().length}
                  activeDirectory={props.activeDirectory}
                  openProject={openProject}
                />
              )}
            </For>
          </div>
        </Show>

      </nav>
    </div>
  )
}

function ProjectBarTile(props: {
  project: LocalProject
  index: number
  total: number
  activeDirectory?: string
  openProject: (project: LocalProject) => void
}) {
  const layout = useLayout()
  const language = useLanguage()
  const serverSync = useServerSync()
  const notification = useNotification()
  const permission = usePermission()
  const [menuOpen, setMenuOpen] = createSignal(false)

  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  let suppressNextClick = false
  let startX = 0
  let startY = 0
  let triggerRef!: HTMLButtonElement

  const directories = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  // Match the active directory against the project's full directory set
  // (worktree + sandboxes) so sessions running in a sandbox subdir still
  // highlight their owning project, mirroring home.tsx's `directories()`.
  const selected = createMemo(() => isProjectBottomBarActive(props.activeDirectory, props.project))
  const unseenCount = createMemo(() =>
    directories().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => directories().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    directories().some((directory) => {
      const [store] = serverSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const isWorking = createMemo(() =>
    !hasPermissions() &&
    directories().some((directory) => {
      const [store] = serverSync.child(directory, { bootstrap: false })
      return Object.keys(store.session_status).some((id) => store.session_working(id))
    }),
  )

  const moveProject = (offset: -1 | 1) => layout.projects.move(props.project.worktree, props.index + offset)
  const clearLongPress = () => {
    if (!longPressTimer) return
    clearTimeout(longPressTimer)
    longPressTimer = undefined
  }
  const startLongPress = (event: PointerEvent) => {
    suppressNextClick = false
    if (event.button !== 0 || event.pointerType === "mouse") return
    startX = event.clientX
    startY = event.clientY
    clearLongPress()
    longPressTimer = setTimeout(() => {
      suppressNextClick = true
      triggerRef.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY: startY,
        }),
      )
    }, 500)
  }
  const cancelLongPressOnMove = (event: PointerEvent) => {
    if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) clearLongPress()
  }

  onCleanup(clearLongPress)

  return (
    <ContextMenu onOpenChange={setMenuOpen} modal={false}>
      <ContextMenu.Trigger
        ref={triggerRef}
        as="button"
        type="button"
        class="relative flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-[background-color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none active:bg-v2-overlay-simple-overlay-pressed"
        classList={{
          "bg-v2-overlay-simple-overlay-hover shadow-[inset_0_0_0_1px_var(--v2-border-border-focus)]": selected() || menuOpen(),
        }}
        aria-current={selected() ? "page" : undefined}
        aria-label={displayName(props.project)}
        title={displayName(props.project)}
        onPointerDown={startLongPress}
        onPointerMove={cancelLongPressOnMove}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onClick={(event: MouseEvent) => {
          if (suppressNextClick) {
            suppressNextClick = false
            event.preventDefault()
            return
          }
          props.openProject(props.project)
        }}
      >
        <AvatarV2
          fallback={displayName(props.project)}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          kind="org"
          size="small"
          {...getAvatarColors(props.project.icon?.color)}
          class="size-7 rounded-[8px]"
        />
        <ProjectBarStatus
          hasPermissions={hasPermissions()}
          isWorking={isWorking()}
          hasError={hasError()}
          unseenCount={unseenCount()}
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item disabled={props.index === 0} onSelect={() => moveProject(-1)}>
            <ContextMenu.ItemLabel>{language.t("common.moveLeft")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item disabled={props.index >= props.total - 1} onSelect={() => moveProject(1)}>
            <ContextMenu.ItemLabel>{language.t("common.moveRight")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => layout.projects.close(props.project.worktree)}>
            <ContextMenu.ItemLabel>{language.t("common.close")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

function ProjectBarStatus(props: { hasPermissions: boolean; isWorking: boolean; hasError: boolean; unseenCount: number }) {
  return (
    <Show when={props.hasPermissions || props.isWorking || props.hasError || props.unseenCount > 0}>
      <span class="absolute -right-0.5 -top-0.5 z-10 flex min-h-3 min-w-3 items-center justify-center rounded-full bg-v2-background-bg-deep p-px">
        <Switch>
          <Match when={props.hasPermissions}>
            <span class="size-2 rounded-full bg-surface-warning-strong" />
          </Match>
          <Match when={props.isWorking}>
            <Spinner class="size-3" />
          </Match>
          <Match when={props.hasError}>
            <span class="size-2 rounded-full bg-text-diff-delete-base" />
          </Match>
          <Match when={props.unseenCount > 0}>
            <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-text-interactive-base px-1 text-[9px] leading-none text-text-on-interactive-base [font-weight:650]">
              {Math.min(props.unseenCount, 99)}
            </span>
          </Match>
        </Switch>
      </span>
    </Show>
  )
}

export function SessionMobileTabToggle(props: {
  tab: SessionMobileTab
  changesLabel: string
  onTabChange: (tab: SessionMobileTab) => void
}) {
  const language = useLanguage()

  return (
    <div class="grid w-full min-w-0 max-w-full grid-cols-2 items-center gap-1 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-raised)]">
      <MobileTabToggleButton
        label={language.t("session.tab.session")}
        selected={props.tab === "session"}
        onClick={() => props.onTabChange("session")}
      />
      <MobileTabToggleButton
        label={props.changesLabel}
        selected={props.tab === "changes"}
        onClick={() => props.onTabChange("changes")}
      />
    </div>
  )
}

function MobileTabToggleButton(props: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-8 min-w-0 items-center justify-center rounded-[7px] px-2 text-v2-text-text-muted transition-colors duration-[120ms] ease-in-out focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--v2-border-border-focus)] [font-weight:530]"
      classList={{
        "bg-v2-background-bg-deep text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.selected,
      }}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span class="block min-w-0 max-w-full truncate whitespace-nowrap">{props.label}</span>
    </button>
  )
}
