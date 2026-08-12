import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/commit-mono/400.css"
import "@fontsource/commit-mono/400-italic.css"
import "@fontsource/commit-mono/700.css"
import "@fontsource/commit-mono/700-italic.css"
import "@fontsource/noto-sans-symbols/symbols-400.css"
import "@fontsource/noto-sans-symbols/symbols-700.css"
import "@fontsource/noto-sans-symbols-2/symbols-400.css"
import "@fontsource/noto-sans-math/math-400.css"
import "./styles.css"
import { App } from "./App"
import type { Catalog } from "./catalog"
import { catalogBasePath } from "./base-path"

const catalog = await fetch(`${catalogBasePath()}catalog.json`).then((response) => {
  if (!response.ok) throw new Error(`Failed to load catalog: ${response.status}`)
  return response.json() as Promise<Catalog>
})

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

createRoot(root).render(
  <StrictMode>
    <App catalog={catalog} />
  </StrictMode>,
)
