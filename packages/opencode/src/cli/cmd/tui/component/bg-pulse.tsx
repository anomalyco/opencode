import { BoxRenderable, RGBA } from "@opentui/core"
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"

const PERIOD = 4600
const RINGS = 3
const WIDTH = 3.8
const TAIL = 9.5
const AMP = 0.55
const TAIL_AMP = 0.16
const BREATH_AMP = 0.05
const BREATH_SPEED = 0.0008
// Offset so bg ring emits from GO center at the moment the logo pulse peaks.
const PHASE_OFFSET = 0.29

export type BgPulseMask = {
  x: number
  y: number
  width: number
  height: number
  pad?: number
  strength?: number
}

export function BgPulse(props: { centerX?: number; centerY?: number; masks?: BgPulseMask[] }) {
  const { theme } = useTheme()
  const [now, setNow] = createSignal(performance.now())
  const [size, setSize] = createSignal<{ width: number; height: number }>({ width: 0, height: 0 })
  let box: BoxRenderable | undefined

  const timer = setInterval(() => setNow(performance.now()), 50)
  onCleanup(() => clearInterval(timer))

  const sync = () => {
    if (!box) return
    setSize({ width: box.width, height: box.height })
  }

  onMount(() => {
    sync()
    box?.on("resize", sync)
  })

  onCleanup(() => {
    box?.off("resize", sync)
  })

  const grid = createMemo(() => {
    const t = now()
    const w = size().width
    const h = size().height
    if (w === 0 || h === 0) return [] as RGBA[][]
    const cxv = props.centerX ?? w / 2
    const cyv = props.centerY ?? h / 2
    const reach = Math.hypot(Math.max(cxv, w - cxv), Math.max(cyv, h - cyv) * 2) + TAIL
    const ringStates = Array.from({ length: RINGS }, (_, i) => {
      const offset = i / RINGS
      const phase = (t / PERIOD + offset - PHASE_OFFSET + 1) % 1
      const envelope = Math.sin(phase * Math.PI)
      const eased = envelope * envelope * (3 - 2 * envelope)
      return {
        head: phase * reach,
        eased,
      }
    })
    const normalizedMasks = props.masks?.map((m) => {
      const pad = m.pad ?? 2
      return {
        left: m.x - pad,
        right: m.x + m.width + pad,
        top: m.y - pad,
        bottom: m.y + m.height + pad,
        pad,
        strength: m.strength ?? 0.85,
      }
    })
    const rows = [] as RGBA[][]
    for (let y = 0; y < h; y++) {
      const row = [] as RGBA[]
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cxv
        const dy = (y + 0.5 - cyv) * 2
        const dist = Math.hypot(dx, dy)
        let level = 0
        for (const ring of ringStates) {
          const delta = dist - ring.head
          const crest = Math.abs(delta) < WIDTH ? 0.5 + 0.5 * Math.cos((delta / WIDTH) * Math.PI) : 0
          const tail = delta < 0 && delta > -TAIL ? (1 + delta / TAIL) ** 2.3 : 0
          level += (crest * AMP + tail * TAIL_AMP) * ring.eased
        }
        const edgeFalloff = Math.max(0, 1 - (dist / (reach * 0.85)) ** 2)
        const breath = (0.5 + 0.5 * Math.sin(t * BREATH_SPEED)) * BREATH_AMP
        let maskAtten = 1
        if (normalizedMasks) {
          for (const m of normalizedMasks) {
            if (x < m.left || x > m.right || y < m.top || y > m.bottom) continue
            const inX = Math.min(x - m.left, m.right - x)
            const inY = Math.min(y - m.top, m.bottom - y)
            const edge = Math.min(inX / m.pad, inY / m.pad, 1)
            const eased = edge * edge * (3 - 2 * edge)
            const reduce = 1 - m.strength * eased
            if (reduce < maskAtten) maskAtten = reduce
          }
        }
        const strength = Math.min(1, ((level / RINGS) * edgeFalloff + breath * edgeFalloff) * maskAtten)
        row.push(tint(theme.backgroundPanel, theme.primary, strength * 0.7))
      }
      rows.push(row)
    }
    return rows
  })

  return (
    <box ref={(item: BoxRenderable) => (box = item)} width="100%" height="100%">
      <For each={grid()}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(color) => (
                <text bg={color} fg={color} selectable={false}>
                  {" "}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
