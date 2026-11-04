import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

/** Fits the location names, then the actions' details, before allowing the session title to truncate. */
export function createSessionHeaderFit() {
  const [store, setStore] = createStore({ collapse: 0, compact: false })
  let root!: HTMLDivElement
  // Compact actions drop their details, so their last expanded width is what expanding them again takes back.
  let expandedActions = 0

  onMount(() => {
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
      const projectWidth = project.getBoundingClientRect().width + gap
      const worktreeWidth = worktree ? worktree.getBoundingClientRect().width + gap : 0

      // Hidden labels retain their intrinsic width, so fitting never depends on a previous truncation.
      const expanded =
        location.getBoundingClientRect().width +
        (store.collapse >= 1 ? worktreeWidth : 0) +
        (store.collapse >= 2 ? projectWidth : 0)

      // Ancestors can fill the space a hidden name freed. Apply their cap to each reconstructed candidate.
      const max = getComputedStyle(location).maxInlineSize

      const limit =
        max === "none"
          ? Number.POSITIVE_INFINITY
          : Number.parseFloat(max) * (max.endsWith("%") ? root.getBoundingClientRect().width / 100 : 1)

      const children = [...title.children].filter(
        (element) => !element.matches(".session-header-title-measure") && getComputedStyle(element).display !== "none",
      )

      const titleWidth = children.reduce(
        (width, element) => {
          if (element.matches('[data-slot="session-header-gap"]')) return width

          if (element.matches("h1, input")) return width + measure.getBoundingClientRect().width
          const style = getComputedStyle(element)

          return (
            width +
            element.getBoundingClientRect().width +
            Number.parseFloat(style.marginInlineStart) +
            Number.parseFloat(style.marginInlineEnd)
          )
        },
        Math.max(0, children.length - 1) * Number.parseFloat(getComputedStyle(title).columnGap),
      )

      const actionsWidth = actions?.getBoundingClientRect().width ?? 0

      if (!store.compact) expandedActions = actionsWidth

      // Everything outside these two sections is reserved for actions, separators and their spacing. Candidates are
      // fitted against expanded actions, so compact actions expand again once the title fits beside them.
      const available =
        location.getBoundingClientRect().width +
        title.getBoundingClientRect().width -
        titleWidth -
        (store.compact ? Math.max(0, expandedActions - actionsWidth) : 0)

      const fits = (width: number) => Math.min(width, limit) <= available

      const collapse = fits(expanded) ? 0 : worktree && fits(expanded - worktreeWidth) ? 1 : 2
      setStore({
        collapse,
        compact: !!actions && collapse === 2 && !fits(expanded - worktreeWidth - projectWidth),
      })
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
      return store.collapse
    },
    /** The title does not fit even with the location collapsed, so the actions show without their details. */
    get compact() {
      return store.compact
    },
  }
}
