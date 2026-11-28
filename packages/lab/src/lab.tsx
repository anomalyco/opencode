import "../../app/src/index.css"

import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { LabBrowser } from "../../app/src/lab/browser"
import { loadLabCatalog, type PageModule } from "../../app/src/lab/catalog"
import { PluginLab } from "./plugin"
import { LabProviders } from "./providers"

// This origin uses the page mocks, so it can include the standalone dialog fixtures as well.
const modules = import.meta.glob<PageModule>("../../{app,ui,session-ui,gui-plugins}/src/**/*.lab.tsx")

const sources = import.meta.glob<string>("../../{app,ui,session-ui,gui-plugins}/src/**/*.lab.tsx", {
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
    <LabProviders>
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
          plugin={PluginLab}
        />
      </main>
    </LabProviders>
  )
}

document.title = "OpenCode Lab"
render(StandaloneLab, document.getElementById("lab-root")!)
