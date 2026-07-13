const HOME_SCROLL_EXCLUDED = [
  '[data-component="home-session-search"][data-open]',
  '[data-component="menu-v2-content"]',
  '[data-component="dropdown-menu-content"]',
  '[data-component="dropdown-menu-sub-content"]',
  '[data-component="context-menu-content"]',
  '[data-component="context-menu-sub-content"]',
  '[data-component="popover-content"]',
  '[data-component="select-content"]',
  '[data-component="dialog"]',
  '[data-component="dialog-v2"]',
  '[data-component="dialog-overlay"]',
].join(",")

const HOME_SCROLL_INTERACTIVE = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="menuitem"]',
].join(",")

export function shouldBlockHomeWheel(input: {
  target: EventTarget | null
  viewport: HTMLElement
  deltaY: number
  ctrlKey: boolean
  defaultPrevented: boolean
}) {
  if (input.defaultPrevented || input.ctrlKey || !input.deltaY) return false
  if (!(input.target instanceof Element)) return false

  const scrollable = input.target.closest<HTMLElement>("[data-scrollable]")
  const canScroll =
    scrollable !== input.viewport &&
    scrollable &&
    (input.deltaY < 0
      ? scrollable.scrollTop > 0
      : scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight)
  if (input.target.closest(HOME_SCROLL_EXCLUDED)) return !canScroll

  if (scrollable !== input.viewport && scrollable && scrollable.scrollHeight > scrollable.clientHeight) return !canScroll
  if (input.target.closest('[data-component="home-session-row"]')) return false
  return !!input.target.closest(HOME_SCROLL_INTERACTIVE)
}
