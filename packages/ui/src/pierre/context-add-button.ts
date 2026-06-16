const plusSmall =
  '<path d="M9.99984 5.41699V10.0003M9.99984 10.0003V14.5837M9.99984 10.0003H5.4165M9.99984 10.0003H14.5832" stroke="currentColor" stroke-linecap="square"/>'

export const contextAddButtonStyle = {
  width: "20px",
  height: "20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: "var(--radius-md)",
  background: "var(--icon-interactive-base)",
  boxShadow: "var(--shadow-xs)",
  padding: "0",
  margin: "0",
  cursor: "pointer",
  "box-sizing": "border-box",
} as const

export function applyContextAddButtonStyle(button: HTMLButtonElement) {
  button.dataset.component = "context-add-button"
  Object.assign(button.style, contextAddButtonStyle)
}

export function mountContextAddIcon(button: HTMLButtonElement) {
  button.replaceChildren()
  const icon = document.createElement("div")
  icon.dataset.component = "icon"
  icon.dataset.size = "small"
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.dataset.slot = "icon-svg"
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = plusSmall
  icon.appendChild(svg)
  button.appendChild(icon)
}
