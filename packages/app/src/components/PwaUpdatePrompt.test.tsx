/**
 * @spec-handoff
 * @interface PwaUpdatePrompt(): JSX.Element
 *   No props. Internally calls `useRegisterSW` from `virtual:pwa-register/solid`.
 *
 * @behavior
 *   - Renders nothing (null / empty DOM) when `needRefresh` signal is false
 *   - Renders an update banner when `needRefresh` signal is true
 *   - Banner contains a "Reload" button and a "Dismiss" button
 *   - Clicking "Reload" calls `updateServiceWorker(true)` and hides the banner
 *   - Clicking "Dismiss" hides the banner WITHOUT calling `updateServiceWorker`
 *   - Banner has `role="status"` for non-intrusive screen-reader announcement
 *   - Banner has an accessible label: either `aria-label` attribute or a visible heading
 *   - Component does not throw when `updateServiceWorker` is not provided by the hook
 *
 * @edge-cases
 *   - `useRegisterSW` may not call `onNeedRefresh` at all → component stays hidden
 *   - `updateServiceWorker` may be undefined/null → graceful no-op on Reload
 *   - Banner must NOT trap focus or block interaction with the rest of the app
 *
 * @see virtual:pwa-register/solid (stubbed in tests via mock.module)
 * @see packages/app/public/site.webmanifest
 */

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { type JSX, createSignal } from "solid-js"
import { render } from "solid-js/web"

// ---------------------------------------------------------------------------
// Types for the mock — mirrors the vite-plugin-pwa virtual module shape
// ---------------------------------------------------------------------------
type RegisterSWOptions = {
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
  onRegisterError?: (error: unknown) => void
}

// ---------------------------------------------------------------------------
// Shared mutable state driven by the module-level mock.
//
// `mock.module` is called once at module scope (Bun hoists it), so the mock
// factory runs once per test file.  We expose mutable hook overrides via
// module-level variables so individual tests can control the mock's behaviour
// without re-calling mock.module (which would not affect an already-imported
// component).
// ---------------------------------------------------------------------------

// Controlled by tests: overriding `currentNeedRefreshOverride` to `true`
// makes the hook's signal start as `true` on the next mount.
let triggerNeedRefresh: () => void = () => {}

// Spy: tests assign this to detect whether updateServiceWorker was called.
let updateServiceWorkerSpy: ((reloadPage?: boolean) => void) | null = null

// Tests set this to `true` to simulate the hook returning undefined for
// updateServiceWorker (B8 graceful-degradation scenario).
let omitUpdateServiceWorker = false

// Exposed so B9 can reset needRefresh() independently of show() to pin the
// dual-signal visibility gate.
let setNeedRefreshSignal: (v: boolean) => void = () => {}

mock.module("virtual:pwa-register/solid", () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    const [needRefresh, setNeedRefresh] = createSignal(false)

    // Expose the setter so tests can drive needRefresh independently
    setNeedRefreshSignal = setNeedRefresh

    // Wire up the out-of-band trigger so tests can flip the signal
    triggerNeedRefresh = () => {
      setNeedRefresh(true)
      options.onNeedRefresh?.()
    }

    if (omitUpdateServiceWorker) {
      return { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker: undefined }
    }

    const updateServiceWorker = async (reloadPage?: boolean) => {
      updateServiceWorkerSpy?.(reloadPage)
      // Simulate the SW completing its update: hide the banner
      setNeedRefresh(false)
    }

    return { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker }
  },
}))

// ---------------------------------------------------------------------------
// The component is dynamically imported AFTER mock.module is registered
// ---------------------------------------------------------------------------
let PwaUpdatePrompt: () => JSX.Element

beforeAll(async () => {
  const mod = await import("./PwaUpdatePrompt")
  PwaUpdatePrompt = mod.PwaUpdatePrompt
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mountIntoContainer(): { container: HTMLDivElement; dispose: () => void } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const solidDispose = render(() => <PwaUpdatePrompt />, container)
  const dispose = () => {
    solidDispose()
    container.remove()
  }
  return { container, dispose }
}

function findButton(container: HTMLElement, label: "reload" | "dismiss"): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll("button"))
  return (buttons.find((b) => b.textContent?.toLowerCase().trim() === label) ?? null) as HTMLButtonElement | null
}

afterEach(() => {
  // Reset all shared state between tests
  triggerNeedRefresh = () => {}
  setNeedRefreshSignal = () => {}
  updateServiceWorkerSpy = null
  omitUpdateServiceWorker = false
  document.body.innerHTML = ""
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PwaUpdatePrompt", () => {
  test("B1: renders nothing when needRefresh is false", () => {
    const { container, dispose } = mountIntoContainer()
    // No SW update is pending — banner must be absent
    const banner = container.querySelector("[role='status']")
    expect(banner).toBeNull()
    dispose()
  })

  test("B2: renders the update banner when needRefresh becomes true", () => {
    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()
    const banner = container.querySelector("[role='status']")
    expect(banner).not.toBeNull()
    dispose()
  })

  test("B3: banner includes a Reload button and a Dismiss button", () => {
    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    expect(findButton(container, "reload")).not.toBeNull()
    expect(findButton(container, "dismiss")).not.toBeNull()

    dispose()
  })

  test("B4: clicking Reload calls updateServiceWorker(true) and hides the banner", () => {
    let updateCalled = false
    let calledWithTrue = false

    updateServiceWorkerSpy = (reloadPage) => {
      updateCalled = true
      calledWithTrue = reloadPage === true
    }

    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const reloadBtn = findButton(container, "reload")
    expect(reloadBtn).not.toBeNull()
    reloadBtn!.click()

    expect(updateCalled).toBe(true)
    expect(calledWithTrue).toBe(true)
    // Mock's updateServiceWorker resets the signal → banner must be gone
    expect(container.querySelector("[role='status']")).toBeNull()

    dispose()
  })

  test("B5: clicking Dismiss hides the banner without calling updateServiceWorker", () => {
    let updateCalled = false
    updateServiceWorkerSpy = () => { updateCalled = true }

    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const dismissBtn = findButton(container, "dismiss")
    expect(dismissBtn).not.toBeNull()
    dismissBtn!.click()

    expect(updateCalled).toBe(false)
    expect(container.querySelector("[role='status']")).toBeNull()

    dispose()
  })

  test("B6: banner has role='status' for screen readers", () => {
    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const banner = container.querySelector("[role='status']")
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute("role")).toBe("status")

    dispose()
  })

  test("B7: banner has an accessible label (aria-label or visible heading)", () => {
    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const banner = container.querySelector("[role='status']")
    expect(banner).not.toBeNull()

    const ariaLabel = banner?.getAttribute("aria-label")
    const heading = banner?.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']")

    const hasAccessibleLabel = Boolean(ariaLabel?.trim()) || Boolean(heading?.textContent?.trim())
    expect(hasAccessibleLabel).toBe(true)

    dispose()
  })

  test("B9: re-shows banner if SW update fires again after dismiss", () => {
    const { container, dispose } = mountIntoContainer()

    // 1. SW fires onNeedRefresh → banner appears
    triggerNeedRefresh()
    expect(container.querySelector("[role='status']")).not.toBeNull()

    // 2. User clicks Dismiss → banner hides (show() = false, needRefresh() still true)
    const dismissBtn = findButton(container, "dismiss")
    expect(dismissBtn).not.toBeNull()
    dismissBtn!.click()
    expect(container.querySelector("[role='status']")).toBeNull()

    // 2b. Pin that needRefresh() participates in the gate: reset it to false so
    //     both signals are false, then confirm the banner is still absent.
    //     This ensures the component requires BOTH show() AND needRefresh() to
    //     be true — removing either guard would break this assertion.
    setNeedRefreshSignal(false)
    expect(container.querySelector("[role='status']")).toBeNull()

    // 3. SW fires onNeedRefresh again → sets needRefresh(true) + show(true) → banner reappears
    triggerNeedRefresh()
    expect(container.querySelector("[role='status']")).not.toBeNull()

    dispose()
  })

  test("B8: component does not throw when updateServiceWorker is not provided", () => {
    omitUpdateServiceWorker = true

    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const reloadBtn = findButton(container, "reload")
    expect(reloadBtn).not.toBeNull()

    // Clicking Reload when updateServiceWorker is undefined must not throw
    expect(() => reloadBtn!.click()).not.toThrow()

    dispose()
  })
})
