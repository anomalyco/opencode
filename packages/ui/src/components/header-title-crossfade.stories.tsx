// @ts-nocheck
import { createSignal, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { animate, type AnimationPlaybackControls, GROW_SPRING } from "./motion"
import { TextReveal } from "./text-reveal"

export default {
  title: "UI/HeaderTitleCrossfade",
  id: "components-header-title-crossfade",
}

const TITLES = [
  "New session",
  "Pickles conversation idea",
  "Refactor ToolStatusTitle DOM measurement to use contentWidth helper",
  "Fix bug",
  "New session",
  "Understanding the codebase architecture and making improvements",
]

const btn = (accent?: boolean) =>
  ({
    padding: "5px 12px",
    "border-radius": "6px",
    border: accent ? "1px solid #58f" : "1px solid #444",
    background: accent ? "#58f" : "#222",
    color: "#eee",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

const TITLE_SPRING = { ...GROW_SPRING, visualDuration: 0.35, bounce: 0 }

// ─── Shared wrapper ───────────────────────────────────────────────

function TitleFrame(props: { label: string; children: any }) {
  return (
    <div style={{ display: "grid", gap: "4px", padding: "16px 20px", border: "1px solid #333", "border-radius": "10px", background: "#1a1a1a" }}>
      <span style={{ "font-size": "11px", "font-family": "monospace", color: "#666" }}>{props.label}</span>
      <div class="flex items-center h-12 min-w-0 max-w-[500px]">
        <h1 class="text-14-medium text-text-strong min-w-0 flex-1 pl-2">
          {props.children}
        </h1>
      </div>
    </div>
  )
}

// ─── Approach 1: Explicit keyframe arrays with animate() ──────────

function CrossfadeExplicitKeyframes(props: { text: () => string; muted: () => boolean }) {
  let enterRef: HTMLSpanElement | undefined
  let leaveRef: HTMLSpanElement | undefined
  let enterAnim: AnimationPlaybackControls | undefined
  let leaveAnim: AnimationPlaybackControls | undefined

  const [cur, setCur] = createSignal(props.text())
  const [curMuted, setCurMuted] = createSignal(props.muted())
  const [prev, setPrev] = createSignal<string | undefined>()
  const [prevMuted, setPrevMuted] = createSignal(false)

  const clearEnter = () => {
    if (!enterRef) return
    enterRef.style.opacity = ""
    enterRef.style.transform = ""
  }

  const hideLeave = () => {
    if (!leaveRef) return
    leaveRef.style.opacity = "0"
    leaveRef.style.transform = ""
  }

  createEffect(
    on(
      () => [props.text(), props.muted()] as const,
      ([nextText, nextMuted], prevTuple) => {
        if (!prevTuple) {
          setCur(nextText)
          setCurMuted(nextMuted)
          if (enterRef) {
            enterAnim?.stop()
            enterAnim = animate(enterRef, { opacity: [0, 1], transform: ["translateY(-2px)", "translateY(0)"] }, TITLE_SPRING)
            enterAnim.finished.then(clearEnter)
          }
          return
        }
        if (nextText === prevTuple[0]) {
          setCurMuted(nextMuted)
          return
        }

        enterAnim?.stop()
        leaveAnim?.stop()

        setPrev(cur())
        setPrevMuted(curMuted())
        setCur(nextText)
        setCurMuted(nextMuted)

        if (leaveRef) {
          leaveRef.style.opacity = "1"
          leaveAnim = animate(leaveRef, { opacity: [1, 0], transform: ["translateY(0)", "translateY(2px)"] }, TITLE_SPRING)
          leaveAnim.finished.then(() => {
            setPrev(undefined)
            setPrevMuted(false)
            hideLeave()
          })
        }

        if (enterRef) {
          enterAnim = animate(enterRef, { opacity: [0, 1], transform: ["translateY(-2px)", "translateY(0)"] }, TITLE_SPRING)
          enterAnim.finished.then(clearEnter)
        }
      },
    ),
  )

  onCleanup(() => {
    enterAnim?.stop()
    leaveAnim?.stop()
  })

  return (
    <span class="grid min-w-0" style={{ overflow: "clip" }}>
      <span ref={enterRef} class="col-start-1 row-start-1 min-w-0 truncate">
        <span classList={{ "opacity-60": curMuted() }}>{cur()}</span>
      </span>
      <span ref={leaveRef} class="col-start-1 row-start-1 min-w-0 truncate pointer-events-none" style={{ opacity: "0" }}>
        <span classList={{ "opacity-60": prevMuted() }}>{prev()}</span>
      </span>
    </span>
  )
}

// ─── Approach 2: TextReveal component ─────────────────────────────

function CrossfadeTextReveal(props: { text: () => string; muted: () => boolean }) {
  return (
    <span classList={{ "opacity-60": props.muted() }}>
      <TextReveal text={props.text()} growOnly={false} duration={400} travel={0} edge={17} />
    </span>
  )
}

// ─── Approach 3: CSS transitions (data-swapping toggle) ───────────

function CrossfadeCSSTransitions(props: { text: () => string; muted: () => boolean }) {
  const [cur, setCur] = createSignal(props.text())
  const [curMuted, setCurMuted] = createSignal(props.muted())
  const [prev, setPrev] = createSignal<string | undefined>()
  const [prevMuted, setPrevMuted] = createSignal(false)
  const [swapping, setSwapping] = createSignal(false)
  let frame: number | undefined

  createEffect(
    on(
      () => [props.text(), props.muted()] as const,
      ([nextText, nextMuted], prevTuple) => {
        if (!prevTuple) {
          setCur(nextText)
          setCurMuted(nextMuted)
          setSwapping(true)
          if (frame !== undefined) cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => {
            setSwapping(false)
            frame = undefined
          })
          return
        }
        if (nextText === prevTuple[0]) {
          setCurMuted(nextMuted)
          return
        }

        if (frame !== undefined) cancelAnimationFrame(frame)

        setPrev(cur())
        setPrevMuted(curMuted())
        setCur(nextText)
        setCurMuted(nextMuted)

        // snap to swapping state (instant)
        setSwapping(true)

        // next frame: remove swapping, CSS transitions animate
        frame = requestAnimationFrame(() => {
          setSwapping(false)
          frame = undefined
        })
      },
    ),
  )

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  const duration = "350ms"
  const easing = "cubic-bezier(0.34, 1.08, 0.64, 1)"

  return (
    <span class="grid min-w-0" style={{ overflow: "clip" }}>
      {/* Entering span */}
      <span
        class="col-start-1 row-start-1 min-w-0 truncate"
        style={{
          opacity: swapping() ? "0" : "1",
          transform: swapping() ? "translateY(-2px)" : "translateY(0)",
          "transition-property": swapping() ? "none" : "opacity, transform",
          "transition-duration": duration,
          "transition-timing-function": easing,
        }}
      >
        <span classList={{ "opacity-60": curMuted() }}>{cur()}</span>
      </span>
      {/* Leaving span */}
      <span
        class="col-start-1 row-start-1 min-w-0 truncate pointer-events-none"
        style={{
          opacity: swapping() ? "1" : "0",
          transform: swapping() ? "translateY(0)" : "translateY(2px)",
          "transition-property": swapping() ? "none" : "opacity, transform",
          "transition-duration": duration,
          "transition-timing-function": easing,
        }}
      >
        <span classList={{ "opacity-60": prevMuted() }}>{prev()}</span>
      </span>
    </span>
  )
}

// ─── Approach 4: Raw WAAPI (element.animate()) ────────────────────

function CrossfadeWAAPI(props: { text: () => string; muted: () => boolean }) {
  let enterRef: HTMLSpanElement | undefined
  let leaveRef: HTMLSpanElement | undefined
  let enterAnim: Animation | undefined
  let leaveAnim: Animation | undefined

  const [cur, setCur] = createSignal(props.text())
  const [curMuted, setCurMuted] = createSignal(props.muted())
  const [prev, setPrev] = createSignal<string | undefined>()
  const [prevMuted, setPrevMuted] = createSignal(false)

  const wapiOpts: KeyframeAnimationOptions = {
    duration: 350,
    easing: "cubic-bezier(0.34, 1.08, 0.64, 1)",
    fill: "none" as const,
  }

  const clearStyles = (el: HTMLElement) => {
    el.style.opacity = ""
    el.style.transform = ""
  }

  createEffect(
    on(
      () => [props.text(), props.muted()] as const,
      ([nextText, nextMuted], prevTuple) => {
        if (!prevTuple) {
          setCur(nextText)
          setCurMuted(nextMuted)
          if (enterRef) {
            enterRef.style.opacity = "1"
            enterRef.style.transform = "translateY(0)"
            enterAnim?.cancel()
            enterAnim = enterRef.animate(
              [
                { opacity: 0, transform: "translateY(-2px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
              wapiOpts,
            )
            enterAnim.onfinish = () => clearStyles(enterRef!)
          }
          return
        }
        if (nextText === prevTuple[0]) {
          setCurMuted(nextMuted)
          return
        }

        enterAnim?.cancel()
        leaveAnim?.cancel()

        setPrev(cur())
        setPrevMuted(curMuted())
        setCur(nextText)
        setCurMuted(nextMuted)

        if (leaveRef) {
          leaveRef.style.opacity = "0"
          leaveAnim = leaveRef.animate(
            [
              { opacity: 1, transform: "translateY(0)" },
              { opacity: 0, transform: "translateY(2px)" },
            ],
            wapiOpts,
          )
          leaveAnim.onfinish = () => {
            setPrev(undefined)
            setPrevMuted(false)
            if (leaveRef) leaveRef.style.opacity = "0"
          }
        }

        if (enterRef) {
          enterRef.style.opacity = "1"
          enterRef.style.transform = "translateY(0)"
          enterAnim = enterRef.animate(
            [
              { opacity: 0, transform: "translateY(-2px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            wapiOpts,
          )
          enterAnim.onfinish = () => clearStyles(enterRef!)
        }
      },
    ),
  )

  onCleanup(() => {
    enterAnim?.cancel()
    leaveAnim?.cancel()
  })

  return (
    <span class="grid min-w-0" style={{ overflow: "clip" }}>
      <span ref={enterRef} class="col-start-1 row-start-1 min-w-0 truncate">
        <span classList={{ "opacity-60": curMuted() }}>{cur()}</span>
      </span>
      <span ref={leaveRef} class="col-start-1 row-start-1 min-w-0 truncate pointer-events-none" style={{ opacity: "0" }}>
        <span classList={{ "opacity-60": prevMuted() }}>{prev()}</span>
      </span>
    </span>
  )
}

// ─── Approach 5: Chained animate() calls ──────────────────────────

function CrossfadeChained(props: { text: () => string; muted: () => boolean }) {
  let enterRef: HTMLSpanElement | undefined
  let leaveRef: HTMLSpanElement | undefined
  let enterAnim: AnimationPlaybackControls | undefined
  let leaveAnim: AnimationPlaybackControls | undefined
  let snapAnim: AnimationPlaybackControls | undefined

  const [cur, setCur] = createSignal(props.text())
  const [curMuted, setCurMuted] = createSignal(props.muted())
  const [prev, setPrev] = createSignal<string | undefined>()
  const [prevMuted, setPrevMuted] = createSignal(false)

  const clearEnter = () => {
    if (!enterRef) return
    enterRef.style.opacity = ""
    enterRef.style.transform = ""
  }

  const hideLeave = () => {
    if (!leaveRef) return
    leaveRef.style.opacity = "0"
    leaveRef.style.transform = ""
  }

  createEffect(
    on(
      () => [props.text(), props.muted()] as const,
      ([nextText, nextMuted], prevTuple) => {
        if (!prevTuple) {
          setCur(nextText)
          setCurMuted(nextMuted)
          if (enterRef) {
            enterAnim?.stop()
            snapAnim?.stop()
            // snap to hidden, then animate to visible
            snapAnim = animate(enterRef, { opacity: 0, transform: "translateY(-2px)" }, { duration: 0 })
            snapAnim.finished.then(() => {
              enterAnim = animate(enterRef!, { opacity: 1, transform: "translateY(0)" }, TITLE_SPRING)
              enterAnim.finished.then(clearEnter)
            })
          }
          return
        }
        if (nextText === prevTuple[0]) {
          setCurMuted(nextMuted)
          return
        }

        enterAnim?.stop()
        leaveAnim?.stop()
        snapAnim?.stop()

        setPrev(cur())
        setPrevMuted(curMuted())
        setCur(nextText)
        setCurMuted(nextMuted)

        // fade out leave
        if (leaveRef) {
          leaveRef.style.opacity = "1"
          leaveRef.style.transform = "translateY(0)"
          leaveAnim = animate(leaveRef, { opacity: 0, transform: "translateY(2px)" }, TITLE_SPRING)
          leaveAnim.finished.then(() => {
            setPrev(undefined)
            setPrevMuted(false)
            hideLeave()
          })
        }

        // snap enter to hidden (updates MotionValue to 0), then animate to visible
        if (enterRef) {
          snapAnim = animate(enterRef, { opacity: 0, transform: "translateY(-2px)" }, { duration: 0 })
          snapAnim.finished.then(() => {
            enterAnim = animate(enterRef!, { opacity: 1, transform: "translateY(0)" }, TITLE_SPRING)
            enterAnim.finished.then(clearEnter)
          })
        }
      },
    ),
  )

  onCleanup(() => {
    enterAnim?.stop()
    leaveAnim?.stop()
    snapAnim?.stop()
  })

  return (
    <span class="grid min-w-0" style={{ overflow: "clip" }}>
      <span ref={enterRef} class="col-start-1 row-start-1 min-w-0 truncate">
        <span classList={{ "opacity-60": curMuted() }}>{cur()}</span>
      </span>
      <span ref={leaveRef} class="col-start-1 row-start-1 min-w-0 truncate pointer-events-none" style={{ opacity: "0" }}>
        <span classList={{ "opacity-60": prevMuted() }}>{prev()}</span>
      </span>
    </span>
  )
}

// ─── Approach 6: Fade-in only (single span) ──────────────────────

function CrossfadeFadeInOnly(props: { text: () => string; muted: () => boolean }) {
  let ref: HTMLSpanElement | undefined
  let anim: AnimationPlaybackControls | undefined

  const clearStyles = () => {
    if (!ref) return
    ref.style.opacity = ""
    ref.style.transform = ""
  }

  createEffect(
    on(
      () => props.text(),
      (_next, prev) => {
        if (!ref) return
        anim?.stop()
        if (prev !== undefined) {
          // text changed — fade in
          anim = animate(ref, { opacity: [0, 1], transform: ["translateY(-2px)", "translateY(0)"] }, TITLE_SPRING)
          anim.finished.then(clearStyles)
        } else {
          // initial mount — fade in
          anim = animate(ref, { opacity: [0, 1], transform: ["translateY(-2px)", "translateY(0)"] }, TITLE_SPRING)
          anim.finished.then(clearStyles)
        }
      },
    ),
  )

  onCleanup(() => {
    anim?.stop()
  })

  return (
    <span class="min-w-0 truncate" ref={ref}>
      <span classList={{ "opacity-60": props.muted() }}>{props.text()}</span>
    </span>
  )
}

// ─── Story ────────────────────────────────────────────────────────

export const Playground = {
  render: () => {
    const [index, setIndex] = createSignal(0)
    const [cycling, setCycling] = createSignal(false)
    let timer: number | undefined

    const title = createMemo(() => TITLES[index()])
    const muted = createMemo(() => title() === "New session")
    const next = () => setIndex((i) => (i + 1) % TITLES.length)

    const toggleCycle = () => {
      if (cycling()) {
        if (timer) clearTimeout(timer)
        timer = undefined
        setCycling(false)
        return
      }
      setCycling(true)
      const tick = () => {
        next()
        timer = window.setTimeout(tick, 1200 + Math.floor(Math.random() * 800))
      }
      timer = window.setTimeout(tick, 1200)
    }

    onCleanup(() => {
      if (timer) clearTimeout(timer)
    })

    return (
      <div style={{ display: "grid", gap: "24px", padding: "20px", "max-width": "700px" }}>
        <TitleFrame label="1. Explicit keyframe arrays — animate(el, { opacity: [0, 1] })">
          <CrossfadeExplicitKeyframes text={title} muted={muted} />
        </TitleFrame>

        <TitleFrame label="2. TextReveal component (CSS mask-position wipe)">
          <CrossfadeTextReveal text={title} muted={muted} />
        </TitleFrame>

        <TitleFrame label="3. CSS transitions (data-swapping toggle)">
          <CrossfadeCSSTransitions text={title} muted={muted} />
        </TitleFrame>

        <TitleFrame label="4. Raw WAAPI — element.animate()">
          <CrossfadeWAAPI text={title} muted={muted} />
        </TitleFrame>

        <TitleFrame label="5. Chained animate() calls (snap to 0, then spring to 1)">
          <CrossfadeChained text={title} muted={muted} />
        </TitleFrame>

        <TitleFrame label="6. Fade-in only (single span, no crossfade)">
          <CrossfadeFadeInOnly text={title} muted={muted} />
        </TitleFrame>

        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          {TITLES.map((t, i) => (
            <button onClick={() => setIndex(i)} style={btn(index() === i)}>
              {t.length > 30 ? t.slice(0, 30) + "..." : t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={next} style={btn()}>Next</button>
          <button onClick={toggleCycle} style={btn(cycling())}>
            {cycling() ? "Stop cycle" : "Auto cycle"}
          </button>
        </div>

        <div style={{ "font-size": "11px", color: "#888", "font-family": "monospace" }}>
          title: {title()} · muted: {muted() ? "yes" : "no"}
        </div>
      </div>
    )
  },
}
