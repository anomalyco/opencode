import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { Select } from "@opencode-ai/ui/select"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { base64Decode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { A, useParams } from "@solidjs/router"
import { createMemo, Show } from "solid-js"

export function Header(props: {
  navigateToProject: (directory: string) => void
  navigateToSession: (session: Session | undefined) => void
}) {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const params = useParams()
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const store = createMemo(() => globalSync.child(currentDirectory())[0])
  const sessions = createMemo(() => store().session ?? [])
  const currentSession = createMemo(() => sessions().find((s) => s.id === params.id))

  return (
    <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex" data-tauri-drag-region>
      <A
        href="/"
        classList={{
          "w-12 shrink-0 px-4 py-3.5": true,
          "flex items-center justify-start self-stretch": true,
          "border-r border-border-weak-base": true,
        }}
        style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        data-tauri-drag-region
      >
        <Mark class="shrink-0" />
      </A>
      <div class="pl-4 px-6 flex items-center justify-between gap-4 w-full">
        <Show when={params.dir && layout.projects.list().length > 0}>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <Select
                options={layout.projects.list().map((project) => project.worktree)}
                current={currentDirectory()}
                label={(x) => getFilename(x)}
                onSelect={(x) => (x ? props.navigateToProject(x) : undefined)}
                class="text-14-regular text-text-base"
                variant="ghost"
              >
                {/* @ts-ignore */}
                {(i) => (
                  <div class="flex items-center gap-2">
                    <Icon name="folder" size="small" />
                    <div class="text-text-strong">{getFilename(i)}</div>
                  </div>
                )}
              </Select>
              <div class="text-text-weaker">/</div>
              <Select
                options={sessions()}
                current={currentSession()}
                placeholder="New session"
                label={(x) => x.title}
                value={(x) => x.id}
                onSelect={props.navigateToSession}
                class="text-14-regular text-text-base max-w-md"
                variant="ghost"
              />
            </div>
            <Show when={currentSession()}>
              <Button as={A} href={`/${params.dir}/session`} icon="plus-small">
                New session
              </Button>
            </Show>
          </div>
          <div class="flex items-center gap-4">
            <Tooltip
              class="shrink-0"
              value={
                <div class="flex items-center gap-2">
                  <span>Toggle terminal</span>
                  <span class="text-icon-base text-12-medium">Ctrl `</span>
                </div>
              }
            >
              <Button variant="ghost" class="group/terminal-toggle size-6 p-0" onClick={layout.terminal.toggle}>
                <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                  <Icon
                    size="small"
                    name={layout.terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                    class="group-hover/terminal-toggle:hidden"
                  />
                  <Icon
                    size="small"
                    name="layout-bottom-partial"
                    class="hidden group-hover/terminal-toggle:inline-block"
                  />
                  <Icon
                    size="small"
                    name={layout.terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                    class="hidden group-active/terminal-toggle:inline-block"
                  />
                </div>
              </Button>
            </Tooltip>
          </div>
        </Show>
      </div>
    </header>
  )
}
