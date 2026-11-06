/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, createSignal, For, Show } from "solid-js"
import { bool, clamp, num, object, str } from "../json"
import { fmt } from "../format"
import { PlayIcon, ResetIcon, Slider, IconButton, Readout } from "../controls"
import { createTicker, reducedMotion } from "../ticker"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 360

type Point = { x: number; y: number }

type Branch = "open" | "crossed"

interface FourBar {
  readonly type: "fourbar"
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly branch: Branch
  readonly rpm: number
  readonly trace: boolean
}

interface SliderCrank {
  readonly type: "crank-slider"
  readonly r: number
  readonly l: number
  readonly offset: number
  readonly rpm: number
  readonly trace: boolean
}

type Mechanism = FourBar | SliderCrank

function readMechanism(spec: VisualSpec): Mechanism {
  const data = object(spec.data) ?? {}

  if (str(data.type, "fourbar") === "crank-slider")
    return {
      type: "crank-slider",
      r: clamp(num(data.r, 26), 4, 200),
      l: clamp(num(data.l, 96), 10, 400),
      offset: clamp(num(data.offset, 0), -80, 80),
      rpm: clamp(num(data.rpm, 24), 1, 600),
      trace: bool(data.trace, true),
    }

  return {
    type: "fourbar",
    a: clamp(num(data.a, 34), 4, 200),
    b: clamp(num(data.b, 104), 10, 400),
    c: clamp(num(data.c, 74), 10, 300),
    d: clamp(num(data.d, 128), 10, 400),
    branch: str(data.branch, "open") === "crossed" ? "crossed" : "open",
    rpm: clamp(num(data.rpm, 24), 1, 600),
    trace: bool(data.trace, true),
  }
}

function circleIntersection(p: Point, r0: number, q: Point, r1: number, sign: number): Point | undefined {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const distance = Math.hypot(dx, dy)

  if (distance === 0 || distance > r0 + r1 || distance < Math.abs(r0 - r1)) return undefined
  const along = (r0 * r0 - r1 * r1 + distance * distance) / (2 * distance)
  const height = Math.sqrt(Math.max(0, r0 * r0 - along * along))
  const baseX = p.x + (along * dx) / distance
  const baseY = p.y + (along * dy) / distance

  return { x: baseX + (sign * height * dy) / distance, y: baseY - (sign * height * dx) / distance }
}

interface FourBarGeometry {
  readonly A: Point
  readonly B: Point
  readonly C: Point
  readonly D: Point
  readonly transmission: number
  readonly rocker: number
  readonly valid: boolean
}

function solveFourBar(link: FourBar, degrees: number): FourBarGeometry {
  const theta = (degrees * Math.PI) / 180
  const A = { x: 0, y: 0 }
  const D = { x: link.d, y: 0 }
  const B = { x: link.a * Math.cos(theta), y: link.a * Math.sin(theta) }
  const C = circleIntersection(B, link.b, D, link.c, link.branch === "open" ? 1 : -1)

  if (!C)
    return { A, B, C: B, D, transmission: 0, rocker: 0, valid: false }
  const u = { x: C.x - B.x, y: C.y - B.y }
  const v = { x: C.x - D.x, y: C.y - D.y }
  const between = Math.acos(clamp((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1), -1, 1))
  const transmission = Math.min(between, Math.PI - between) * (180 / Math.PI)
  const rocker = (Math.atan2(C.y - D.y, C.x - D.x) * 180) / Math.PI

  return { A, B, C, D, transmission, rocker, valid: true }
}

interface MechanismReadout {
  readonly grashof: boolean
  readonly kind: string
  readonly transmission: number
  readonly valid: boolean
}

interface SliderGeometry {
  readonly B: Point
  readonly C: Point
  readonly valid: boolean
  readonly rod: number
  readonly rocker: number
}

function solveSlider(link: SliderCrank, degrees: number): SliderGeometry {
  const theta = (degrees * Math.PI) / 180
  const B = { x: link.r * Math.cos(theta), y: link.r * Math.sin(theta) }
  const inside = link.l * link.l - (link.r * Math.sin(theta) - link.offset) ** 2

  if (inside < 0) return { B, C: { x: B.x, y: link.offset }, valid: false, rod: 0, rocker: 0 }
  const C = { x: B.x + Math.sqrt(inside), y: link.offset }
  const rod = (Math.atan2(C.y - B.y, C.x - B.x) * 180) / Math.PI

  return { B, C, valid: true, rod, rocker: rod }
}

function sliderStroke(link: SliderCrank): number {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let degrees = 0; degrees <= 360; degrees += 1) {
    const solved = solveSlider(link, degrees)

    if (!solved.valid) continue

    min = Math.min(min, solved.C.x)
    max = Math.max(max, solved.C.x)
  }

  return Number.isFinite(min) && Number.isFinite(max) ? max - min : link.r * 2
}

export function MechanismVisual(props: { spec: VisualSpec }) {
  const link = createMemo(() => readMechanism(props.spec))
  const [angle, setAngle] = createSignal(clamp(num(object(props.spec.data)?.angle, 38), 0, 360))
  const [playing, setPlaying] = createSignal(!reducedMotion())
  const [trace, setTrace] = createSignal(link().trace)
  const [element, setElement] = createSignal<HTMLDivElement>()

  const step = (delta: number) => setAngle((value) => (value + link().rpm * 0.006 * delta) % 360)
  const ticker = createTicker(playing, step, element)

  const geometry = createMemo(() =>
    link().type === "fourbar" ? solveFourBar(link() as FourBar, angle()) : solveSlider(link() as SliderCrank, angle()),
  )

  const extremes = createMemo(() => {
    const four = link()

    if (four.type !== "fourbar") return []

    let low: Point | undefined
    let high: Point | undefined
    let lowAngle = Number.POSITIVE_INFINITY
    let highAngle = Number.NEGATIVE_INFINITY

    for (let degrees = 0; degrees <= 360; degrees += 2) {
      const solved = solveFourBar(four, degrees)

      if (!solved.valid) continue

      const angle = Math.atan2(solved.C.y - solved.D.y, solved.C.x - solved.D.x)

      if (angle < lowAngle) {
        lowAngle = angle
        low = solved.C
      }

      if (angle > highAngle) {
        highAngle = angle
        high = solved.C
      }
    }

    return [low, high].filter((point): point is Point => point !== undefined)
  })

  const rockerCurve = createMemo(() => {
    const four = link()

    if (four.type !== "fourbar") return [] as Array<[number, number]>

    const points: Array<[number, number]> = []

    for (let degrees = 0; degrees <= 360; degrees += 2) {
      const solved = solveFourBar(four, degrees)

      if (solved.valid) points.push([degrees, solved.rocker])
    }

    return points
  })

  const tracePath = createMemo(() => {
    const samples: Point[] = []

    for (let index = 0; index <= 72; index += 1) {
      const degrees = (index / 72) * 360

      if (link().type === "fourbar") {
        const solved = solveFourBar(link() as FourBar, degrees)

        if (solved.valid) samples.push(solved.C)
      } else {
        const solved = solveSlider(link() as SliderCrank, degrees)

        if (solved.valid) samples.push(solved.C)
      }
    }

    return samples
  })

  const box = createMemo(() => {
    const points: Point[] = []

    if (link().type === "fourbar") {
      const four = link() as FourBar
      points.push({ x: 0, y: 0 }, { x: four.d, y: 0 })

      for (let index = 0; index <= 72; index += 1) {
        const solved = solveFourBar(four, (index / 72) * 360)
        points.push(solved.B, solved.C)
      }
    } else {
      const slider = link() as SliderCrank
      const reach = slider.r + Math.sqrt(Math.max(0, slider.l * slider.l - Math.max(0, slider.offset - slider.r) ** 2))
      points.push({ x: -slider.r, y: -slider.r }, { x: reach + 18, y: slider.offset + 26 })

      for (let index = 0; index <= 72; index += 1) {
        const solved = solveSlider(slider, (index / 72) * 360)
        points.push(solved.B, solved.C)
      }
    }

    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)

    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  })

  const transform = createMemo(() => {
    const bounds = box()
    const pad = 34
    const scale = Math.min((W - pad * 2) / Math.max(1, bounds.maxX - bounds.minX), (H - pad * 2) / Math.max(1, bounds.maxY - bounds.minY))
    const offsetX = (W - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale
    const offsetY = (H - (bounds.maxY - bounds.minY) * scale) / 2 + bounds.maxY * scale

    return { scale, offsetX, offsetY }
  })

  const toScreen = (point: Point): Point => {
    const t = transform()

    return { x: t.offsetX + point.x * t.scale, y: t.offsetY - point.y * t.scale }
  }

  const path = (points: Point[]) =>
    points
      .map((point, index) => {
        const screen = toScreen(point)

        return `${index === 0 ? "M" : "L"}${screen.x.toFixed(1)},${screen.y.toFixed(1)}`
      })
      .join(" ")

  const readout = (): MechanismReadout => {
    if (link().type === "fourbar") {
      const solved = geometry() as FourBarGeometry
      const four = link() as FourBar
      const lengths = [four.a, four.b, four.c, four.d].sort((a, b) => a - b)
      const grashof = lengths[0] + lengths[3] <= lengths[1] + lengths[2]
      const shortest = [four.a, four.b, four.c, four.d].indexOf(lengths[0])
      const kind = !grashof ? "non-Grashof" : shortest === 0 || shortest === 2 ? "crank-rocker" : shortest === 3 ? "double-crank" : "double-rocker"

      return { grashof, kind, transmission: solved.transmission, valid: solved.valid }
    }

    return { grashof: true, kind: "slider-crank", transmission: 0, valid: (geometry() as { valid: boolean }).valid }
  }

  const controlAngle = (
    <Slider
      label="Crank"
      value={angle()}
      min={0}
      max={360}
      step={1}
      format={(value) => `${fmt(value, 0)}°`}
      onInput={(value) => {
        setPlaying(false)
        setAngle(value)
        ticker.sync()
      }}
    />
  )

  return (
    <div ref={setElement}>
      <VisualFrame
        spec={props.spec}
       
        tools={
          <>
            <IconButton label={playing() ? "Pause" : "Play"} pressed={playing()} onClick={() => { setPlaying((value) => !value); ticker.sync() }}>
              <PlayIcon playing={playing()} />
            </IconButton>
            <IconButton
              label="Reset"
              onClick={() => {
                setAngle(clamp(num(object(props.spec.data)?.angle, 38), 0, 360))
                setPlaying(true)
                ticker.sync()
              }}
            >
              <ResetIcon />
            </IconButton>
          </>
        }
        stage={
          <>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
            <Show when={trace()}>
              <path class="vz-line-muted" d={path(tracePath())} />
            </Show>
            <Show when={!readout().valid}>
              <text class="vz-svg-title" x={W / 2} y={H / 2} text-anchor="middle">
                This linkage cannot close at {fmt(angle(), 0)}°
              </text>
            </Show>

            <Show when={link().type === "fourbar"}>
              {(() => {
                const solved = geometry() as FourBarGeometry
                const A = toScreen(solved.A)
                const B = toScreen(solved.B)
                const C = toScreen(solved.C)
                const D = toScreen(solved.D)

                return (
                  <>
                    <Ground point={A} />
                    <Ground point={D} />
                    <For each={extremes()}>
                      {(point) => {
                        const at = toScreen(point)

                        return (
                          <>
                            <path class="vz-line-muted" d={`M${D.x},${D.y} L${at.x},${at.y}`} />
                            <text class="vz-svg-key" x={at.x + 12} y={at.y - 6}>
                              limit
                            </text>
                          </>
                        )
                      }}
                    </For>
                    <path class="vz-line" d={`M${A.x},${A.y} L${B.x},${B.y}`} />
                    <path class="vz-line" d={`M${B.x},${B.y} L${C.x},${C.y}`} />
                    <path class="vz-line-accent" d={`M${C.x},${C.y} L${D.x},${D.y}`} />
                    <Joint point={A} />
                    <Joint point={B} />
                    <Joint point={C} accent />
                    <Joint point={D} />
                    <text class="vz-svg-key" x={A.x - 8} y={A.y - 6} text-anchor="end">A</text>
                    <text class="vz-svg-key" x={B.x + 8} y={B.y - 6}>B</text>
                    <text class="vz-svg-key" x={D.x + 8} y={D.y - 6}>D</text>
                    <path class="vz-line-muted" d={`M${A.x},${A.y} L${D.x},${D.y}`} />
                    <AngleArc center={A} radius={22} degrees={angle()} />
                    <text class="vz-svg-value" x={C.x + 12} y={C.y + 4}>
                      C
                    </text>
                  </>
                )
              })()}
            </Show>

            <Show when={link().type === "crank-slider"}>
              {(() => {
                const solved = solveSlider(link() as SliderCrank, angle())
                const slider = link() as SliderCrank
                const O = toScreen({ x: 0, y: 0 })
                const B = toScreen(solved.B)
                const C = toScreen(solved.C)
                const guideLeft = toScreen({ x: -slider.r * 1.15, y: slider.offset })
                const guideRight = toScreen({ x: solved.C.x + 26, y: slider.offset })

                return (
                  <>
                    <Ground point={O} />
                    <circle
                      cx={O.x}
                      cy={O.y}
                      r={Math.abs(slider.r * transform().scale)}
                      fill="none"
                      stroke="var(--v-line)"
                      stroke-dasharray="2 3"
                    />
                    <path class="vz-line" d={`M${guideLeft.x},${guideLeft.y + 12} L${guideRight.x},${guideRight.y + 12}`} />
                    <path class="vz-line" d={`M${guideLeft.x},${guideLeft.y - 12} L${guideRight.x},${guideRight.y - 12}`} />
                    <path class="vz-line-accent" d={`M${O.x},${O.y} L${B.x},${B.y}`} />
                    <path class="vz-line" d={`M${B.x},${B.y} L${C.x},${C.y}`} />
                    <rect
                      x={C.x - 11}
                      y={C.y - 13}
                      width={22}
                      height={26}
                      fill="var(--v-bg)"
                      stroke="var(--v-fg-2)"
                      stroke-width="1.2"
                    />
                    <Joint point={O} />
                    <Joint point={B} />
                    <Joint point={C} accent />
                    <text class="vz-svg-key" x={O.x - 8} y={O.y - 6} text-anchor="end">O</text>
                    <text class="vz-svg-key" x={B.x + 8} y={B.y - 6}>B</text>
                    <AngleArc center={O} radius={26} degrees={angle()} />
                    <text x={C.x} y={C.y + 34} text-anchor="middle">
                      x {fmt(solved.C.x, 1)}
                    </text>
                  </>
                )
              })()}
            </Show>
            </svg>
            <Show when={link().type === "fourbar" && rockerCurve().length > 0}>
              <RockerStrip points={rockerCurve()} angle={angle()} current={geometry().rocker} />
            </Show>
          </>
        }
        controls={controlAngle}
        readouts={
          <>
            <Show when={link().type === "fourbar"}>
              <Readout label="a" value={fmt((link() as FourBar).a, 0)} />
              <Readout label="b" value={fmt((link() as FourBar).b, 0)} />
              <Readout label="c" value={fmt((link() as FourBar).c, 0)} />
              <Readout label="d" value={fmt((link() as FourBar).d, 0)} />
            </Show>
            <Show when={link().type === "crank-slider"}>
              <Readout label="r" value={fmt((link() as SliderCrank).r, 1)} />
              <Readout label="l" value={fmt((link() as SliderCrank).l, 1)} />
            </Show>
            <Readout label="Angle" value={`${fmt(angle(), 0)}°`} />
            <Show when={link().type === "fourbar"}>
              <Readout label="Transmission" value={`${fmt(readout().transmission, 1)}°`} tone={readout().transmission < 40 ? "critical" : undefined} />
              <Readout label="Type" value={readout().kind} tone={readout().grashof ? "accent" : "critical"} />
            </Show>
            <Show when={link().type === "crank-slider"}>
              <Readout label="Stroke" value={`${fmt(sliderStroke(link() as SliderCrank), 1)}`} />
              <Readout label="Rod ratio" value={fmt((link() as SliderCrank).l / (link() as SliderCrank).r, 2)} />
            </Show>
            <button type="button" class="vz-toggle" aria-pressed={trace()} onClick={() => setTrace((value) => !value)}>
              <span>Path</span>
              <b>{trace() ? "shown" : "hidden"}</b>
            </button>
          </>
        }
        caption={
          props.spec.caption ??
          (link().type === "fourbar"
            ? "The crank drives the coupler, and the coupler drives the rocker. The transmission angle stays closest to 90° when the linkage transmits force well."
            : "The crank pin drives the connecting rod, and the rod drives the slider along its guide. Stroke equals twice the crank radius.")
        }
      />
    </div>
  )
}

function RockerStrip(props: { points: Array<[number, number]>; angle: number; current: number }) {
  const values = props.points.map((point) => point[1])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (degrees: number) => 60 + (degrees / 360) * (W - 120)
  const y = (degrees: number) => 48 - ((degrees - min) / Math.max(1e-9, max - min)) * 26
  const path = props.points.map(([crank, rocker], index) => `${index === 0 ? "M" : "L"}${x(crank).toFixed(1)},${y(rocker).toFixed(1)}`).join(" ")
  const at = x(props.angle)

  return (
    <svg class="vz-strip" viewBox={`0 0 ${W} 70`} role="img" aria-label="Rocker angle against crank angle">
      <line class="vz-axis" x1={60} x2={W - 60} y1={54} y2={54} />
      <text class="vz-svg-key" x={8} y={12}>
        rocker angle
      </text>
      <path class="vz-line-accent" d={path} />
      <line class="vz-guide" x1={at} x2={at} y1={16} y2={54} />
      <circle cx={at} cy={y(props.current)} r={3.2} fill="var(--v-accent)" />
      <text x={60} y={68} text-anchor="middle">0°</text>
      <text x={W / 2} y={68} text-anchor="middle">180°</text>
      <text x={W - 60} y={68} text-anchor="middle">360°</text>
      <text class="vz-svg-key" x={W - 60} y={12} text-anchor="end">
        {fmt(min, 0)}° to {fmt(max, 0)}°
      </text>
    </svg>
  )
}

function Joint(props: { point: Point; accent?: boolean }) {
  return (
    <circle
      cx={props.point.x}
      cy={props.point.y}
      r={4.2}
      fill={props.accent ? "var(--v-accent)" : "var(--v-bg)"}
      stroke={props.accent ? "var(--v-accent)" : "var(--v-fg-2)"}
      stroke-width="1.3"
    />
  )
}

function Ground(props: { point: Point }) {
  return (
    <>
      <path
        d={`M${props.point.x - 7},${props.point.y + 2} L${props.point.x + 7},${props.point.y + 2} L${props.point.x},${props.point.y + 11} Z`}
        fill="none"
        stroke="var(--v-fg-2)"
        stroke-width="1"
      />
      <path
        d={`M${props.point.x - 9},${props.point.y + 14} L${props.point.x + 9},${props.point.y + 14}`}
        stroke="var(--v-fg-3)"
        stroke-width="1"
      />
      <For each={[-7, -3, 1, 5, 9]}>
        {(offset) => (
          <line
            x1={props.point.x + offset}
            y1={props.point.y + 14}
            x2={props.point.x + offset - 3}
            y2={props.point.y + 18}
            stroke="var(--v-fg-3)"
            stroke-width="1"
          />
        )}
      </For>
    </>
  )
}

function AngleArc(props: { center: Point; radius: number; degrees: number }) {
  const end = () => {
    const radians = (props.degrees * Math.PI) / 180

    return { x: props.center.x + props.radius * Math.cos(radians), y: props.center.y - props.radius * Math.sin(radians) }
  }

  const label = () => {
    const radians = (props.degrees * Math.PI) / 360
    const radius = props.radius + 30

    return { x: props.center.x + radius * Math.cos(radians), y: props.center.y - radius * Math.sin(radians) }
  }

  const large = () => (props.degrees > 180 ? 1 : 0)
  const finish = end()

  return (
    <>
      <path
        class="vz-line-muted"
        d={`M${props.center.x + props.radius},${props.center.y} A${props.radius},${props.radius} 0 ${large()} 0 ${finish.x},${finish.y}`}
      />
      <text class="vz-svg-key" x={label().x} y={label().y + 3} text-anchor="middle">
        θ {fmt(props.degrees, 0)}°
      </text>
    </>
  )
}
