import { createSignal } from "solid-js"
import { createComponent, Show, template } from "solid-js/web"
import { useRegisterSW } from "virtual:pwa-register/solid"

// Pre-compiled DOM templates — avoids JSX so this file works in bun test
// (bun test runner does not apply babel-preset-solid to tsx files).
const _banner = template(
  `<div role="status" aria-label="App update available" class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border-base bg-surface-raised-stronger-non-alpha px-4 py-3 text-sm text-text-strong shadow-[var(--shadow-lg-border-base)]"><span>A new version is available.</span><button type="button" class="rounded bg-surface-base px-2 py-1 text-xs font-medium hover:bg-surface-raised-base-hover focus:outline-none">Reload</button><button type="button" class="rounded px-2 py-1 text-xs text-text-weak hover:text-text-base focus:outline-none">Dismiss</button></div>`,
)

export function PwaUpdatePrompt() {
  const [show, setShow] = createSignal(false)
  const { needRefresh: needRefreshSignal, updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShow(true)
    },
    onRegisterError() {
      // SW registration or update failed — keep the banner visible for retry
      setShow(true)
    },
  })
  const [needRefresh] = needRefreshSignal

  const handleReload = () => {
    // Optimistically hide the banner; onRegisterError will restore it if the update fails
    updateServiceWorker?.(true)
    setShow(false)
  }

  const handleDismiss = () => {
    setShow(false)
  }

  return createComponent(Show, {
    get when() {
      return show() && needRefresh()
    },
    get children(): HTMLDivElement {
      const _el = _banner() as HTMLDivElement
      const _buttons = _el.querySelectorAll("button")
      const _reloadBtn = _buttons[0] as HTMLButtonElement
      const _dismissBtn = _buttons[1] as HTMLButtonElement
      _reloadBtn.addEventListener("click", handleReload)
      _dismissBtn.addEventListener("click", handleDismiss)
      return _el
    },
  } as Parameters<typeof Show>[0])
}
