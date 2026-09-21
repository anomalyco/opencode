import { Show, Suspense, lazy, onMount, onCleanup, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ExecutionModel } from "./model"
import type { ExecutionPresentation } from "./panel"

export function executionPresentation(input: { mobile: boolean; expanded: boolean }): ExecutionPresentation {
  if (input.mobile) return "mobile"
  return input.expanded ? "expanded" : "panel"
}

const LazyExecutionPanel = lazy(async () => {
  const { ExecutionPanel } = await import("./panel")
  return { default: ExecutionPanel }
})

export function createExecutionExpansion(input: {
  model: Accessor<ExecutionModel | undefined>
  key: Accessor<string | undefined>
  activeTab: Accessor<string | undefined>
  selectTab: (tab: string) => void
  panelWidth: Accessor<number>
  resizePanel: (width: number) => void
}) {
  let saved: { key: string; tab?: string; width: number; focus?: HTMLElement } | undefined
  const expand = () => {
    const model = input.model()
    if (!model || model.expanded()) return
    saved = {
      key: input.key() ?? "",
      tab: input.activeTab(),
      width: input.panelWidth(),
      focus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    }
    model.setExpanded(true)
  }
  const collapse = () => {
    const model = input.model()
    if (!model?.expanded()) return
    const target = saved
    saved = undefined
    model.setExpanded(false)
    if (!target || target.key !== (input.key() ?? "")) return
    if (target.tab !== undefined) input.selectTab(target.tab)
    input.resizePanel(target.width)
    returnFocus(target.focus)
  }
  return { expand, collapse }
}

function returnFocus(target: HTMLElement | undefined, attempt = 0) {
  const focus = target?.isConnected
    ? target
    : document.querySelector<HTMLElement>('[data-testid="execution-expand"]')
  if (focus) {
    focus.focus()
    return
  }
  if (attempt < 20 && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => returnFocus(target, attempt + 1))
  }
}

export function ExpandedExecution(props: { model: ExecutionModel; onClose: () => void }) {
  const language = useLanguage()
  const pending = () => props.model.attention().needsInput
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    const target = event.target
    if (target instanceof Element && target.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return
    event.preventDefault()
    props.onClose()
  }
  onMount(() => {
    document.addEventListener("keydown", onKeyDown)
  })
  onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  return (
    <section
      data-slot="execution-expanded"
      data-testid="execution-expanded"
      role="region"
      aria-label={language.t("execution.expanded.label")}
      class="execution-expanded"
    >
      <header data-slot="execution-expanded-header" class="execution-expanded__header">
        <h2 class="execution-expanded__title">{language.t("execution.expanded.title")}</h2>
        <span class="execution-expanded__spacer" aria-hidden />
        <Show when={pending() > 0}>
          <div
            data-slot="execution-pending-banner"
            data-testid="execution-pending-banner"
            class="execution-expanded__banner"
            role="status"
          >
            <span>{language.plural("execution.expanded.pending", pending())}</span>
            <button
              type="button"
              data-testid="execution-return-to-request"
              class="execution-expanded__action"
              onClick={() => props.model.reviewRequest()}
            >
              {language.t("execution.expanded.returnToRequest")}
            </button>
          </div>
        </Show>
        <button
          type="button"
          data-testid="execution-collapse"
          class="execution-expanded__action"
          aria-label={language.t("execution.collapse")}
          onClick={() => props.onClose()}
        >
          {language.t("execution.collapse.short")}
        </button>
      </header>
      <div data-slot="execution-expanded-body" class="execution-expanded__body">
        <Suspense
          fallback={
            <p class="execution-expanded__title" data-testid="execution-expanded-loading">
              {language.t("execution.loading")}
            </p>
          }
        >
          <LazyExecutionPanel model={props.model} presentation="expanded" />
        </Suspense>
      </div>
    </section>
  )
}
