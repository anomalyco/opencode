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

mock.module("virtual:pwa-register/solid", () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    const [needRefresh, setNeedRefresh] = createSignal(false)

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
  render(() => <PwaUpdatePrompt />, container)
  const dispose = () => container.remove()
  return { container, dispose }
}

afterEach(() => {
  // Reset all shared state between tests
  triggerNeedRefresh = () => {}
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

    const labels = Array.from(container.querySelectorAll("button")).map((b) =>
      b.textContent?.trim().toLowerCase() ?? "",
    )
    const hasReload = labels.some((l) => l.includes("reload") || l.includes("update"))
    const hasDismiss = labels.some((l) => l.includes("dismiss") || l.includes("close") || l.includes("later"))

    expect(hasReload).toBe(true)
    expect(hasDismiss).toBe(true)
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

    const reloadBtn = Array.from(container.querySelectorAll("button")).find((b) => {
      const text = b.textContent?.trim().toLowerCase() ?? ""
      return text.includes("reload") || text.includes("update")
    })
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

    const dismissBtn = Array.from(container.querySelectorAll("button")).find((b) => {
      const text = b.textContent?.trim().toLowerCase() ?? ""
      return text.includes("dismiss") || text.includes("close") || text.includes("later")
    })
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

  test("B8: component does not throw when updateServiceWorker is not provided", () => {
    omitUpdateServiceWorker = true

    const { container, dispose } = mountIntoContainer()
    triggerNeedRefresh()

    const reloadBtn = Array.from(container.querySelectorAll("button")).find((b) => {
      const text = b.textContent?.trim().toLowerCase() ?? ""
      return text.includes("reload") || text.includes("update")
    })
    expect(reloadBtn).not.toBeNull()

    // Clicking Reload when updateServiceWorker is undefined must not throw
    expect(() => reloadBtn!.click()).not.toThrow()

    dispose()
  })
})
