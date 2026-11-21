import { installFocusRescue } from "@opencode/ui/context/focus-rescue"

/** Scopes whose buttons remove themselves when pressed, all but the opener. */
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
  `
  host.addEventListener("click", (event) => {
    if (event.target instanceof HTMLButtonElement && event.target.dataset.testid !== "opener") event.target.remove()
  })
  document.body.appendChild(host)
  installFocusRescue()
}
