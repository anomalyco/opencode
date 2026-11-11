import "./analytics-choice.css"

const YEAR_SECONDS = 31_536_000

const status = {
  on: "Analytics are on in this browser.",
  off: "Analytics are off in this browser.",
  gpc: "Analytics are off in this browser because it sends a Global Privacy Control signal.",
}

/**
 * The Privacy Policy's on and off control for analytics in this browser, rendered into `host` in the
 * browser only (legal.tsx, and src/client/islands/legal.ts on the static page). Off sets `oc_optout=1`
 * for a year and deletes the analytics cookies (at `/` and at `/console`, where older pages wrote them)
 * and the day's reported events in local storage; on deletes `oc_optout`. It writes the cookies itself,
 * so it works without the tracker. A browser with Global Privacy Control is always off, so it shows no
 * button.
 */
export function analyticsChoice(host: HTMLElement) {
  const gpc = readState() === "gpc"
  host.innerHTML = `<div data-slot="analytics-choice"><p role="status"></p>${
    gpc ? "" : '<p><button type="button" data-component="site-button" data-variant="neutral"></button></p>'
  }</div>`
  const line = host.querySelector("p")!
  const button = host.querySelector("button")
  const show = () => {
    const state = readState()
    line.textContent = status[state]
    if (button) button.textContent = state === "on" ? "Turn off analytics" : "Turn on analytics"
  }
  button?.addEventListener("click", () => {
    setAnalytics(readState() === "off")
    show()
  })
  show()
}

function readState() {
  if ("globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true) return "gpc"
  return document.cookie.split(";").some((part) => part.trim() === "oc_optout=1") ? "off" : "on"
}

function setAnalytics(on: boolean) {
  const secure = location.protocol === "https:" ? "; Secure" : ""
  if (on) {
    document.cookie = `oc_optout=; Path=/; SameSite=Lax; Max-Age=0${secure}`
    return
  }
  const cookies = [
    `oc_optout=1; Path=/; SameSite=Lax; Max-Age=${YEAR_SECONDS}${secure}`,
    ...["oc_vid", "oc_sid", "oc_attr"].flatMap((name) =>
      ["/", "/console"].map((path) => `${name}=; Path=${path}; SameSite=Lax; Max-Age=0${secure}`),
    ),
  ]
  cookies.forEach((cookie) => {
    document.cookie = cookie
  })
  try {
    localStorage.removeItem("opencode-console.funnel.seen")
  } catch {
    // Storage the browser refuses holds nothing to clear.
  }
}
