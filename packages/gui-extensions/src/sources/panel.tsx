import { createMemo } from "solid-js"
import { turnMessages, turnSources } from "@opencode/session-ui/sources"
import { sourcesExperiment } from "@opencode/session-ui/sources/experiment"
import { SourcesPanel } from "@opencode/session-ui/sources/panel"
import { useExtension, type MountedSession } from "../sdk"
import type Sources from "./index"

export default function SourcesTab(props: { session: MountedSession; from: string }) {
  const ctx = useExtension<typeof Sources>()

  const sources = createMemo(() =>
    turnSources(turnMessages(props.session.server.data.session.message.list(props.session.id), props.from)),
  )

  const open = (url: string) => {
    const pane = ctx.uses.browser()

    if (pane.status === "active" && pane.value.canOpen(props.session)) return pane.value.open(props.session, url)
    ctx.system.openExternal(url)
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-sources-panel">
      <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
        <SourcesPanel sources={sources()} icons={sourcesExperiment.icons} onOpen={open} />
      </div>
    </div>
  )
}
