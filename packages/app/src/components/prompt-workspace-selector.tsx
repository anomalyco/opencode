import { createMemo, createSignal, For, Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"
import { sameDirectory } from "@/utils/workspace"

export function PromptWorkspaceSelector(props: {
  value: string
  projectRoot: string
  workspaces: string[]
  branch?: string
  onboarding?: boolean
  onChange: (value: string) => void
  onDone: () => void
  onViewAll: () => void
}) {
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  let searchInput: HTMLInputElement | undefined
  let focusSearch = false
  let pending: { type: "select"; value: string } | { type: "viewAll" } | undefined
  const selected = () => (sameDirectory(props.value, props.projectRoot) ? "main" : props.value)
  const workspaces = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return props.workspaces
    return props.workspaces.filter((workspace) => getFilename(workspace).toLowerCase().includes(query))
  })
  const icon = () => {
    if (selected() === "main") return "monitor"
    if (selected() === "create") return "workspace-new"
    return "workspace-isolated"
  }
  const select = (value: string) => {
    pending = { type: "select", value }
  }
  const onOpenChange = (open: boolean) => {
    if (open) {
      setSearch("")
      return
    }
    const action = pending
    pending = undefined
    if (action?.type === "select") props.onChange(action.value)
    if (action?.type === "viewAll") {
      props.onViewAll()
      return
    }
    props.onDone()
  }
  const label = () => {
    if (selected() === "main") return language.t("session.new.workspace.triggerLocal")
    if (props.value === "create") return language.t("workspace.new")
    return getFilename(props.value)
  }

  return (
    <>
      <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
      <TooltipV2
        placement="top"
        openDelay={800}
        value={
          props.onboarding ? (
            <div class="flex flex-col gap-1 text-start">
              <div class="flex items-center gap-1.5 font-[530] text-v2-text-text-base">
                <Icon name="workspace-isolated" size="small" class="shrink-0 text-v2-text-text-accent" />
                <span>{language.t("workspace.onboarding.title")}</span>
              </div>
              <span class="font-[440] text-v2-text-text-muted">{language.t("workspace.onboarding.description")}</span>
            </div>
          ) : (
            language.t("session.new.workspace.trigger.tooltip")
          )
        }
        contentClass={props.onboarding ? "max-w-[280px]" : undefined}
        class="min-w-0"
      >
        <MenuV2 placement="bottom" gutter={4} onOpenChange={onOpenChange}>
          <MenuV2.Trigger
            aria-description={language.t("session.new.workspace.trigger.tooltip")}
            class="flex h-6 min-w-0 max-w-[203px] items-center gap-1.5 rounded-sm px-1.5 hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed data-[expanded]:text-v2-text-text-muted"
          >
            <Icon name={icon()} class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{label()}</span>
            <Show when={props.onboarding}>
              <span
                data-slot="workspace-onboarding-dot"
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-v2-text-text-accent"
              />
            </Show>
            <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="w-[200px]">
              <MenuV2.Group>
                <MenuV2.GroupLabel>{language.t("session.new.workspace.runIn")}</MenuV2.GroupLabel>
                <MenuV2.Item onSelect={() => select("main")}>
                  <Icon name="monitor" />
                  <TooltipV2
                    placement="right"
                    openDelay={800}
                    value={
                      <span class="flex flex-col gap-0.5">
                        <span>{language.t("session.new.workspace.local")}</span>
                        <span class="font-[440] text-v2-text-text-muted">
                          {language.t("session.new.workspace.local.tooltip")}
                        </span>
                      </span>
                    }
                    class="min-w-0 flex-1"
                  >
                    <span class="min-w-0 truncate">{language.t("session.new.workspace.local")}</span>
                  </TooltipV2>
                  <Show when={selected() === "main"}>
                    <Icon name="check" size="small" class="shrink-0" />
                  </Show>
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => select("create")}>
                  <Icon name="workspace-new" />
                  <TooltipV2
                    placement="right"
                    openDelay={800}
                    value={
                      <span class="flex flex-col gap-0.5">
                        <span>{language.t("workspace.new")}</span>
                        <span class="font-[440] text-v2-text-text-muted">
                          {language.t("session.new.workspace.new.tooltip")}
                        </span>
                      </span>
                    }
                    class="min-w-0 flex-1"
                  >
                    <span class="min-w-0 truncate">{language.t("workspace.new")}</span>
                  </TooltipV2>
                  <Show when={selected() === "create"}>
                    <Icon name="check" size="small" class="shrink-0" />
                  </Show>
                </MenuV2.Item>
              </MenuV2.Group>
              <Show
                when={props.workspaces.length > 0}
                fallback={
                  <>
                    <MenuV2.Separator class="h-[0.5px]" />
                    <MenuV2.Item onSelect={() => (pending = { type: "viewAll" })}>
                      <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
                    </MenuV2.Item>
                  </>
                }
              >
                <MenuV2.Separator class="h-[0.5px]" />
                <MenuV2.Sub
                  gutter={0}
                  overlap
                  overflowPadding={8}
                  onOpenChange={(open) => {
                    if (!open) {
                      focusSearch = false
                      return
                    }
                    if (!focusSearch || props.workspaces.length < 10) return
                    focusSearch = false
                    requestAnimationFrame(() => searchInput?.focus())
                  }}
                >
                  <MenuV2.SubTrigger
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowRight" ||
                        event.key === "ArrowLeft" ||
                        event.key === "Enter" ||
                        event.key === " "
                      )
                        focusSearch = true
                    }}
                  >
                    <Icon name="workspace-isolated" />
                    <span class="min-w-0 flex-1 truncate">
                      {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
                    </span>
                  </MenuV2.SubTrigger>
                  <MenuV2.Portal>
                    <MenuV2.SubContent class="max-h-[calc(100dvh-16px)] w-[200px] overflow-y-auto">
                      <Show when={props.workspaces.length >= 10}>
                        <div class="flex h-7 items-center gap-2 rounded-sm ps-3 pe-2 text-v2-icon-icon-muted">
                          <Icon name="magnifying-glass" size="small" class="shrink-0" />
                          <input
                            ref={(element) => {
                              searchInput = element
                            }}
                            value={search()}
                            placeholder={language.t("session.new.workspace.search.placeholder")}
                            aria-label={language.t("session.new.workspace.search.placeholder")}
                            class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                            onInput={(event) => setSearch(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Escape" ||
                                event.key === "ArrowDown" ||
                                event.key === "ArrowUp" ||
                                event.key === "Enter"
                              )
                                return
                              event.stopPropagation()
                            }}
                          />
                        </div>
                      </Show>
                      <For each={workspaces()}>
                        {(workspace) => (
                          <MenuV2.Item onSelect={() => select(workspace)}>
                            <Icon name="workspace-isolated" />
                            <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                            <Show when={selected() === workspace}>
                              <Icon name="check" size="small" class="shrink-0" />
                            </Show>
                          </MenuV2.Item>
                        )}
                      </For>
                      <MenuV2.Separator class="h-[0.5px]" />
                      <MenuV2.Item onSelect={() => (pending = { type: "viewAll" })}>
                        <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
                      </MenuV2.Item>
                    </MenuV2.SubContent>
                  </MenuV2.Portal>
                </MenuV2.Sub>
              </Show>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </TooltipV2>
      <PromptGitStatus branch={props.branch} from={selected() === "create"} class="ms-1" />
    </>
  )
}

export function PromptGitStatus(props: { branch?: string; noGit?: boolean; from?: boolean; class?: string }) {
  const language = useLanguage()
  const label = () => {
    if (props.noGit) return language.t("session.new.git.none")
    if (!props.branch) return undefined
    if (props.from) return language.t("session.new.workspace.fromBranch", { branch: props.branch })
    return props.branch
  }

  const icon = () => {
    if (props.noGit) return "monitor"
    if (props.from) return "branch-out"
    return "branch"
  }

  return (
    <Show when={label()}>
      {(value) => (
        <TooltipV2
          placement="top"
          value={value()}
          class={`min-w-0 max-w-[220px] ${props.class ?? ""}`}
          contentClass="max-w-[calc(100vw-32px)] break-all"
        >
          <div class="flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 rounded-full bg-v2-background-bg-layer-02 px-2.5 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
            <Icon name={icon()} size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{value()}</span>
          </div>
        </TooltipV2>
      )}
    </Show>
  )
}
