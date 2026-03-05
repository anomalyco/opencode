// @ts-nocheck
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { GrowBox } from "./grow-box"
import { animate, type AnimationPlaybackControls } from "./motion"

export default {
  title: "UI/GrowBox Edge Mask",
  id: "components-grow-box-edge-mask",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Playground for the assistant timeline edge case where text streams faster than GrowBox can settle.

Compares three modes side-by-side:
- hard edge (no mask)
- release mask (fade while streaming, then shifts down to reveal full text when done)
- fade-only completion (fade while streaming, then only opacity fades out on finish)

Uses the motion spring API for the release animation.`,
      },
    },
  },
}

const LINES = [
  "Planning recursive page file read strategy across route and message components.",
  "Checking how context tools group during streaming in AssistantParts.",
  "Reviewing GrowBox resize watcher behavior under frequent content updates.",
  "Measuring where clipping produces a hard lower boundary during expansion.",
  "Trying a bottom linear fade to smooth the active growth edge.",
  "Validating transition from streaming state to settled fully-visible content.",
  "Comparing static mask versus release-down mask interaction.",
  "Testing rapid chunk delivery to force overlapping spring updates.",
  "Ensuring final frame does not hide any trailing text after completion.",
  "Confirming behavior aligns with timeline visual language.",
]

const WORDS = LINES.map((line) => line.split(/\s+/).filter(Boolean))
const TOTAL_WORDS = WORDS.reduce((sum, line) => sum + line.length, 0)

function reveal(wordCount: number) {
  return WORDS.reduce(
    (state, line) => {
      if (state.left <= 0) return state
      const size = Math.min(state.left, line.length)
      return {
        left: state.left - size,
        lines: [...state.lines, line.slice(0, size).join(" ")],
      }
    },
    { left: wordCount, lines: [] as string[] },
  ).lines
}

const btn = (accent?: boolean) =>
  ({
    padding: "6px 12px",
    "border-radius": "6px",
    border: "1px solid var(--border-weak-base, #343434)",
    background: accent ? "var(--surface-interactive-base, #3a5cff)" : "var(--surface-base, #1b1b1b)",
    color: "var(--text-strong, #f4f4f4)",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

const STYLES = `
[data-component="grow-box-edge-mask-playground"] {
  display: grid;
  gap: 14px;
  padding: 20px;
  max-width: 980px;
}

[data-slot="grow-box-edge-mask-grid"] {
  display: grid;
  gap: 12px;
}

@media (min-width: 900px) {
  [data-slot="grow-box-edge-mask-grid"] {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

[data-component="grow-mask-variant"] {
  display: grid;
  gap: 8px;
  min-width: 0;
}

[data-slot="grow-mask-title"] {
  color: var(--text-strong);
  font-size: 12px;
  font-weight: var(--font-weight-medium);
}

[data-slot="grow-mask-frame"] {
  position: relative;
  overflow: clip;
  min-height: 12px;
  border-radius: 6px;
  background: var(--background-stronger, #0f1013);
}

[data-slot="grow-mask-content"] {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 0;
}

[data-slot="grow-mask-line"] {
  margin: 0;
  color: var(--text-strong);
  font-size: 14px;
  line-height: var(--line-height-large);
}

[data-slot="grow-mask-overlay"] {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--grow-mask-height, 20px);
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    hsl(228 18% 6% / 0) 0%,
    hsl(228 18% 6% / 0.46) 62%,
    hsl(228 18% 6% / var(--grow-mask-opacity, 0.92)) 100%
  );
  opacity: 1;
  transform: translateY(0px);
}
`

function MaskVariant(props: {
  title: string
  mode: "none" | "release" | "fade"
  lines: string[]
  running: boolean
  finished: boolean
  maskHeight: number
  maskOpacity: number
  releaseDistance: number
  releaseDuration: number
  releaseBounce: number
}) {
  let maskRef: HTMLDivElement | undefined
  let anim: AnimationPlaybackControls | undefined
  let frame: number | undefined
  const [visible, setVisible] = createSignal(false)

  const state = createMemo(() => {
    if (props.lines.length === 0) return "empty"
    if (props.running) return "running"
    if (props.finished) return "finished"
    return "idle"
  })

  const resetMask = () => {
    if (!maskRef) return
    maskRef.style.transform = "translateY(0px)"
    maskRef.style.opacity = "1"
  }

  const stopFrame = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  const clear = () => {
    stopFrame()
    anim?.stop()
    anim = undefined
    setVisible(false)
    resetMask()
  }

  const show = (fadeIn = true) => {
    stopFrame()
    anim?.stop()
    anim = undefined
    setVisible(true)
    resetMask()
    if (!fadeIn) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!maskRef) return
      maskRef.style.opacity = "0"
      const current = animate(maskRef, { opacity: 1 }, { type: "spring", visualDuration: 0.24, bounce: 0 })
      anim = current
      current.finished
        .catch(() => {})
        .finally(() => {
          if (anim !== current) return
          anim = undefined
          if (!maskRef) return
          maskRef.style.opacity = "1"
        })
    })
  }

  const release = () => {
    show(false)
    stopFrame()
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!maskRef) return
      const shift = props.maskHeight + props.releaseDistance
      const current = animate(
        maskRef,
        { transform: `translateY(${shift}px)`, opacity: 0 },
        { type: "spring", visualDuration: props.releaseDuration, bounce: props.releaseBounce },
      )
      anim = current
      current.finished
        .catch(() => {})
        .finally(() => {
          if (anim !== current) return
          anim = undefined
          setVisible(false)
          resetMask()
        })
    })
  }

  const fade = () => {
    show(false)
    stopFrame()
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!maskRef) return
      const current = animate(
        maskRef,
        { opacity: 0 },
        { type: "spring", visualDuration: props.releaseDuration, bounce: props.releaseBounce },
      )
      anim = current
      current.finished
        .catch(() => {})
        .finally(() => {
          if (anim !== current) return
          anim = undefined
          setVisible(false)
          resetMask()
        })
    })
  }

  createEffect(
    on(
      () => [props.mode, state()] as const,
      ([mode, next]) => {
        if (mode === "none" || next === "empty") {
          clear()
          return
        }
        if (next !== "finished") {
          show()
          return
        }
        if (mode === "fade") {
          fade()
          return
        }
        release()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    stopFrame()
    anim?.stop()
    anim = undefined
  })

  return (
    <div
      data-component="grow-mask-variant"
      style={{
        "--grow-mask-height": `${props.maskHeight}px`,
        "--grow-mask-opacity": `${props.maskOpacity}`,
      }}
    >
      <div data-slot="grow-mask-title">{props.title}</div>
      <div data-slot="grow-mask-frame">
        <GrowBox animate watch fade={false} open={props.lines.length > 0} class="w-full min-w-0">
          <div data-slot="grow-mask-content">
            <For each={props.lines}>{(line) => <p data-slot="grow-mask-line">{line}</p>}</For>
          </div>
        </GrowBox>
        <Show when={visible()}>
          <div ref={maskRef} data-slot="grow-mask-overlay" />
        </Show>
      </div>
    </div>
  )
}

export const Playground = {
  render: () => {
    const [words, setWords] = createSignal(0)
    const [running, setRunning] = createSignal(false)
    const [finished, setFinished] = createSignal(false)
    const [maskHeight, setMaskHeight] = createSignal(20)
    const [maskOpacity, setMaskOpacity] = createSignal(0.92)
    const [releaseDistance, setReleaseDistance] = createSignal(16)
    const [releaseDuration, setReleaseDuration] = createSignal(0.42)
    const [releaseBounce, setReleaseBounce] = createSignal(0)
    const [speed, setSpeed] = createSignal(90)

    const lines = createMemo(() => reveal(words()))
    let job: ReturnType<typeof setTimeout> | undefined

    const stop = () => {
      if (job === undefined) return
      clearTimeout(job)
      job = undefined
    }

    const schedule = () => {
      if (!running()) return
      job = setTimeout(() => {
        job = undefined
        const current = words()
        const next = Math.min(TOTAL_WORDS, current + 1)
        setWords(next)
        if (next >= TOTAL_WORDS) {
          setRunning(false)
          setFinished(true)
          return
        }
        schedule()
      }, speed())
    }

    const start = () => {
      stop()
      setWords(0)
      setFinished(false)
      setRunning(true)
      schedule()
    }

    const next = () => {
      stop()
      setRunning(false)
      const value = Math.min(TOTAL_WORDS, words() + 1)
      setWords(value)
      setFinished(value >= TOTAL_WORDS)
    }

    const finishNow = () => {
      stop()
      setRunning(false)
      setWords(TOTAL_WORDS)
      setFinished(true)
    }

    const reset = () => {
      stop()
      setRunning(false)
      setFinished(false)
      setWords(0)
    }

    onCleanup(stop)

    return (
      <div data-component="grow-box-edge-mask-playground">
        <style>{STYLES}</style>

        <div style={{ display: "grid", gap: "4px" }}>
          <div style={{ color: "var(--text-strong)", "font-size": "14px", "font-weight": "500" }}>
            GrowBox streaming edge mask
          </div>
          <div style={{ color: "var(--text-weaker)", "font-size": "12px" }}>
            state: {running() ? "streaming" : finished() ? "finished" : "idle"} · words: {words()} / {TOTAL_WORDS}
          </div>
        </div>

        <div data-slot="grow-box-edge-mask-grid">
          <MaskVariant
            title="Hard edge (baseline)"
            mode="none"
            lines={lines()}
            running={running()}
            finished={finished()}
            maskHeight={maskHeight()}
            maskOpacity={maskOpacity()}
            releaseDistance={releaseDistance()}
            releaseDuration={releaseDuration()}
            releaseBounce={releaseBounce()}
          />
          <MaskVariant
            title="Release mask (translate + fade)"
            mode="release"
            lines={lines()}
            running={running()}
            finished={finished()}
            maskHeight={maskHeight()}
            maskOpacity={maskOpacity()}
            releaseDistance={releaseDistance()}
            releaseDuration={releaseDuration()}
            releaseBounce={releaseBounce()}
          />
          <MaskVariant
            title="Release mask (fade only)"
            mode="fade"
            lines={lines()}
            running={running()}
            finished={finished()}
            maskHeight={maskHeight()}
            maskOpacity={maskOpacity()}
            releaseDistance={releaseDistance()}
            releaseDuration={releaseDuration()}
            releaseBounce={releaseBounce()}
          />
        </div>

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          <button style={btn(true)} onClick={start}>
            Start stream
          </button>
          <button style={btn()} onClick={next}>
            Next word
          </button>
          <button style={btn()} onClick={finishNow}>
            Finish
          </button>
          <button style={btn()} onClick={reset}>
            Reset
          </button>
        </div>

        <div style={{ display: "grid", gap: "8px", "max-width": "640px" }}>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            mask height: {maskHeight()}px
            <input
              type="range"
              min="8"
              max="40"
              value={maskHeight()}
              onInput={(event) => setMaskHeight(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            mask opacity: {maskOpacity().toFixed(2)}
            <input
              type="range"
              min="0.35"
              max="1"
              step="0.01"
              value={maskOpacity()}
              onInput={(event) => setMaskOpacity(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            release distance: {releaseDistance()}px
            <input
              type="range"
              min="0"
              max="40"
              value={releaseDistance()}
              onInput={(event) => setReleaseDistance(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            release duration: {releaseDuration().toFixed(2)}s
            <input
              type="range"
              min="0.15"
              max="1"
              step="0.01"
              value={releaseDuration()}
              onInput={(event) => setReleaseDuration(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            stream speed: {speed()}ms/word
            <input
              type="range"
              min="40"
              max="260"
              step="10"
              value={speed()}
              onInput={(event) => setSpeed(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label style={{ display: "grid", gap: "4px", color: "var(--text-weaker)", "font-size": "12px" }}>
            release bounce: {releaseBounce().toFixed(2)}
            <input
              type="range"
              min="0"
              max="0.35"
              step="0.01"
              value={releaseBounce()}
              onInput={(event) => setReleaseBounce(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
        </div>
      </div>
    )
  },
}
