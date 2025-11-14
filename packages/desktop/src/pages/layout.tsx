import { Button, Tooltip, DiffChanges, IconButton, Mark, Icon } from "@opencode-ai/ui"
import { createMemo, For, Match, ParentProps, Show, Switch } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { A, useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const sync = useSync()
  const layout = useLayout()

  return (
    <div class="relative h-screen flex flex-col">
      <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base">
        <div
          classList={{
            "w-12 shrink-0 px-4 py-3.5": true,
            "flex items-center justify-start self-stretch": true,
            "border-r border-border-weak-base": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <Mark class="shrink-0" />
        </div>
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
          <div class="flex flex-col justify-center items-start gap-4 self-stretch p-2 overflow-hidden mx-auto @[4rem]:mx-0">
            <Switch>
              <Match when={layout.sidebar.opened()}>
                <Button
                  variant="ghost"
                  size="large"
                  class="group/sidebar-toggle w-full text-left justify-start"
                  onClick={layout.sidebar.toggle}
                >
                  <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                    <Icon name="layout-left" size="small" class="group-hover/sidebar-toggle:hidden" />
                    <Icon
                      name="layout-left-partial"
                      size="small"
                      class="hidden group-hover/sidebar-toggle:inline-block"
                    />
                    <Icon
                      name="layout-left-full"
                      size="small"
                      class="hidden group-active/sidebar-toggle:inline-block"
                    />
                  </div>
                  <div class="hidden group-hover/sidebar-toggle:block group-active/sidebar-toggle:block text-text-base">
                    Toggle sidebar
                  </div>
                </Button>
              </Match>
              <Match when={!layout.sidebar.opened()}>
                <Tooltip placement="right" value="Toggle sidebar">
                  <Button variant="ghost" size="large" class="group/sidebar-toggle" onClick={layout.sidebar.toggle}>
                    <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon name="layout-right" size="small" class="group-hover/sidebar-toggle:hidden" />
                      <Icon
                        name="layout-right-partial"
                        size="small"
                        class="hidden group-hover/sidebar-toggle:inline-block"
                      />
                      <Icon
                        name="layout-right-full"
                        size="small"
                        class="hidden group-active/sidebar-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </Tooltip>
              </Match>
            </Switch>
            <div class="w-full px-3">
              <Button as={A} href="/session" class="hidden @[4rem]:flex w-full" size="large" icon="edit-small-2">
                New Session
              </Button>
              <Tooltip placement="right" value="New session">
                <IconButton as={A} href="/session" icon="edit-small-2" size="large" class="@[4rem]:hidden" />
              </Tooltip>
            </div>
            <div class="hidden @[4rem]:flex size-full overflow-y-auto no-scrollbar flex-col flex-1 px-3">
              <nav class="w-full">
                <For each={sync.data.session}>
                  {(session) => {
                    const updated = createMemo(() => DateTime.fromMillis(session.time.updated))
                    return (
                      <A
                        data-active={session.id === params.id}
                        href={`/session/${session.id}`}
                        class="group/session focus:outline-none cursor-default"
                      >
                        <Tooltip placement="right" value={session.title}>
                          <div
                            class="w-full mb-1.5 px-3 py-1 rounded-md 
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
                            <div class="flex justify-between items-center self-stretch">
                              <span class="text-12-regular text-text-weak">{`${session.summary?.files || "No"} file${session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                              <Show when={session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                            </div>
                          </div>
                        </Tooltip>
                      </A>
                    )
                  }}
                </For>
              </nav>
              <Show when={sync.session.more()}>
                <button
                  class="shrink-0 self-start p-3 text-12-medium text-text-weak hover:text-text-strong"
                  onClick={() => sync.session.fetch()}
                >
                  Show more
                </button>
              </Show>
            </div>
          </div>
          <div class="flex flex-col items-start shrink-0 px-3 py-1 mx-auto @[4rem]:mx-0">
            <Button
              as={"a"}
              href="https://opencode.ai/desktop-feedback"
              target="_blank"
              class="hidden @[4rem]:flex w-full text-12-medium text-text-base stroke-[1.5px]"
              variant="ghost"
              icon="speech-bubble"
            >
              Share feedback
            </Button>
            <Tooltip placement="right" value="Share feedback">
              <IconButton
                as={"a"}
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                icon="speech-bubble"
                variant="ghost"
                size="large"
                class="@[4rem]:hidden stroke-[1.5px]"
              />
            </Tooltip>
          </div>
        </div>
        <main class="size-full overflow-x-hidden">{props.children}</main>
      </div>
    </div>
  )
}
