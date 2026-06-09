import { createSignal } from "solid-js"
import { createComponent, Show, template } from "solid-js/web"
import { useRegisterSW } from "virtual:pwa-register/solid"

// Pre-compiled DOM templates — avoids JSX so this file works in bun test
// (bun test runner does not apply babel-preset-solid to tsx files).
const _banner = template(
  `<div role="status" aria-label="App update available" class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 shadow-lg"><span>A new version is available.</span><button type="button" class="rounded bg-neutral-700 px-2 py-1 text-xs font-medium hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500">Reload</button><button type="button" class="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-500">Dismiss</button></div>`,
)

export function PwaUpdatePrompt() {
  const [show, setShow] = createSignal(false)
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShow(true)
    },
  })

  const handleReload = () => {
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
    get children() {
      const _el = _banner.cloneNode(true) as HTMLDivElement
      const _buttons = _el.querySelectorAll("button")
      const _reloadBtn = _buttons[0] as HTMLButtonElement
      const _dismissBtn = _buttons[1] as HTMLButtonElement
      _reloadBtn.addEventListener("click", handleReload)
      _dismissBtn.addEventListener("click", handleDismiss)
      return _el
    },
  })
}
