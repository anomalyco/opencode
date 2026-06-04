import { For, Show, createMemo } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Avatar as AvatarV2 } from "@opencode-ai/ui/v2/avatar-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { getAvatarColors, useLayout, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
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
  const server = useServer()
  const navigate = useNavigate()

  const projects = createMemo(() => layout.projects.list())

  // Deep-link into the project's session list (the addressable Home route),
  // NOT a brand-new session. Mark the project open/recent first so it stays in sync.
  function openProject(project: LocalProject) {
    const root = project.worktree
    layout.projects.open(root)
    server.projects.touch(root)
    navigate(projectBottomBarHref(project))
  }

  return (
    <div class="md:hidden shrink-0 flex justify-center px-3 pt-1.5 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <nav
        class="flex w-full max-w-md items-center gap-2 rounded-full border border-v2-border-border-base bg-v2-background-bg-deep px-2 py-2 shadow-[var(--v2-elevation-overlay)]"
        aria-label={language.t("home.projects")}
      >
        <a
          href="/"
          class="flex size-10 shrink-0 items-center justify-center rounded-full text-v2-icon-icon-muted transition-colors duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none active:bg-v2-overlay-simple-overlay-pressed [&_[data-slot=icon-svg]]:size-5"
          aria-label={language.t("home.title")}
        >
          <IconV2 name="grid-plus" />
        </a>

        <Show when={projects().length > 0}>
          <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <For each={projects()}>
              {(project) => {
                // Match the active directory against the project's full directory set
                // (worktree + sandboxes) so sessions running in a sandbox subdir still
                // highlight their owning project, mirroring home.tsx's `directories()`.
                const selected = createMemo(() => {
                  return isProjectBottomBarActive(props.activeDirectory, project)
                })
                return (
                  <button
                    type="button"
                    class="flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none active:bg-v2-overlay-simple-overlay-pressed"
                    classList={{
                      "bg-v2-overlay-simple-overlay-hover shadow-[0_0_0_1px_var(--v2-border-border-focus)]": selected(),
                    }}
                    aria-current={selected() ? "page" : undefined}
                    aria-label={displayName(project)}
                    title={displayName(project)}
                    onClick={() => openProject(project)}
                  >
                    <AvatarV2
                      fallback={displayName(project)}
                      src={getProjectAvatarSource(project.id, project.icon)}
                      kind="org"
                      size="small"
                      {...getAvatarColors(project.icon?.color)}
                      class="size-7 rounded-full"
                    />
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

      </nav>
    </div>
  )
}

export function SessionMobileTabToggle(props: {
  tab: SessionMobileTab
  changesLabel: string
  onTabChange: (tab: SessionMobileTab) => void
}) {
  const language = useLanguage()

  return (
    <div class="flex min-w-0 max-w-full shrink items-center rounded-full bg-v2-background-bg-base p-0.5 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]">
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
      class="flex h-9 min-w-0 items-center justify-center rounded-[8px] px-3 text-v2-text-text-muted transition-colors duration-[120ms] ease-in-out focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--v2-border-border-focus)] [font-weight:530]"
      classList={{
        "bg-v2-background-bg-deep text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.selected,
      }}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span class="truncate whitespace-nowrap">{props.label}</span>
    </button>
  )
}
