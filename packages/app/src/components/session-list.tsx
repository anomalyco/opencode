import { useSync, useLocal } from "@/context"
import { Button, Tooltip } from "@/ui"
import { VList } from "virtua/solid"

export default function SessionList() {
  const sync = useSync()
  const local = useLocal()

  return (
    <VList data={sync.data.session} class="p-2">
      {(session) => (
        <Tooltip placement="right" value={session.title} class="w-full min-w-0">
          <Button
            size="sm"
            variant="ghost"
            classList={{
              "w-full min-w-0 py-1 text-left truncate justify-start text-text-muted text-xs": true,
              "text-text!": local.session.active()?.id === session.id,
            }}
            onClick={() => local.session.setActive(session.id)}
          >
            <span class="truncate">{session.title}</span>
          </Button>
        </Tooltip>
      )}
    </VList>
  )
}
