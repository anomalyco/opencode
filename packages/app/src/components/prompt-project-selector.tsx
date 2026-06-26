import { For, Show, splitProps, type Accessor, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
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

const actionPrefix = "action:"
const projectPrefix = "project:"

function projectKey(project: PromptProject) {
  return `${projectPrefix}${encodeURIComponent(project.server?.key ?? "")}:${encodeURIComponent(project.worktree)}`
}

function actionKey(server?: string) {
  return `${actionPrefix}${encodeURIComponent(server ?? "")}`
}

export function createPromptProjectController(input: {
  controls: Accessor<PromptProjectControls>
  onDone: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
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
  const keys = () => {
    if (servers().length <= 1) {
      return [...projects().map(projectKey), actionKey(servers()[0]?.key)]
    }
    return servers().flatMap((server) => [
      ...projects()
        .filter((project) => project.server?.key === server!.key)
        .map(projectKey),
      actionKey(server!.key),
    ])
  }
  const initialActive = () => {
    const selectedKey = selected() ? projectKey(selected()!) : undefined
    const options = keys()
    if (selectedKey && options.includes(selectedKey)) return selectedKey
    return options[0] ?? ""
  }
  const close = () => {
    setStore({ open: false, search: "", active: "" })
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
    setStore({ open: false, search: "", active: "" })
    input.controls().add(language.t("command.project.open"), server)
  }

  return {
    selected,
    projects,
    servers,
    projectKey,
    actionKey,
    open: () => store.open,
    search: () => store.search,
    active: () => store.active,
    labels: {
      add: () => language.t("session.new.project.add"),
      clear: () => language.t("common.clear"),
      new: () => language.t("session.new.project.new"),
      search: () => language.t("session.new.project.search"),
    },
    add,
    select,
    setOpen(open: boolean) {
      if (open) {
        setStore({ open: true, active: initialActive() })
        setTimeout(() => requestAnimationFrame(() => searchRef?.focus()))
        return
      }
      setStore({ open: false, search: "", active: "" })
    },
    setSearch(value: string) {
      const search = value.trim().toLowerCase()
      const first = input
        .controls()
        .available.find((project) => !search || displayName(project).toLowerCase().includes(search))
      setStore({ search: value, active: first ? projectKey(first) : actionKey(servers()[0]?.key) })
    },
    clearSearch() {
      setStore({ search: "", active: initialActive() })
      setTimeout(() => searchRef?.focus())
    },
    setActive(key: string) {
      setStore("active", key)
    },
    moveActive(delta: number) {
      const options = keys()
      if (options.length === 0) return
      const index = options.indexOf(store.active)
      const start = index === -1 ? 0 : index
      setStore("active", options[(start + delta + options.length) % options.length])
    },
    activeProject() {
      return store.active.startsWith(projectPrefix)
        ? projects().find((project) => projectKey(project) === store.active)
        : undefined
    },
    activeServer() {
      return store.active.startsWith(actionPrefix)
        ? decodeURIComponent(store.active.slice(actionPrefix.length)) || undefined
        : undefined
    },
    setSearchRef(el: HTMLInputElement) {
      searchRef = el
    },
    focusSearch() {
      setTimeout(() => requestAnimationFrame(() => searchRef?.focus()))
    },
  }
}

export type PromptProjectController = ReturnType<typeof createPromptProjectController>

export function PromptProjectSelector(props: { controller: PromptProjectController }) {
  let contentRef: HTMLDivElement | undefined
  let restoreTrigger = true

  const activeItem = () =>
    props.controller.active()
      ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(props.controller.active())}"]`)
      : undefined
  const afterClose = (callback: () => void) => {
    const complete = () => {
      if (contentRef?.isConnected) {
        requestAnimationFrame(complete)
        return
      }
      requestAnimationFrame(() => requestAnimationFrame(callback))
    }
    requestAnimationFrame(complete)
  }
  const selectProject = (project: PromptProject) => {
    restoreTrigger = false
    props.controller.setOpen(false)
    afterClose(() => props.controller.select(project))
  }
  const selectAction = (server?: string) => {
    restoreTrigger = false
    props.controller.setOpen(false)
    afterClose(() => props.controller.add(server))
  }
  const selectActive = () => {
    const project = props.controller.activeProject()
    if (project) {
      selectProject(project)
      return
    }
    selectAction(props.controller.activeServer())
  }
  const moveActive = (delta: number) => {
    props.controller.moveActive(delta)
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const focusPreviousControl = () => {
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
      .filter((element) => !contentRef?.contains(element) && !element.hasAttribute("data-focus-trap"))
      .findLast((element) => element.offsetParent !== null)
    restoreTrigger = false
    target?.focus()
    queueMicrotask(() => {
      if (props.controller.open()) props.controller.setOpen(false)
    })
  }
  const selectedValue = () => {
    const project = props.controller.selected()
    return project ? props.controller.projectKey(project) : undefined
  }

  return (
    <DropdownMenu
      open={props.controller.open()}
      placement="bottom-start"
      gutter={4}
      shift={-6}
      modal={false}
      onOpenChange={(open) => props.controller.setOpen(open)}
    >
      <DropdownMenu.Trigger as={ProjectTrigger} controller={props.controller} />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={contentRef}
          id="prompt-project-menu"
          class="w-[243px] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none [&[data-closed]]:!animate-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={() => (restoreTrigger = false)}
          onFocusOutside={() => (restoreTrigger = false)}
          onCloseAutoFocus={(event) => {
            if (!restoreTrigger) event.preventDefault()
          }}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-2.5 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(el) => props.controller.setSearchRef(el)}
                value={props.controller.search()}
                placeholder={props.controller.labels.search()}
                aria-autocomplete="list"
                aria-controls="prompt-project-menu"
                aria-activedescendant={props.controller.active() || undefined}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(event) => props.controller.setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") {
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.shiftKey) {
                      focusPreviousControl()
                      return
                    }
                    activeItem()?.focus()
                    return
                  }
                  event.stopPropagation()
                  if (event.key === "Escape") {
                    event.preventDefault()
                    props.controller.setOpen(false)
                    return
                  }
                  if (event.altKey || event.metaKey) return
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)
                    return
                  }
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    selectActive()
                  }
                }}
              />
              <Show when={props.controller.search().trim()}>
                <button
                  type="button"
                  class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => props.controller.clearSearch()}
                  aria-label={props.controller.labels.clear()}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </Show>
            </div>
            <Show
              when={props.controller.servers().length > 1}
              fallback={
                <DropdownMenu.RadioGroup value={selectedValue()}>
                  <For each={props.controller.projects()}>
                    {(project) => (
                      <ProjectItem project={project} controller={props.controller} onSelect={selectProject} />
                    )}
                  </For>
                </DropdownMenu.RadioGroup>
              }
            >
              <For each={props.controller.servers()}>
                {(server) => (
                  <div>
                    <div class="flex h-7 select-none items-center pl-1.5 pr-3 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-faint">
                      {server!.name}
                    </div>
                    <DropdownMenu.RadioGroup value={selectedValue()}>
                      <For each={props.controller.projects().filter((project) => project.server?.key === server!.key)}>
                        {(project) => (
                          <ProjectItem project={project} controller={props.controller} onSelect={selectProject} />
                        )}
                      </For>
                    </DropdownMenu.RadioGroup>
                    <ProjectAction server={server!.key} controller={props.controller} onSelect={selectAction} />
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={props.controller.servers().length <= 1}>
            <div class="h-px bg-v2-border-border-muted" />
            <div class="flex flex-col p-0.5">
              <ProjectAction
                server={props.controller.servers()[0]?.key}
                controller={props.controller}
                onSelect={selectAction}
              />
            </div>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
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
  const [local, rest] = splitProps(props, ["controller", "class", "classList", "onClick", "onKeyDown"])
  const project = () => local.controller.selected()
  return (
    <button
      {...rest}
      data-action="prompt-project"
      type="button"
      class="flex h-7 min-w-0 max-w-[203px] items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      classList={{
        ...local.classList,
        "hover:bg-v2-overlay-simple-overlay-hover": !local.controller.open(),
        "bg-v2-overlay-simple-overlay-pressed": local.controller.open(),
      }}
      onClick={local.onClick ?? (() => local.controller.setOpen(true))}
      onKeyDown={(event) => {
        if (!local.controller.open() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (typeof local.onKeyDown === "function") local.onKeyDown(event)
      }}
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
  controller: PromptProjectController
  onSelect: (project: PromptProject) => void
}) {
  const key = () => props.controller.projectKey(props.project)
  return (
    <DropdownMenu.RadioItem
      id={key()}
      value={key()}
      data-option-key={key()}
      class="h-7 gap-2 rounded-sm px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base data-[highlighted]:!bg-v2-overlay-simple-overlay-hover"
      classList={{ "!bg-v2-overlay-simple-overlay-hover": props.controller.active() === key() }}
      style={{
        "font-family": "var(--v2-font-family-sans)",
        "font-size": "13px",
        "font-weight": 440,
        "line-height": "20px",
        "letter-spacing": "-0.04px",
        color: "var(--v2-text-text-base)",
        padding: "0 12px",
      }}
      closeOnSelect
      onMouseEnter={() => {
        props.controller.setActive(key())
        props.controller.focusSearch()
      }}
      onSelect={() => props.onSelect(props.project)}
    >
      <ProjectAvatar
        fallback={displayName(props.project)}
        src={getProjectAvatarSource(props.project.id, props.project.icon)}
        variant={getProjectAvatarVariant(props.project.icon?.color)}
      />
      <DropdownMenu.ItemLabel class="min-w-0 truncate leading-5">{displayName(props.project)}</DropdownMenu.ItemLabel>
      <DropdownMenu.ItemIndicator style={{ width: "14px", height: "14px", right: "12px" }}>
        <IconV2 name="check" size="small" class="shrink-0 text-v2-icon-icon-base" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  )
}

function ProjectAction(props: {
  server?: string
  controller: PromptProjectController
  onSelect: (server?: string) => void
}) {
  const key = () => props.controller.actionKey(props.server)
  return (
    <DropdownMenu.Item
      id={key()}
      data-option-key={key()}
      class="h-7 gap-2 rounded-sm px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base data-[highlighted]:!bg-v2-overlay-simple-overlay-hover"
      classList={{ "!bg-v2-overlay-simple-overlay-hover": props.controller.active() === key() }}
      style={{
        "font-family": "var(--v2-font-family-sans)",
        "font-size": "13px",
        "font-weight": 440,
        "line-height": "20px",
        "letter-spacing": "-0.04px",
        color: "var(--v2-text-text-base)",
        padding: "0 12px",
      }}
      onMouseEnter={() => {
        props.controller.setActive(key())
        props.controller.focusSearch()
      }}
      onSelect={() => props.onSelect(props.server)}
    >
      <Icon name="plus" size="small" />
      <DropdownMenu.ItemLabel class="min-w-0 truncate leading-5">
        {props.controller.labels.add()}
      </DropdownMenu.ItemLabel>
    </DropdownMenu.Item>
  )
}
