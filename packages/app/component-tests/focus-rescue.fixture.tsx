import { installFocusRescue } from "@opencode/ui/context/focus-rescue"

/**
 * Scopes whose buttons remove themselves when pressed. The opener stays, and so does the panel toggle: like a toolbar
 * button it takes no focus from a click, and it shows or hides a panel beside the scopes.
 */
export function mountFocusRescue() {
  const host = document.createElement("div")
  host.dataset.testid = "focus-rescue-fixture"
  host.innerHTML = `
    <div data-testid="list" data-focus-scope>
      <button type="button">One</button>
      <button type="button">Two</button>
      <button type="button">Three</button>
    </div>
    <button type="button" data-testid="opener">Opener</button>
    <div data-testid="toasts" data-focus-scope>
      <button type="button">Toast</button>
    </div>
    <div data-testid="strip" data-focus-scope>
      <div role="tablist">
        <button type="button" role="tab">Tab A</button>
        <button type="button" role="tab">Tab B</button>
        <button type="button">Add tab</button>
      </div>
    </div>
    <div data-testid="area" data-focus-scope>
      <div data-testid="scroller" data-scrollable tabindex="-1" style="height: 96px; overflow-y: auto">
        <button type="button">Near</button>
        <div style="height: 800px"></div>
        <button type="button">Far</button>
      </div>
    </div>
    <button type="button" data-testid="panel">Panel</button>
  `
  host.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return

    if (event.target.dataset.testid === "panel") {
      const side = host.querySelector('[data-testid="side"]')

      if (side) return side.remove()
      host.insertAdjacentHTML("beforeend", '<div data-testid="side">Side panel</div>')

      return
    }

    if (!event.target.dataset.testid) event.target.remove()
  })
  host.addEventListener("mousedown", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.testid === "panel") event.preventDefault()
  })
  document.body.appendChild(host)
  installFocusRescue()
}
