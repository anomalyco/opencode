import { createEffect, on, onCleanup, onMount } from "solid-js"
import { frameLoop, observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import type { CallState } from "./call"

// The call's picture of both voices, after the iOS call's DotScope: a faint LED dot matrix that two braided waves light
// up, yours and the agent's, each swelling as it speaks and calm between turns. Levels arrive several times a second;
// followers smooth them so the picture never jumps with instantaneous loudness.
const pitch = 3

const size = 1.6

export function VoiceScope(props: {
  meter: { mic: number; speaker: number }
  status: CallState["status"]
  muted: boolean
}) {
  let canvas!: HTMLCanvasElement
  const view = { width: 0, height: 0, ratio: 1, time: 0, you: 0, agent: 0, colors: 0 }
  const colors = { you: "", agent: "", rest: "" }

  const paint = (dt: number) => {
    const context = canvas.getContext("2d")

    if (!context || !view.width || !view.height) return
    view.time += dt
    view.colors -= dt

    // Theme changes recolour within half a second without a style read every frame.
    if (view.colors <= 0) {
      const style = getComputedStyle(canvas)
      colors.you = style.getPropertyValue("--voice-scope-you").trim()
      colors.agent = style.getPropertyValue("--voice-scope-agent").trim()
      colors.rest = style.getPropertyValue("--voice-scope-rest").trim()
      view.colors = 0.5
    }

    // Quick attack, slower release, so syllables register and pauses settle.
    const follow = (current: number, target: number) =>
      current + (target - current) * (1 - Math.exp(-dt * (target > current ? 16 : 5)))

    view.you = follow(view.you, props.status === "connected" && !props.muted ? loudness(props.meter.mic) : 0)
    view.agent = follow(view.agent, props.status === "connected" ? loudness(props.meter.speaker) : 0)

    const columns = Math.floor(view.width / pitch)
    const rows = Math.floor(view.height / pitch)
    const left = (view.width - (columns - 1) * pitch) / 2
    const top = (view.height - (rows - 1) * pitch) / 2
    const middle = (rows - 1) / 2

    context.setTransform(view.ratio, 0, 0, view.ratio, 0, 0)
    context.clearRect(0, 0, view.width, view.height)
    context.globalCompositeOperation = "source-over"

    const light = (color: string, alpha: number, column: number, row: number) => {
      if (alpha <= 0.03) return
      context.globalAlpha = Math.min(1, alpha)
      context.fillStyle = color
      context.fillRect(left + column * pitch - size / 2, top + row * pitch - size / 2, size, size)
    }

    // The unlit grid, faint, in one path.
    context.globalAlpha = 0.12
    context.fillStyle = colors.rest
    context.beginPath()

    for (let column = 0; column < columns; column++)
      for (let row = 0; row < rows; row++)
        context.rect(left + column * pitch - size / 2, top + row * pitch - size / 2, size, size)
    context.fill()

    if (props.status === "dropped")
      for (let column = 0; column < columns; column++) light(colors.rest, 0.5, column, Math.round(middle))

    if (props.status === "connecting") {
      // A band of light sweeping back and forth while the call connects.
      const phase = (view.time / 1.1) % 2
      const at = (phase < 1 ? phase : 2 - phase) * (columns - 1)

      for (let column = 0; column < columns; column++) {
        const near = Math.max(0, 1 - Math.abs(column - at) / 5)

        for (let row = 0; row < rows; row++)
          light(colors.agent, near * (1 - Math.abs(row - middle) / (middle + 1)), column, row)
      }
    }

    if (props.status === "connected")
      for (let column = 0; column < columns; column++) {
        const position = columns > 1 ? column / (columns - 1) : 0.5
        // Waves gather in the middle and taper to a line at both ends.
        const envelope = Math.sin(Math.PI * position) ** 1.5
        // Never perfectly flat, so a quiet call still reads as live.
        const you = middle + (0.08 + view.you * 0.92) * middle * envelope * Math.sin(position * 13.8 + view.time * 5)

        const agent =
          middle + (0.08 + view.agent * 0.92) * middle * envelope * Math.sin(position * 10 - view.time * 4.2 + 1.3)

        // A louder voice draws a thicker, brighter trace.
        for (let row = 0; row < rows; row++) {
          light(colors.you, (1 - Math.abs(row - you) / (0.8 + view.you)) * (0.5 + view.you * 0.5), column, row)
          light(colors.agent, (1 - Math.abs(row - agent) / (0.8 + view.agent)) * (0.5 + view.agent * 0.5), column, row)
        }
      }

    // Fade both ends into the composer.
    const fade = context.createLinearGradient(0, 0, view.width, 0)
    fade.addColorStop(0, "transparent")
    fade.addColorStop(0.08, "black")
    fade.addColorStop(0.92, "black")
    fade.addColorStop(1, "transparent")
    context.globalAlpha = 1
    context.globalCompositeOperation = "destination-in"
    context.fillStyle = fade
    context.fillRect(0, 0, view.width, view.height)
    context.globalCompositeOperation = "source-over"
  }

  onMount(() => {
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      view.ratio = window.devicePixelRatio || 1
      view.width = rect.width
      view.height = rect.height
      canvas.width = Math.round(rect.width * view.ratio)
      canvas.height = Math.round(rect.height * view.ratio)
      view.colors = 0
      paint(0)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    // Reduce Motion draws a still pose for each state instead of running the loop.
    const run = () =>
      prefersReducedMotion()
        ? undefined
        : frameLoop.add((dt) => {
            paint(dt)

            return true
          })

    let stop = run()

    onCleanup(
      observeReducedMotion(() => {
        stop?.()
        stop = run()
        paint(0)
      }),
    )
    onCleanup(() => {
      stop?.()
      observer.disconnect()
    })
  })

  createEffect(
    on(
      () => [props.status, props.muted],
      () => {
        if (prefersReducedMotion()) paint(0)
      },
      { defer: true },
    ),
  )

  return <canvas ref={canvas} class="voice-scope" aria-hidden="true" />
}

// RMS from the analysers runs about 0.02 for quiet speech to 0.15 for loud; the floor drops room noise.
function loudness(rms: number) {
  return Math.min(1, Math.sqrt(Math.max(0, rms - 0.003) * 14))
}
