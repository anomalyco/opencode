let injected = false

export function injectSecurityBadgeStyles(): void {
  if (injected || typeof document == "undefined") return
  const style = document.createElement("style")
  style.setAttribute("data-fork-ui", "security-badge")
  style.textContent = `:root {
  --fork-security-badge-icon-color: currentColor;
}

.security-badge-icon [data-slot="icon-svg"] {
  color: var(--fork-security-badge-icon-color);
}
`
  document.head.appendChild(style)
  injected = true
}
