import { Popover } from "@kobalte/core/popover"
import { For, Show, splitProps, type Accessor, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { getProjectAvatarVariant } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export type PromptProject = {
  name?: string
  id?: string
  worktree: string
  sandboxes?: string[]
  icon?: { color?: string; url?: string; override?: string }
  server?: { key: string; name: string }
}

export type PromptProjectControls = {
  available: PromptProject[]
  directory: string
  server?: string
  select: (worktree: string, server?: string) => void
  add: (title: string, server?: string) => void
}

export function createPromptProjectController(input: {
  controls: Accessor<PromptProjectControls>
  onDone: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "" })
  let searchRef: HTMLInputElement | undefined

  const selected = () => {
    const key = pathKey(input.controls().directory)
    return input
      .controls()
      .available.find(
        (project) =>
          (!project.server || project.server.key === input.controls().server) &&
          (pathKey(project.worktree) === key || project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)),
      )
  }
  const projects = () => {
    const search = store.search.trim().toLowerCase()
    if (!search) return input.controls().available
    return input.controls().available.filter((project) => displayName(project).toLowerCase().includes(search))
  }
  const servers = () =>
    input
      .controls()
      .available.map((project) => project.server)
      .filter((server, index, all) => server && all.findIndex((item) => item?.key === server.key) === index)
  const close = () => {
    setStore({ open: false, search: "" })
    input.onDone()
  }
  const select = (project: PromptProject) => {
    if (
      pathKey(project.worktree) !== pathKey(selected()?.worktree ?? "") ||
      project.server?.key !== selected()?.server?.key
    ) {
      input.controls().select(project.worktree, project.server?.key)
    }
    close()
  }
  const add = (server?: string) => {
    setStore("open", false)
    input.controls().add(language.t("command.project.open"), server)
  }

  return {
    selected,
    projects,
    servers,
    open: () => store.open,
    search: () => store.search,
    labels: {
      add: () => language.t("session.new.project.add"),
      clear: () => language.t("common.clear"),
      new: () => language.t("session.new.project.new"),
      search: () => language.t("session.new.project.search"),
    },
    add,
    select,
    setOpen(open: boolean) {
      setStore("open", open)
      if (open) requestAnimationFrame(() => searchRef?.focus())
    },
    setSearch(value: string) {
      setStore("search", value)
    },
    setSearchRef(el: HTMLInputElement) {
      searchRef = el
    },
  }
}

export type PromptProjectController = ReturnType<typeof createPromptProjectController>

export function PromptProjectSelector(props: { controller: PromptProjectController }) {
  return (
    <Popover
      open={props.controller.open()}
      placement="bottom-start"
      gutter={4}
      modal={false}
      onOpenChange={(open) => props.controller.setOpen(open)}
    >
      <Popover.Trigger as={ProjectTrigger} controller={props.controller} />
      <Popover.Portal>
        <Popover.Content
          class="w-[243px] overflow-hidden rounded-md bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] focus:outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded px-3 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(el) => props.controller.setSearchRef(el)}
                value={props.controller.search()}
                placeholder={props.controller.labels.search()}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(event) => props.controller.setSearch(event.currentTarget.value)}
              />
              <Show when={props.controller.search().trim()}>
                <button
                  type="button"
                  class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => props.controller.setSearch("")}
                  aria-label={props.controller.labels.clear()}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </Show>
            </div>
            <Show
              when={props.controller.servers().length > 1}
              fallback={
                <For each={props.controller.projects()}>
                  {(project) => (
                    <ProjectItem
                      project={project}
                      selected={props.controller.selected()}
                      onSelect={props.controller.select}
                    />
                  )}
                </For>
              }
            >
              <For each={props.controller.servers()}>
                {(server) => (
                  <div>
                    <div class="flex h-7 select-none items-center pl-1.5 pr-3 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-faint">
                      {server!.name}
                    </div>
                    <For each={props.controller.projects().filter((project) => project.server?.key === server!.key)}>
                      {(project) => (
                        <ProjectItem
                          project={project}
                          selected={props.controller.selected()}
                          onSelect={props.controller.select}
                        />
                      )}
                    </For>
                    <ProjectAction
                      label={props.controller.labels.add()}
                      onSelect={() => props.controller.add(server!.key)}
                    />
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={props.controller.servers().length <= 1}>
            <div class="h-px bg-v2-border-border-muted" />
            <div class="flex flex-col p-0.5">
              <ProjectAction
                label={props.controller.labels.add()}
                onSelect={() => props.controller.add(props.controller.servers()[0]?.key)}
              />
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

export function PromptProjectAddButton(props: { controller: PromptProjectController }) {
  return (
    <button
      data-action="prompt-project"
      type="button"
      class="flex h-7 min-w-0 max-w-[160px] items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={() => props.controller.add()}
    >
      <Icon name="folder-add-left" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate leading-5">{props.controller.labels.new()}</span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
    </button>
  )
}

function ProjectTrigger(props: ComponentProps<"button"> & { controller: PromptProjectController }) {
  const [local, rest] = splitProps(props, ["controller", "class", "onClick"])
  const project = () => local.controller.selected()
  return (
    <button
      {...rest}
      data-action="prompt-project"
      type="button"
      class="flex h-7 min-w-0 max-w-[203px] items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={() => local.controller.setOpen(true)}
    >
      <Show
        when={project()}
        fallback={<Icon name="folder-add-left" size="small" class="shrink-0 text-v2-icon-icon-muted" />}
      >
        {(item) => (
          <ProjectAvatar
            fallback={displayName(item())}
            src={getProjectAvatarSource(item().id, item().icon)}
            variant={getProjectAvatarVariant(item().icon?.color)}
          />
        )}
      </Show>
      <span class="min-w-0 truncate leading-5">
        {project() ? displayName(project()!) : local.controller.labels.new()}
      </span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
    </button>
  )
}

function ProjectItem(props: {
  project: PromptProject
  selected?: PromptProject
  onSelect: (project: PromptProject) => void
}) {
  return (
    <button
      type="button"
      class="flex h-7 w-full items-center gap-2 rounded-sm px-3 text-left text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={() => props.onSelect(props.project)}
    >
      <ProjectAvatar
        fallback={displayName(props.project)}
        src={getProjectAvatarSource(props.project.id, props.project.icon)}
        variant={getProjectAvatarVariant(props.project.icon?.color)}
      />
      <span class="min-w-0 flex-1 truncate leading-5">{displayName(props.project)}</span>
      <Show
        when={
          props.selected?.worktree === props.project.worktree &&
          props.selected?.server?.key === props.project.server?.key
        }
      >
        <Icon name="check-small" size="small" class="shrink-0 text-v2-icon-icon-base" />
      </Show>
    </button>
  )
}

function ProjectAction(props: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      class="flex h-7 w-full items-center gap-2 rounded-sm px-3 text-left text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={props.onSelect}
    >
      <Icon name="plus" size="small" />
      <span class="min-w-0 flex-1 truncate leading-5">{props.label}</span>
    </button>
  )
}
