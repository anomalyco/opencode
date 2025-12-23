import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { Popover } from "@opencode-ai/ui/popover"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { base64Decode } from "@opencode-ai/util/encode"
import { useCommand } from "@/context/command"
import { getFilename } from "@opencode-ai/util/path"
import { A, useParams } from "@solidjs/router"
import { createMemo, createResource, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { iife } from "@opencode-ai/util/iife"

export function Header(props: {
  navigateToProject: (directory: string) => void
  navigateToSession: (session: Session | undefined) => void
  onMobileMenuToggle?: () => void
}) {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const command = useCommand()

  return (
    <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex" data-tauri-drag-region>
      <button
        type="button"
        class="xl:hidden w-12 shrink-0 flex items-center justify-center border-r border-border-weak-base hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors"
        onClick={props.onMobileMenuToggle}
      >
        <Icon name="menu" size="small" />
      </button>
      <A
        href="/"
        classList={{
          "hidden xl:flex": true,
          "w-12 shrink-0 px-4 py-3.5": true,
          "items-center justify-start self-stretch": true,
          "border-r border-border-weak-base": true,
        }}
        style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        data-tauri-drag-region
      >
        <Mark class="shrink-0" />
      </A>
      <div class="pl-4 px-6 flex items-center justify-between gap-4 w-full">
        <Show when={layout.projects.list().length > 0 && params.dir}>
          {(directory) => {
            const currentDirectory = createMemo(() => base64Decode(directory()))
            const store = createMemo(() => globalSync.child(currentDirectory())[0])
            const sessions = createMemo(() => (store().session ?? []).filter((s) => !s.parentID))
            const currentSession = createMemo(() => sessions().find((s) => s.id === params.id))
            const shareEnabled = createMemo(() => store().config.share !== "disabled")
            return (
              <>
                <div class="flex items-center gap-3 min-w-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="hidden xl:flex items-center gap-2">
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
                    </div>
                    <Select
                      options={sessions()}
                      current={currentSession()}
                      placeholder="New session"
                      label={(x) => x.title}
                      value={(x) => x.id}
                      onSelect={props.navigateToSession}
                      class="text-14-regular text-text-base max-w-[calc(100vw-180px)] md:max-w-md"
                      variant="ghost"
                    />
                  </div>
                  <Show when={currentSession()}>
                    <Tooltip
                      class="hidden xl:block"
                      value={
                        <div class="flex items-center gap-2">
                          <span>New session</span>
                          <span class="text-icon-base text-12-medium">{command.keybind("session.new")}</span>
                        </div>
                      }
                    >
                      <Button as={A} href={`/${params.dir}/session`} icon="plus-small">
                        New session
                      </Button>
                    </Tooltip>
                  </Show>
                </div>
                <div class="flex items-center gap-4">
                  <Tooltip
                    class="hidden md:block shrink-0"
                    value={
                      <div class="flex items-center gap-2">
                        <span>Toggle review</span>
                        <span class="text-icon-base text-12-medium">{command.keybind("review.toggle")}</span>
                      </div>
                    }
                  >
                    <Button variant="ghost" class="group/review-toggle size-6 p-0" onClick={layout.review.toggle}>
                      <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                        <Icon
                          size="small"
                          name={layout.review.opened() ? "layout-right-full" : "layout-right"}
                          class="group-hover/review-toggle:hidden"
                        />
                        <Icon
                          size="small"
                          name="layout-right-partial"
                          class="hidden group-hover/review-toggle:inline-block"
                        />
                        <Icon
                          size="small"
                          name={layout.review.opened() ? "layout-right" : "layout-right-full"}
                          class="hidden group-active/review-toggle:inline-block"
                        />
                      </div>
                    </Button>
                  </Tooltip>
                  <Tooltip
                    class="hidden md:block shrink-0"
                    value={
                      <div class="flex items-center gap-2">
                        <span>Toggle terminal</span>
                        <span class="text-icon-base text-12-medium">{command.keybind("terminal.toggle")}</span>
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
                  <Show when={shareEnabled() && currentSession()}>
                    <Popover
                      title="Share session"
                      trigger={
                        <Tooltip class="shrink-0" value="Share session">
                          <IconButton icon="share" variant="ghost" class="" />
                        </Tooltip>
                      }
                    >
                      {iife(() => {
                        const [url] = createResource(
                          () => currentSession(),
                          async (session) => {
                            if (!session) return
                            let shareURL = session.share?.url
                            if (!shareURL) {
                              shareURL = await globalSDK.client.session
                                .share({ sessionID: session.id, directory: currentDirectory() })
                                .then((r) => r.data?.share?.url)
                            }
                            return shareURL
                          },
                        )
                        return (
                          <Show when={url()}>
                            {(url) => <TextField value={url()} readOnly copyable class="w-72" />}
                          </Show>
                        )
                      })}
                    </Popover>
                  </Show>
                </div>
              </>
            )
          }}
        </Show>
      </div>
    </header>
  )
}
