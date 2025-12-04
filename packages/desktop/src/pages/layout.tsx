import { createMemo, For, ParentProps, Show } from "solid-js"
import { DateTime } from "luxon"
import { A, useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { base64Encode } from "@/utils"
import { Mark } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { getFilename } from "@opencode-ai/util/path"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const globalSync = useGlobalSync()
  const layout = useLayout()

  const handleOpenProject = async () => {
    // layout.projects.open(dir.)
  }

  return (
    <div class="relative h-screen flex flex-col">
      <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base">
        <A
          href="/"
          classList={{
            "w-12 shrink-0 px-4 py-3.5": true,
            "flex items-center justify-start self-stretch": true,
            "border-r border-border-weak-base": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <Mark class="shrink-0" />
        </A>
      </header>
      <div class="h-[calc(100vh-3rem)] flex">
        <div
          classList={{
            "@container w-12 pb-5 shrink-0 bg-background-base": true,
            "flex flex-col gap-5.5 items-start self-stretch justify-between": true,
            "border-r border-border-weak-base": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <div class="grow flex flex-col items-start self-stretch gap-4 p-2 min-h-0">
            <Tooltip class="shrink-0" placement="right" value="Toggle sidebar" inactive={layout.sidebar.opened()}>
              <Button
                variant="ghost"
                size="large"
                class="group/sidebar-toggle shrink-0 w-full text-left justify-start"
                onClick={layout.sidebar.toggle}
              >
                <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left" : "layout-right"}
                    size="small"
                    class="group-hover/sidebar-toggle:hidden"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-partial" : "layout-right-partial"}
                    size="small"
                    class="hidden group-hover/sidebar-toggle:inline-block"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-full" : "layout-right-full"}
                    size="small"
                    class="hidden group-active/sidebar-toggle:inline-block"
                  />
                </div>
                <Show when={layout.sidebar.opened()}>
                  <div class="hidden group-hover/sidebar-toggle:block group-active/sidebar-toggle:block text-text-base">
                    Toggle sidebar
                  </div>
                </Show>
              </Button>
            </Tooltip>
            <div class="flex flex-col justify-center items-start gap-4 self-stretch min-h-0">
              <div class="hidden @[4rem]:flex size-full flex-col grow overflow-y-auto no-scrollbar">
                <For each={layout.projects.list()}>
                  {(project) => {
                    const [store] = globalSync.child(project.directory)
                    const slug = createMemo(() => base64Encode(project.directory))
                    return (
                      <Collapsible variant="ghost" defaultOpen class="gap-2">
                        <Button
                          as={"div"}
                          variant="ghost"
                          class="flex items-center justify-between gap-3 w-full h-8 pl-2 pr-2.25 self-stretch"
                        >
                          <Collapsible.Trigger class="p-0 text-left text-14-medium text-text-strong grow min-w-0 truncate">
                            {getFilename(project.directory)}
                          </Collapsible.Trigger>
                          <IconButton as={A} href={`${slug()}/session`} icon="plus-small" size="normal" />
                        </Button>
                        <Collapsible.Content>
                          <nav class="w-full flex flex-col gap-1.5">
                            <For each={store.session}>
                              {(session) => {
                                const updated = createMemo(() => DateTime.fromMillis(session.time.updated))
                                return (
                                  <A
                                    data-active={session.id === params.id}
                                    href={`${slug()}/session/${session.id}`}
                                    class="group/session focus:outline-none cursor-default"
                                  >
                                    <Tooltip placement="right" value={session.title}>
                                      <div
                                        class="w-full px-2 py-1 rounded-md 
                                               group-data-[active=true]/session:bg-surface-raised-base-hover
                                               group-hover/session:bg-surface-raised-base-hover
                                               group-focus/session:bg-surface-raised-base-hover"
                                      >
                                        <div class="flex items-center self-stretch gap-6 justify-between">
                                          <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                                            {session.title}
                                          </span>
                                          <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                                            {Math.abs(updated().diffNow().as("seconds")) < 60
                                              ? "Now"
                                              : updated()
                                                  .toRelative({ style: "short", unit: ["days", "hours", "minutes"] })
                                                  ?.replace(" ago", "")
                                                  ?.replace(/ days?/, "d")
                                                  ?.replace(" min.", "m")
                                                  ?.replace(" hr.", "h")}
                                          </span>
                                        </div>
                                        <div class="hidden _flex justify-between items-center self-stretch">
                                          <span class="text-12-regular text-text-weak">{`${session.summary?.files || "No"} file${session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                                          <Show when={session.summary}>
                                            {(summary) => <DiffChanges changes={summary()} />}
                                          </Show>
                                        </div>
                                      </div>
                                    </Tooltip>
                                  </A>
                                )
                              }}
                            </For>
                          </nav>
                          {/* <Show when={sync.session.more()}> */}
                          {/*   <button */}
                          {/*     class="shrink-0 self-start p-3 text-12-medium text-text-weak hover:text-text-strong" */}
                          {/*     onClick={() => sync.session.fetch()} */}
                          {/*   > */}
                          {/*     Show more */}
                          {/*   </button> */}
                          {/* </Show> */}
                        </Collapsible.Content>
                      </Collapsible>
                    )
                  }}
                </For>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
            <Tooltip placement="right" value="Open project" inactive={layout.sidebar.opened()}>
              <Button
                disabled
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                variant="ghost"
                size="large"
                icon="folder-add-left"
                onClick={handleOpenProject}
              >
                <Show when={layout.sidebar.opened()}>Open project</Show>
              </Button>
            </Tooltip>
            <Tooltip placement="right" value="Settings" inactive={layout.sidebar.opened()}>
              <Button
                disabled
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                variant="ghost"
                size="large"
                icon="settings-gear"
              >
                <Show when={layout.sidebar.opened()}>Settings</Show>
              </Button>
            </Tooltip>
            <Tooltip placement="right" value="Share feedback" inactive={layout.sidebar.opened()}>
              <Button
                as={"a"}
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                variant="ghost"
                size="large"
                icon="bubble-5"
              >
                <Show when={layout.sidebar.opened()}>Share feedback</Show>
              </Button>
            </Tooltip>
          </div>
        </div>
        <main class="size-full overflow-x-hidden">{props.children}</main>
      </div>
    </div>
  )
}
