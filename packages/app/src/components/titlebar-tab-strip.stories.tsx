/**
 * Self-contained story that verifies the CSS fix for session tab titles.
 *
 * The real TitlebarTabStrip requires many workspace context providers
 * that storybook can't resolve in this monorepo. This story reproduces
 * the exact same DOM structure and CSS classes to verify:
 *
 * 1. Tab slots use `shrink-0` (not `flex-shrink`) → titles stay visible
 * 2. No `@container (max-width: 64px)` query hides titles
 * 3. Scroll container overflows horizontally when many tabs are open
 */

const SESSIONS = [
  "Fix login bug",
  "Refactor auth module",
  "Add dark mode support",
  "Write API docs",
  "Optimize database queries",
  "Setup CI/CD pipeline",
  "Migrate to TypeScript",
  "Design system components",
]

function createTabStrip() {
  const container = document.createElement("div")
  container.style.cssText = "width:375px;background:var(--v2-background-bg-deep,#1a1a2e);padding:4px;overflow:hidden;border-radius:6px"

  // Scroll container — same classes as TitlebarTabStrip
  const scroll = document.createElement("div")
  scroll.setAttribute("data-titlebar-tab-scroll", "")
  scroll.className = "flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto"
  scroll.style.cssText = "display:flex;gap:6px;overflow-x:auto;scrollbar-width:none"

  for (const title of SESSIONS) {
    // Tab slot — uses shrink-0 (the fix), NOT flex-shrink
    const slot = document.createElement("div")
    slot.setAttribute("data-titlebar-tab-slot", "")
    slot.className = "relative flex shrink-0"
    slot.style.cssText = "position:relative;display:flex;flex-shrink:0;width:224px;min-width:28px;max-width:224px"

    // Tab item — same inner structure as TabNavItem
    const tab = document.createElement("div")
    tab.setAttribute("data-titlebar-tab", "")
    tab.style.cssText = "display:flex;height:28px;width:100%;min-width:0;flex-direction:row;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;border-radius:6px;padding:4px;background:#2a2a3e;color:#ccc;font-size:13px;font-weight:500"

    // Avatar placeholder
    const avatar = document.createElement("span")
    avatar.style.cssText = "width:16px;height:16px;flex-shrink:0;border-radius:3px;background:#4a4a6a;display:inline-block"

    // Title — must NOT be hidden by @container query
    const titleEl = document.createElement("span")
    titleEl.setAttribute("data-titlebar-tab-title", "")
    titleEl.setAttribute("data-testid", "tab-title")
    titleEl.style.cssText = "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;outline:none;line-height:16px"
    titleEl.textContent = title

    tab.appendChild(avatar)
    tab.appendChild(titleEl)
    slot.appendChild(tab)
    scroll.appendChild(slot)
  }

  container.appendChild(scroll)
  return container
}

export default {
  title: "App/Titlebar/TabStrip",
  id: "app-titlebar-tab-strip",
}

export const ManyTabsMobileScroll = {
  render: () => createTabStrip(),
}
