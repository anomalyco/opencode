// The agent's visible cursor. CDP input events are real but invisible, so before each pointer action
// the page draws a cursor that glides to the target and pulses on press. It lives in a closed shadow
// root on a pointer-events:none layer, so it never receives the input it illustrates, and a new
// document starts without it. Evaluated in the top frame; coordinates are top-viewport CSS pixels.
export const CURSOR = `function (x, y, press) {
  const id = "__opencode_browser_cursor__"
  let host = document.getElementById(id)
  if (!host || !host.__oe) {
    host?.remove()
    host = document.createElement("div")
    host.id = id
    host.setAttribute("style", "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict")
    const root = host.attachShadow({ mode: "closed" })
    root.innerHTML = \`<style>
      .c{position:absolute;left:0;top:0;transform:translate(calc(var(--x) - 3px),calc(var(--y) - 2px));transition:transform var(--d,0ms) cubic-bezier(.22,.8,.24,1),opacity .35s ease;will-change:transform}
      svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
      .l{position:absolute;left:17px;top:21px;padding:2px 7px;border-radius:999px;background:#131313;color:#fff;font:500 11px/16px -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      .r{position:absolute;left:-11px;top:-12px;width:28px;height:28px;border-radius:50%;border:2px solid #131313;opacity:0;pointer-events:none}
      .r.p{animation:p .5s ease-out}
      @keyframes p{from{opacity:.75;transform:scale(.25)}to{opacity:0;transform:scale(1.35)}}
    </style><div class="c"><span class="r"></span><svg width="20" height="22" viewBox="0 0 20 22"><path d="M3 2 L3 18.5 L7.4 14.3 L10.4 21 L13.4 19.6 L10.5 13.1 L16.6 13.1 Z" fill="#131313" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="l">opencode</span></div>\`
    document.documentElement.appendChild(host)
    const c = root.querySelector(".c")
    // Enter from the lower right, where the side panel sits, rather than appearing at the target.
    const start = { x: innerWidth - 24, y: innerHeight * 0.55 }
    c.style.setProperty("--x", start.x + "px")
    c.style.setProperty("--y", start.y + "px")
    void c.getBoundingClientRect()
    host.__oe = { c, r: root.querySelector(".r"), x: start.x, y: start.y, t: 0 }
  }
  const state = host.__oe
  const duration = Math.round(Math.min(650, Math.max(160, Math.hypot(x - state.x, y - state.y) * 0.8)))
  state.c.style.setProperty("--d", duration + "ms")
  state.c.style.setProperty("--x", x + "px")
  state.c.style.setProperty("--y", y + "px")
  state.c.style.opacity = "1"
  state.x = x
  state.y = y
  clearTimeout(state.t)
  state.t = setTimeout(() => { state.c.style.opacity = "0" }, 6000)
  return new Promise((resolve) => setTimeout(() => {
    if (press) {
      state.r.classList.remove("p")
      void state.r.offsetWidth
      state.r.classList.add("p")
    }
    resolve(true)
  }, duration))
}`
