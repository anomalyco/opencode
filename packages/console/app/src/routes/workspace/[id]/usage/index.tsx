import { Show } from "solid-js"
import { createAsync, useParams } from "@solidjs/router"
import { GraphSection } from "./graph-section"
import { UsageSection } from "./usage-section"
import { querySessionInfo } from "../../common"

export default function () {
  const params = useParams()
  const user = createAsync(() => querySessionInfo(params.id!))

  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <Show when={user()?.isAdmin}>
          <GraphSection />
        </Show>
        <UsageSection />
      </div>
    </div>
  )
}
