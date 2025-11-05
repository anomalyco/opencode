import { Button, Tooltip, DiffChanges } from "@opencode-ai/ui"
import { createMemo, ParentProps, Show } from "solid-js"
import { getFilename } from "@/utils"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { VList } from "virtua/solid"
import { A, useParams } from "@solidjs/router"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const sync = useSync()
  return (
    <div class="relative h-screen flex flex-col">
      <header class="hidden h-12 shrink-0 bg-background-strong border-b border-border-weak-base"></header>
      <div class="h-[calc(100vh-0rem)] flex">
        <div class="w-70 shrink-0 bg-background-weak border-r border-border-weak-base flex flex-col items-start">
          <div class="h-10 flex items-center self-stretch px-5 border-b border-border-weak-base">
            <span class="text-14-regular overflow-hidden text-ellipsis">{getFilename(sync.data.path.directory)}</span>
          </div>
          <div class="flex flex-col items-start gap-4 self-stretch flex-1 py-4 px-3">
            <A href="/session" class="w-full">
              <Button class="w-full" size="large" icon="edit-small-2">
                New Session
              </Button>
            </A>
            <VList data={sync.data.session} class="no-scrollbar">
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
            </VList>
          </div>
        </div>
        <main class="size-full overflow-x-hidden">{props.children}</main>
      </div>
    </div>
  )
}
