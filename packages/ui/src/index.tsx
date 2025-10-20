/* @refresh reload */
import { render } from "solid-js/web"
import { MetaProvider } from "@solidjs/meta"

import Demo from "./demo"

const root = document.getElementById("root")

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

render(
  () => (
    <MetaProvider>
      <Demo />
    </MetaProvider>
  ),
  root!,
)
