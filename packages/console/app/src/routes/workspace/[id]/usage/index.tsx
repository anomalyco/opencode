import { Show } from "solid-js"
import { A, createAsync, useParams, useLocation } from "@solidjs/router"
import { GraphSection } from "./graph-section"
import { UsageSection } from "./usage-section"
import { querySessionInfo } from "../../common"
import styles from "./usage-tabs.module.css"

export default function () {
  const params = useParams()
  const user = createAsync(() => querySessionInfo(params.id!))
  const location = useLocation()

  const isModelsPage = () => location.pathname.includes("/models")

  return (
    <div data-page="workspace-[id]">
      <div data-slot="usage-tabs" class={styles.tabs}>
        <A
          href={`/workspace/${params.id}/usage`}
          class={styles.tab}
          data-active={!isModelsPage()}
        >
          Usage Details
        </A>
        <A
          href={`/workspace/${params.id}/usage/models`}
          class={styles.tab}
          data-active={isModelsPage()}
        >
          Model Statistics
        </A>
      </div>
      <div data-slot="sections">
        <Show when={!isModelsPage()}>
          <Show when={user()?.isAdmin}>
            <GraphSection />
          </Show>
          <UsageSection />
        </Show>
        <Show when={isModelsPage()}>
          {/* Lazy load the models section */}
          <Show when={typeof window !== "undefined"}>
            <ModelsSection />
          </Show>
        </Show>
      </div>
    </div>
  )
}

// Lazy load component
import { ModelsSection } from "./models/index"
