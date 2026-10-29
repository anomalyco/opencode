import { Schema } from "effect"

// Runs in the app's window from the first line of its document. It records the moment each onboarding state first
// appears, so a state that lasts a single frame (the splash, the working indicator) is not missed between polls.
// It only reads the DOM; it never changes what the user sees.
export const PROBE = `(() => {
  if (window.__onboarding) return
  const seen = {}
  const facts = {}
  const mark = (name) => { if (seen[name] === undefined) seen[name] = Date.now() }
  const q = (selector) => document.querySelector(selector)
  let overlaySeen = false
  // The app mounts its first route under the splash, so a view only counts once the splash has started to leave.
  const visible = (selector) => [...document.querySelectorAll(selector)].some((element) => element.checkVisibility())
  const check = () => {
    if (q('[data-component="first-launch-splash"]')) mark("splash")
    if (q('[data-component="startup-splash"]')) mark("plainSplash")
    const overlay = q('[data-component="startup-overlay"]')
    if (overlay) overlaySeen = true
    const home = visible('[data-action="home-new-session"], [data-action="home-add-project-row"]')
    const newSession = visible('[data-component="new-session"]')
    if (overlay && overlay.classList.contains("opacity-0") && seen.handoff === undefined) {
      mark("handoff")
      const animation = q('[data-component="first-launch-splash"] path')?.getAnimations()[0]
      facts.drawnAtHandoff = animation ? animation.effect.getComputedTiming().progress : null
      facts.viewAtHandoff = newSession ? "new session" : home ? "home" : "neither"
    }
    if (overlaySeen && !overlay) mark("overlayGone")
    const revealed = seen.handoff !== undefined || seen.overlayGone !== undefined
    if (revealed && home) mark("home")
    if (revealed && newSession) mark("newSession")
    const editor = q('[data-component="composer-editor"]')
    const active = document.activeElement
    if (editor && active && (editor === active || editor.contains(active))) mark("composerFocus")
    if (q('[data-component="user-message"]')) {
      mark("userMessage")
      if (q('[data-component="session-working"], [data-component="session-progress-indicator-v2"]')) mark("working")
      const replied = [...document.querySelectorAll('[data-component="text-part"]')].some(
        (part) => !part.closest('[data-component="user-message"]') && part.textContent.trim(),
      )
      if (replied) mark("reply")
    }
    if (q('[data-kind="session-error-card"], [data-kind="session-retry-card"]')) mark("error")
  }
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  document.addEventListener("animationstart", (event) => {
    if (event.animationName === "first-launch-wordmark-draw") mark("drawStart")
  }, true)
  document.addEventListener("animationend", (event) => {
    if (event.animationName === "first-launch-wordmark-draw") mark("drawEnd")
  }, true)
  document.addEventListener("focusin", check, true)
  window.__onboarding = { seen, facts, check, installedAt: Date.now(), early: !document.body }
  check()
})()`

const moment = Schema.optional(Schema.Number)

export const Snapshot = Schema.Struct({
  // When each state first appeared (epoch ms).
  seen: Schema.Struct({
    splash: moment,
    plainSplash: moment,
    handoff: moment,
    overlayGone: moment,
    home: moment,
    newSession: moment,
    composerFocus: moment,
    userMessage: moment,
    working: moment,
    reply: moment,
    error: moment,
    drawStart: moment,
    drawEnd: moment,
  }),
  facts: Schema.Struct({
    drawnAtHandoff: Schema.optional(Schema.NullOr(Schema.Number)),
    viewAtHandoff: Schema.optional(Schema.String),
  }),
  installedAt: moment,
  early: Schema.optional(Schema.Boolean),
  editorText: Schema.String,
  model: Schema.String,
  reply: Schema.String,
  error: Schema.String,
  userMessages: Schema.Number,
  working: Schema.Boolean,
  url: Schema.String,
})

export type Snapshot = typeof Snapshot.Type

// Read on every poll: what the probe saw so far, plus the live text the report quotes.
export const SNAPSHOT = `(() => {
  const probe = window.__onboarding ?? { seen: {}, facts: {} }
  probe.check?.()
  const q = (selector) => document.querySelector(selector)
  const replies = [...document.querySelectorAll('[data-component="text-part"]')]
    .filter((part) => !part.closest('[data-component="user-message"]'))
    .map((part) => (part.querySelector('[data-slot="text-part-body"]') ?? part).textContent.trim())
    .filter(Boolean)
  return {
    seen: probe.seen,
    facts: probe.facts,
    installedAt: probe.installedAt,
    early: probe.early,
    editorText: q('[data-component="composer-editor"]')?.textContent ?? "",
    model: q('[data-action="composer-model"]')?.textContent?.trim() ?? "",
    reply: replies.join("\\n").slice(0, 2000),
    error: q('[data-kind="session-error-card"], [data-kind="session-retry-card"]')?.textContent?.trim().slice(0, 500) ?? "",
    userMessages: document.querySelectorAll('[data-component="user-message"]').length,
    working: !!q('[data-component="session-working"], [data-component="session-progress-indicator-v2"]'),
    url: location.href,
  }
})()`
