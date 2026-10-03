import { For, Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"

export function PromptWorkspaceSelector(props: {
  value: string
  projectRoot: string
  projectBranch?: string
  workspaces: { directory: string; branch?: string }[]
  onChange: (value: string) => void
  onDone: () => void
}) {
  const language = useLanguage()
  let pending: string | undefined
  const selected = () => (props.value === props.projectRoot ? "main" : props.value)
  const select = (value: string) => {
    pending = value
  }
  const onOpenChange = (open: boolean) => {
    if (open) return
    const value = pending
    pending = undefined
    if (value) props.onChange(value)
    props.onDone()
  }
  const workspaceLabel = (workspace: string) => {
    if (workspace === "main" || workspace === props.projectRoot) return "main"
    const prefix = `${props.projectRoot}-`
    if (workspace.startsWith(prefix)) return workspace.slice(prefix.length)
    return workspace
  }
  const selectedWorkspace = () => props.workspaces.find((workspace) => workspace.directory === props.value)
  const projectLabel = () => props.projectBranch ?? props.projectRoot
  const label = () => (selected() === "main" ? projectLabel() : workspaceLabel(props.value))

  return (
    <>
      <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
      <MenuV2 placement="bottom" gutter={4} onOpenChange={onOpenChange}>
        <MenuV2.Trigger class="flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed data-[expanded]:text-v2-text-text-muted">
          <Show
            when={selected() === "main"}
            fallback={<Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />}
          >
            <Show
              when={props.projectBranch}
              fallback={<IconV2 name="monitor" class="shrink-0 text-v2-icon-icon-muted" />}
            >
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            </Show>
          </Show>
          <span class="flex min-w-0 flex-1 items-center gap-1.5 text-v2-text-text-muted">
            <span class="shrink-0">{label()}</span>
            <Show when={selectedWorkspace()?.branch}>
              {(branch) => (
                <>
                  <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 truncate">{branch()}</span>
                </>
              )}
            </Show>
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="w-[min(32rem,calc(100vw-2rem))]">
            <MenuV2.Group>
              <MenuV2.GroupLabel>{language.t("session.new.workspace.runIn")}</MenuV2.GroupLabel>
              <MenuV2.Item onSelect={() => select(props.projectRoot)}>
                <Show when={props.projectBranch} fallback={<IconV2 name="monitor" />}>
                  <Icon name="branch" size="small" />
                </Show>
                <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{projectLabel()}</span>
                <Show when={selected() === "main"}>
                  <Icon name="check" size="small" class="shrink-0" />
                </Show>
              </MenuV2.Item>
            </MenuV2.Group>
            <Show when={props.workspaces.length > 0}>
              <MenuV2.Separator />
              <MenuV2.Group>
                <MenuV2.GroupLabel>{language.t("session.new.workspace.existing")}</MenuV2.GroupLabel>
                <For each={props.workspaces}>
                  {(workspace) => (
                    <MenuV2.Item onSelect={() => select(workspace.directory)}>
                      <Icon name="folder" size="small" />
                      <span class="flex min-w-0 flex-1 items-center gap-1.5 text-v2-text-text-base">
                        <span class="shrink-0">{workspaceLabel(workspace.directory)}</span>
                        <Show when={workspace.branch}>
                          {(branch) => (
                            <>
                              <Icon name="branch" size="small" class="shrink-0" />
                              <span class="min-w-0 truncate">{branch()}</span>
                            </>
                          )}
                        </Show>
                      </span>
                      <Show when={selected() === workspace.directory}>
                        <Icon name="check" size="small" class="shrink-0" />
                      </Show>
                    </MenuV2.Item>
                  )}
                </For>
              </MenuV2.Group>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </>
  )
}

export function PromptGitStatus(props: { branch?: string; noGit?: boolean }) {
  const language = useLanguage()
  const label = () => {
    if (props.noGit) return language.t("session.new.git.none")
    return props.branch
  }

  return (
    <Show when={label()}>
      {(value) => (
        <>
          <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
          <TooltipV2
            placement="top"
            value={value()}
            class="min-w-0 max-w-[220px]"
            contentClass="max-w-[calc(100vw-32px)] break-all"
          >
            <div class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px]">
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 truncate">{value()}</span>
            </div>
          </TooltipV2>
        </>
      )}
    </Show>
  )
}
