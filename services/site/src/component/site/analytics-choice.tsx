import { createSignal, onMount, Show } from "solid-js"
import "./analytics-choice.css"

const YEAR_SECONDS = 31_536_000

/**
 * The Privacy Policy's on and off control for analytics in this browser. Off sets `oc_optout=1` for a year and
 * deletes the analytics cookies (at `/` and at `/console`, where older pages wrote them) and the day's reported
 * events in local storage; on deletes `oc_optout`. It writes the cookies itself, so it works without the tracker.
 * A browser with Global Privacy Control is always off, so it shows no button.
 */
export function AnalyticsChoice() {
  const [state, setState] = createSignal<"on" | "off" | "gpc">()
  onMount(() => setState(readState()))
  const toggle = () => {
    setAnalytics(state() === "off")
    setState(readState())
  }
  return (
    <Show when={state()}>
      {(current) => (
        <div data-slot="analytics-choice">
          <p role="status">
            {current() === "on"
              ? "Analytics are on in this browser."
              : current() === "off"
                ? "Analytics are off in this browser."
                : "Analytics are off in this browser because it sends a Global Privacy Control signal."}
          </p>
          <Show when={current() !== "gpc"}>
            <p>
              <button type="button" data-component="site-button" data-variant="neutral" onClick={toggle}>
                {current() === "on" ? "Turn off analytics" : "Turn on analytics"}
              </button>
            </p>
          </Show>
        </div>
      )}
    </Show>
  )
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
