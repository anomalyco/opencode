/**
 * @spec-handoff
 * @interface createPwaUpdateController(options): PwaUpdateController
 *   Pure update-prompt decision logic for the PWA install/update banner.
 *   No UI imports — testable in `bun test` without a JSX transform or DOM.
 *   options.needRefresh: () => boolean   reactive "SW has a new version" gate
 *   options.update:      () => void      activate waiting SW + reload page
 *
 * @behavior
 *   - `visible()` is false until BOTH a pending update exists (needRefresh)
 *     AND the banner has been armed (notifyNeedRefresh) and not dismissed.
 *   - `reload()` calls `update()` exactly once and hides the banner.
 *   - `dismiss()` hides the banner WITHOUT calling `update()`.
 *   - After dismiss, a fresh `notifyNeedRefresh()` re-arms the banner
 *     (registerType "prompt" self-healing).
 *
 * @edge-cases
 *   - needRefresh true but never armed → still hidden.
 *   - needRefresh toggling false→true without notify → still hidden.
 *
 * @see ./pwa-update.ts
 * @see ./PwaUpdatePrompt.tsx (thin JSX wrapper)
 */

import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createPwaUpdateController } from "./pwa-update"

describe("createPwaUpdateController", () => {
  test("is hidden when no update is pending", () => {
    createRoot((dispose) => {
      const controller = createPwaUpdateController({ needRefresh: () => false, update: () => {} })
      expect(controller.visible()).toBe(false)
      dispose()
    })
  })

  test("stays hidden until the banner is armed, even when needRefresh is true", () => {
    createRoot((dispose) => {
      const [needRefresh, setNeedRefresh] = createSignal(false)
      const controller = createPwaUpdateController({ needRefresh, update: () => {} })

      setNeedRefresh(true)
      expect(controller.visible()).toBe(false) // pending update but not yet armed

      controller.notifyNeedRefresh()
      expect(controller.visible()).toBe(true)

      dispose()
    })
  })

  test("reload applies the update once and hides the banner", () => {
    createRoot((dispose) => {
      let updateCalls = 0
      const [needRefresh] = createSignal(true)
      const controller = createPwaUpdateController({
        needRefresh,
        update: () => {
          updateCalls++
        },
      })

      controller.notifyNeedRefresh()
      expect(controller.visible()).toBe(true)

      controller.reload()
      expect(updateCalls).toBe(1)
      expect(controller.visible()).toBe(false)

      dispose()
    })
  })

  test("dismiss hides the banner without applying the update", () => {
    createRoot((dispose) => {
      let updateCalls = 0
      const [needRefresh] = createSignal(true)
      const controller = createPwaUpdateController({
        needRefresh,
        update: () => {
          updateCalls++
        },
      })

      controller.notifyNeedRefresh()
      controller.dismiss()

      expect(updateCalls).toBe(0)
      expect(controller.visible()).toBe(false)

      dispose()
    })
  })

  test("re-arms after dismiss when a new update arrives (prompt self-healing)", () => {
    createRoot((dispose) => {
      const [needRefresh, setNeedRefresh] = createSignal(false)
      const controller = createPwaUpdateController({ needRefresh, update: () => {} })

      // First update cycle: SW reports a version, banner is armed → visible.
      setNeedRefresh(true)
      controller.notifyNeedRefresh()
      expect(controller.visible()).toBe(true)

      // User dismisses → hidden, but the pending-update signal stays true.
      controller.dismiss()
      expect(controller.visible()).toBe(false)

      // needRefresh toggling on its own must NOT re-show a dismissed banner.
      setNeedRefresh(false)
      expect(controller.visible()).toBe(false)

      // A genuinely new update fires onNeedRefresh again → re-armed → visible.
      setNeedRefresh(true)
      controller.notifyNeedRefresh()
      expect(controller.visible()).toBe(true)

      dispose()
    })
  })
})
