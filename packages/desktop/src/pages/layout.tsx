import { Button, Tooltip, DiffChanges } from "@opencode-ai/ui"
import { createMemo, For, ParentProps, Show } from "solid-js"
import { getFilename } from "@/utils"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { A, useParams } from "@solidjs/router"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const sync = useSync()

  return (
    <div class="relative h-screen flex flex-col">
      <header class="hidden h-12 shrink-0 bg-background-strong border-b border-border-weak-base"></header>
      <div class="h-[calc(100vh-0rem)] flex">
        <div class="w-70 shrink-0 bg-background-weak border-r border-border-weak-base flex flex-col items-start">
          <div class="h-10 shrink-0 flex items-center self-stretch px-5 border-b border-border-weak-base">
            <span class="text-14-regular overflow-hidden text-ellipsis">{getFilename(sync.data.path.directory)}</span>
          </div>
          <div class="flex flex-col items-start gap-4 self-stretch flex-1 py-4 px-3 overflow-hidden">
            <Button as={A} href="/session" class="w-full" size="large" icon="edit-small-2">
              New Session
            </Button>
            <div class="w-full h-full overflow-y-auto no-scrollbar flex flex-col flex-1">
              <nav class="w-full">
                <For each={sync.data.session}>
                  {(session) => {
                    const updated = createMemo(() => DateTime.fromMillis(session.time.updated))
                    return (
                      <A
                        data-active={session.id === params.id}
                        href={`/session/${session.id}`}
                        class="group/session focus:outline-none"
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
              <Show when={sync.data.more}>
                <button
                  class="shrink-0 self-start p-3 text-12-medium text-text-weak hover:text-text-strong"
                  onClick={() => sync.session.fetch()}
                >
                  Show more
                </button>
              </Show>
            </div>
          </div>
        </div>
        <main class="size-full overflow-x-hidden">{props.children}</main>
      </div>
    </div>
  )
}
