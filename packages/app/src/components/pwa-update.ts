import { createSignal } from "solid-js"

/**
 * Pure update-prompt logic for the PWA, extracted from `PwaUpdatePrompt.tsx`
 * so it can be unit-tested without rendering a SolidJS component.
 *
 * `bun test` does not apply the babel-preset-solid JSX transform and resolves
 * `solid-js/web` to its server stub, so rendering a real component in the test
 * runner is not viable. Following the repo's established pattern (e.g.
 * `updater-action.ts`), the decision logic lives in this zero-UI-import module
 * and `PwaUpdatePrompt.tsx` stays a thin idiomatic JSX wrapper around it.
 */

export interface PwaUpdateControllerOptions {
  /** Reactive accessor: has the service worker fetched a new version? */
  needRefresh: () => boolean
  /** Activate the waiting service worker and reload the page. */
  update: () => void
}

export interface PwaUpdateController {
  /** Whether the update banner should be visible. */
  visible: () => boolean
  /** Arm the banner — called when the SW reports a pending update. */
  notifyNeedRefresh: () => void
  /** Apply the update (activate the new SW + reload) and hide the banner. */
  reload: () => void
  /** Hide the banner without applying the update. */
  dismiss: () => void
}

export function createPwaUpdateController(options: PwaUpdateControllerOptions): PwaUpdateController {
  // `show` tracks whether the user has acknowledged the CURRENT pending update.
  // It re-arms on every `notifyNeedRefresh`, so a dismissed prompt reappears
  // when the SW reports a fresh version (registerType "prompt" self-healing).
  // The banner requires BOTH a pending update (needRefresh) AND an un-dismissed
  // state (show); removing either guard would break the visibility contract.
  const [show, setShow] = createSignal(false)

  return {
    visible: () => show() && options.needRefresh(),
    notifyNeedRefresh: () => setShow(true),
    reload: () => {
      options.update()
      setShow(false)
    },
    dismiss: () => setShow(false),
  }
}
