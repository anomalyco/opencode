import { useSync, useLocal } from "@/context"
import { Tooltip } from "@/ui"
import { DateTime } from "luxon"
import { VList } from "virtua/solid"

export default function SessionList() {
  const sync = useSync()
  const local = useLocal()
  return (
    <VList data={sync.data.session} class="p-3">
      {(session) => (
        <Tooltip placement="right" value={session.title} class="w-full min-w-0">
          <button
            data-active={local.session.active()?.id === session.id}
            class="group w-full min-w-0 text-left truncate justify-start text-xs my-0.5 cursor-pointer
                   flex flex-col gap-1 rounded-md p-2 border-[0.5px] border-transparent
                   hover:not-data-[active=true]:bg-background-panel
                   data-[active=true]:bg-background-element data-[active=true]:border-border-subtle"
            onClick={() => local.session.setActive(session.id)}
          >
            <div class="flex gap-1 items-center">
              <div
                classList={{
                  "text-text/80 min-w-0 grow truncate": true,
                  "group-data-[active=true]:text-text!": true,
                }}
              >
                {session.title}
              </div>
              <div class="shrink-0 text-text-muted/60">{DateTime.fromMillis(session.time.updated).toRelative()}</div>
            </div>
            <span class="text-text-muted truncate">{session.share?.url}</span>
          </button>
        </Tooltip>
      )}
    </VList>
  )
}
