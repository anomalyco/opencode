import { Show, onMount } from "solid-js"
import { InlineInput } from "@opencode/ui/inline-input"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar"
import { errorMessage } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { showToast } from "@/shell/notifications/toast"
import { createInlineRename } from "@/settings/rename"
import { ProjectOptions } from "./project-options"

export function SettingsProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  onOpen: (project: LocalProject) => void
  onAdd?: () => void
  onMount?: (button: HTMLButtonElement) => void
}) {
  const language = useLanguage()
  const context = useServer().ctx

  let button: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined

  onMount(() => {
    if (button) props.onMount?.(button)
  })

  // Clicking away discards the draft, as on Home's session rows.
  const rename = createInlineRename({
    blurPolicy: "cancel",
    current: () => displayName(props.project),
    input: () => input,
    trigger: () => button,
    onSave: async (name) => {
      const value = name === getFilename(props.project.worktree) ? "" : name

      return (
        props.project.id && props.project.id !== "global"
          ? context.sdk.api.project
              .update({ projectID: props.project.id, name: value })
              .then((project) => context.sync.project.update(project))
          : Promise.resolve(context.sync.project.meta(props.project.worktree, { name: value }))
      )
        .then(() => true)
        .catch((cause: unknown) => {
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          })

          return false
        })
    },
    onTimeout: () =>
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("home.sessions.load.timeout"),
      }),
  })

  return (
    <div class="settings-project-row-shell">
      <div
        role="listitem"
        data-component="settings-project-card"
        data-menu={rename.menuOpen() ? "true" : undefined}
        class="settings-project-card"
      >
        <Show
          when={!rename.open()}
          fallback={
            <div class="flex h-full min-w-0 flex-1 items-center gap-2">
              <ProjectIcon project={props.project} class="shrink-0" />
              <InlineInput
                ref={input}
                aria-label={language.t("common.rename")}
                dir="auto"
                value={rename.draft()}
                readOnly={rename.saving()}
                aria-busy={rename.saving() || undefined}
                class="w-full text-[13px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none"
                style={{ "--inline-input-shadow": "none", "border-radius": "0", "text-align": "start" }}
                onInput={(event) => rename.input(event.currentTarget.value)}
                onKeyDown={rename.keyDown}
                onBlur={rename.blur}
              />
            </div>
          }
        >
          <button
            ref={button}
            type="button"
            aria-label={displayName(props.project)}
            title={props.project.worktree}
            class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[4px] bg-transparent text-start focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
            onClick={() => props.onOpen(props.project)}
          >
            <ProjectIcon project={props.project} class="shrink-0" />
            <bdi class="truncate text-[13px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base">
              {displayName(props.project)}
            </bdi>
          </button>
          <ProjectOptions
            server={props.server}
            project={props.project}
            open={rename.menuOpen()}
            onOpenChange={rename.setMenu}
            onEdit={() => props.onOpen(props.project)}
            onRename={() => rename.start(displayName(props.project))}
            onAdd={props.onAdd}
          />
        </Show>
      </div>
    </div>
  )
}
