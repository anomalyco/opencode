import { render } from "solid-js/web"
import { CopyButton } from "./copy-button"

customElements.define(
  "copy-button",
  class extends HTMLElement {
    connectedCallback() {
      const code = decodeURIComponent(this.dataset.code || "")
      render(() => CopyButton({ text: () => code }), this)
    }
  },
)
