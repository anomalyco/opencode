// @refresh reload
import { render } from "solid-js/web"
import { TwoFactorApp } from "./verify"
import "@/index.css"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your 2fa.html? Or maybe the id attribute got misspelled?",
  )
}

render(() => <TwoFactorApp />, root!)
