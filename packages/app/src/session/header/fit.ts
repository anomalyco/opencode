import { createSignal, onCleanup, onMount, untrack } from "solid-js"
import {
  headerFitCollapse,
  headerFitCompact,
  INITIAL_HEADER_FIT_STATE,
  transitionHeaderFit,
  type HeaderFitState,
} from "./fit-machine"

/** Fits the location names, then the actions' details, before allowing the session title to truncate. */
export function createSessionHeaderFit() {
  const [state, setState] = createSignal<HeaderFitState>(INITIAL_HEADER_FIT_STATE)
  let root!: HTMLDivElement

  onMount(() => {
    // Reused on every pass: fitting runs on each resize of the header.
    const measured = {
      type: "measured" as const,
      locationWidth: 0,
      titleBoxWidth: 0,
      titleWidth: 0,
      projectWidth: 0,
      worktreeWidth: 0,
      hasWorktree: false,
      limit: 0,
      hasActions: false,
      actionsWidth: 0,
    }

    const settled = { type: "compact.settled" as const, actionsWidth: 0 }

    const fit = () => {
      const location = root.querySelector<HTMLElement>(".session-header-location")
      const title = root.querySelector<HTMLElement>(".session-header-title")
      const measure = root.querySelector<HTMLElement>(".session-header-title-measure > span")
      const actions = root.querySelector<HTMLElement>(".session-header-actions")
      const trigger = root.querySelector<HTMLElement>('[data-slot="session-location-trigger"]')
      const project = trigger?.querySelector<HTMLElement>('[data-slot="session-location-project"]')
      const worktree = trigger?.querySelector<HTMLElement>('[data-slot="session-location-worktree"]')

      if (!location || !title || !measure || !trigger || !project || !root.clientWidth) return

      const gap = Number.parseFloat(getComputedStyle(trigger).columnGap)
      // Ancestors can fill the space a hidden name freed. Apply their cap to each reconstructed candidate.
      const max = getComputedStyle(location).maxInlineSize

      measured.locationWidth = location.getBoundingClientRect().width
      measured.titleBoxWidth = title.getBoundingClientRect().width
      measured.titleWidth = measureTitleWidth(title, measure)
      measured.projectWidth = project.getBoundingClientRect().width + gap
      measured.worktreeWidth = worktree ? worktree.getBoundingClientRect().width + gap : 0
      measured.hasWorktree = !!worktree
      measured.limit =
        max === "none"
          ? Number.POSITIVE_INFINITY
          : Number.parseFloat(max) * (max.endsWith("%") ? root.getBoundingClientRect().width / 100 : 1)
      measured.hasActions = !!actions
      measured.actionsWidth = actions?.getBoundingClientRect().width ?? 0

      const current = untrack(state)
      const next = transitionHeaderFit(current, measured)

      if (next === current) return
      // Compact actions render synchronously, so measuring them now records what compacting freed, even when no
      // observer would fire again.
      setState(next)

      if (next.status !== "compact" || next.expandedWidth === undefined) return
      settled.actionsWidth = actions?.getBoundingClientRect().width ?? 0
      setState(transitionHeaderFit(next, settled))
    }

    const resize = new ResizeObserver(fit)

    const observe = () => {
      resize.disconnect()
      resize.observe(root)
      root
        .querySelectorAll(
          ".session-header-location, .session-location-label, .session-header-title > *, .session-header-title-measure > span, .session-header-actions",
        )
        .forEach((element) => resize.observe(element))
      fit()
    }

    // Conditional controls and the rename field can mount without resizing the container itself.
    const mutation = new MutationObserver(observe)
    mutation.observe(root, { childList: true, subtree: true })
    observe()
    onCleanup(() => {
      resize.disconnect()
      mutation.disconnect()
    })
  })

  return {
    ref: (element: HTMLDivElement) => (root = element),
    get collapse() {
      return headerFitCollapse(state())
    },
    /** The title does not fit even with the location collapsed, so the actions show without their details. */
    get compact() {
      return headerFitCompact(state())
    },
  }
}

// What the title section's visible content needs, with the title at its full width.
function measureTitleWidth(title: HTMLElement, measure: HTMLElement) {
  let width = 0
  let count = 0

  for (let element = title.firstElementChild; element; element = element.nextElementSibling) {
    if (element.matches(".session-header-title-measure")) continue
    const style = getComputedStyle(element)

    if (style.display === "none") continue
    count++

    if (element.matches('[data-slot="session-header-gap"]')) continue

    if (element.matches("h1, input")) {
      width += measure.getBoundingClientRect().width
      continue
    }

    width +=
      element.getBoundingClientRect().width +
      Number.parseFloat(style.marginInlineStart) +
      Number.parseFloat(style.marginInlineEnd)
  }

  return width + Math.max(0, count - 1) * Number.parseFloat(getComputedStyle(title).columnGap)
}
