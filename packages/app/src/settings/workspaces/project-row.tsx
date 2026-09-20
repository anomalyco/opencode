import { Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { InlineInput } from "@opencode/ui/inline-input"
import { Menu } from "@opencode/ui/menu"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { displayName, errorMessage } from "@/shell/layout/helpers"
import { fileManagerApp } from "@/home/projects/file-manager"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"

export function SettingsProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  onOpen: (project: LocalProject) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const global = useGlobal()
  const [store, setStore] = createStore({
    menu: undefined as { x: number; y: number } | undefined,
    editor: undefined as { draft: string; saving: boolean } | undefined,
  })
  let row: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined
  let outside = false
  const openMenu = (x: number, y: number) => {
    if (!row) return
    const bounds = row.getBoundingClientRect()
    setStore("menu", { x: x - bounds.left, y: y - bounds.top })
  }
  const openEditor = () => {
    setStore("editor", { draft: displayName(props.project), saving: false })
    requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }
  const closeEditor = () => {
    if (store.editor?.saving) return
    setStore("editor", undefined)
  }
  const saveEditor = async () => {
    if (!store.editor || store.editor.saving) return
    const name = store.editor.draft.trim()
    if (!name || name === displayName(props.project)) {
      closeEditor()
      requestAnimationFrame(() => button?.focus())
      return
    }
    setStore("editor", "saving", true)
    const context = global.ensureServerCtx(props.server)
    const value = name === getFilename(props.project.worktree) ? "" : name
    const saved = await (props.project.id && props.project.id !== "global"
      ? context.sdk.api.project
          .update({ projectID: props.project.id, name: value })
          .then((project) => context.sync.project.update(project))
      : Promise.resolve(context.sync.project.meta(props.project.worktree, { name: value }))
    )
      .then(() => true)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : language.t("common.requestFailed"),
        })
        return false
      })
    const restore = document.activeElement === document.body || document.activeElement === input
    if (saved) setStore("editor", undefined)
    if (!saved) setStore("editor", "saving", false)
    if (!restore) return
    requestAnimationFrame(() => (saved ? button : input)?.focus())
  }

  return (
    <div
      ref={row}
      data-component="settings-project-row"
      class="settings-project-row group"
      onContextMenu={(event) => {
        if (store.editor) return
        event.preventDefault()
        openMenu(event.clientX, event.clientY)
      }}
    >
      <Show
        when={!store.editor}
        fallback={
          <div class="settings-project-row-content">
            <ProjectRowContent project={props.project}>
              <InlineInput
                ref={input}
                aria-label={language.t("common.rename")}
                dir="auto"
                value={store.editor?.draft ?? ""}
                disabled={store.editor?.saving}
                class="settings-project-row-name w-full outline-none"
                style={{ "--inline-input-shadow": "none", "text-align": "start" }}
                onInput={(event) => setStore("editor", "draft", event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.isComposing || event.keyCode === 229) return
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveEditor()
                    return
                  }
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  closeEditor()
                  requestAnimationFrame(() => button?.focus())
                }}
                onBlur={closeEditor}
              />
            </ProjectRowContent>
          </div>
        }
      >
        <button
          ref={button}
          type="button"
          aria-label={displayName(props.project)}
          aria-haspopup="menu"
          aria-expanded={!!store.menu}
          class="settings-project-row-content"
          onClick={() => props.onOpen(props.project)}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            openMenu(bounds.left + 12, bounds.bottom)
          }}
        >
          <ProjectRowContent project={props.project}>
            <bdi class="settings-project-row-name truncate">{displayName(props.project)}</bdi>
          </ProjectRowContent>
          <Icon
            name="chevron-right"
            size="small"
            class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          />
        </button>
      </Show>
      <Menu
        modal={false}
        placement="bottom-start"
        gutter={2}
        open={!!store.menu}
        onOpenChange={(open) => {
          if (!open) setStore("menu", undefined)
        }}
      >
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          tabIndex={-1}
          class="pointer-events-none absolute size-px"
          style={{ left: `${store.menu?.x ?? 0}px`, top: `${store.menu?.y ?? 0}px` }}
        />
        <Menu.Portal>
          <Menu.Content
            onInteractOutside={() => {
              outside = true
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const restore = !outside && !store.editor
              outside = false
              if (restore) requestAnimationFrame(() => button?.focus())
            }}
          >
            <Menu.Item onSelect={openEditor}>{language.t("common.rename")}</Menu.Item>
            <Show
              when={platform.platform === "desktop" && !!platform.openPath && ServerConnection.local(props.server)}
            >
              <Menu.Item
                onSelect={() => {
                  if (!platform.openPath) return
                  void platform.openPath(props.project.worktree).catch((cause: unknown) =>
                    showToast({
                      title: language.t("common.requestFailed"),
                      description: errorMessage(cause, language.t("common.requestFailed")),
                    }),
                  )
                }}
              >
                {language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}
              </Menu.Item>
            </Show>
            <Menu.Separator />
            <Menu.Item
              onSelect={() => {
                const next = row?.nextElementSibling ?? row?.previousElementSibling
                global.ensureServerCtx(props.server).projects.close(props.project.worktree)
                requestAnimationFrame(() => next?.querySelector("button")?.focus())
              }}
            >
              {language.t("common.close")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

function ProjectRowContent(props: { project: LocalProject; children: JSX.Element }) {
  return (
    <span class="flex items-start gap-2.5 min-w-0 flex-1">
      <ProjectIcon project={props.project} class="shrink-0" />
      <span class="flex min-w-0 flex-1 flex-col gap-1.5">
        {props.children}
        <bdi
          dir="ltr"
          class="text-11-regular leading-[var(--line-height-compact)] text-v2-text-text-muted truncate"
          title={props.project.worktree}
        >
          {props.project.worktree}
        </bdi>
      </span>
    </span>
  )
}
