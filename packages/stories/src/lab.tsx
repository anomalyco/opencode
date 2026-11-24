import "../../app/src/index.css"

import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { LabBrowser } from "../../app/src/components-lab/browser"
import { loadLabCatalog, type StoryModule } from "../../app/src/components-lab/catalog"
import { PluginStory } from "./plugin"
import { StoryProviders } from "./providers"

// This origin uses the story mocks, so it can include the standalone dialog fixtures as well.
const modules = import.meta.glob<StoryModule>("../../{app,ui,session-ui,gui-plugins}/src/**/*.stories.tsx")

const sources = import.meta.glob<string>("../../{app,ui,session-ui,gui-plugins}/src/**/*.stories.tsx", {
  query: "?raw",
  import: "default",
})

function StandaloneLab() {
  const readParams = () => Object.fromEntries(new URLSearchParams(location.search))

  const [params, setParams] = createSignal(readParams())

  const sync = () => setParams(readParams())

  window.addEventListener("popstate", sync)
  onCleanup(() => window.removeEventListener("popstate", sync))

  return (
    <StoryProviders>
      <main style={{ display: "flex", height: "100dvh" }}>
        <LabBrowser
          params={params()}
          setParams={(patch) => {
            const url = new URL(location.href)

            for (const [key, value] of Object.entries(patch)) {
              if (value === undefined) url.searchParams.delete(key)
              else url.searchParams.set(key, value)
            }
            if (url.href === location.href) return

            history.pushState(null, "", url)
            sync()
          }}
          loadCatalog={() => loadLabCatalog(modules, sources)}
          plugin={PluginStory}
        />
      </main>
    </StoryProviders>
  )
}

document.title = "OpenCode Components Lab"
render(StandaloneLab, document.getElementById("story-root")!)
