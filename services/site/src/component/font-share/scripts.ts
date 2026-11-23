import type { Component, JSX } from "solid-js"
import { Analysis, Kerning, Performance } from "~/component/font/analysis"
import { Construction, Timeline as Gantt } from "~/component/font/construction"
import { Anagrams, Colophon, Cover, Poster, Tester, Waterfall } from "~/component/font/display"
import { Exploded } from "~/component/font/exploded"
import { Field } from "~/component/font/field"
import { Loupe } from "~/component/font/loupe"
import { Passports } from "~/component/font/passports"
import { Typewriter } from "~/component/font/typewriter"
import { constructionPhases, fontContent } from "~/lib/font-content"
import { inOut, timeline, typing, type Context, type Cursor, type Point, type Target } from "./timeline"

type Script = (frame: HTMLElement, setCursor: (cursor: Cursor) => void) => (t: number) => void

export type Share = {
  component: Component
  tone: "paper" | "ink" | "blue" | "night"
  captionTone?: Share["tone"]
  caption: string
  /** Loop length in milliseconds. */
  duration: number
  /** When the poster frame is taken. */
  poster: number
  style?: JSX.CSSProperties
  script?: Script
}

// Just outside the canvas, whatever its ratio.
const OFF_BOTTOM: Target = () => [window.innerWidth * 0.7, window.innerHeight + 110] as const
const OFF_RIGHT: Target = () => [window.innerWidth + 100, window.innerHeight * 0.66] as const

/** The centre of a range input's thumb at `value`. */
const thumb = (ctx: Context, selector: string, value: number): Point | undefined => {
  const input = ctx.frame.querySelector<HTMLInputElement>(selector)
  if (!input) return undefined
  const rect = input.getBoundingClientRect()
  const min = Number(input.min || 0)
  const max = Number(input.max || 100)
  return [rect.left + 8 + ((value - min) / (max - min)) * (rect.width - 16), rect.top + rect.height / 2]
}

/** Piecewise value over time: [time, value] keys, eased between them. */
const keyed = (keys: [number, number][], t: number) => {
  const next = keys.findIndex((key) => key[0] > t)
  if (next === -1) return keys.at(-1)![1]
  if (next === 0) return keys[0][1]
  const a = keys[next - 1]
  const b = keys[next]
  return a[1] + (b[1] - a[1]) * inOut((t - a[0]) / (b[0] - a[0]))
}

/** Toggle a `data-seen` entrance off (instantly) and back on, then off again to retract. */
const replayEntrance = (selector: string, on: number, off: number): [number, (ctx: Context) => void][] => [
  [
    0,
    (ctx) => {
      const element = ctx.$(selector)
      element.removeAttribute("data-seen")
      element.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
    },
  ],
  [on, (ctx) => ctx.$(selector).setAttribute("data-seen", "")],
  [off, (ctx) => ctx.$(selector).removeAttribute("data-seen")],
]

// ───────────── Hero ─────────────

const heroScript: Script = (frame, setCursor) => {
  const apply = (text: string) => {
    const input = frame.querySelector<HTMLTextAreaElement>("#font-typing-input")!
    input.value = text
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const steps = [
    typing(900, "opencode", "", apply, 55),
    typing(1500, "", "node done", apply, 115),
    typing(4300, "node done", "", apply, 50),
    typing(4900, "", "codeopen", apply, 120),
    typing(8300, "codeopen", "", apply, 45),
    typing(8700, "", "opencode", apply, 95),
  ]
  return timeline(frame, setCursor, {
    cursor: false,
    actions: [
      [
        500,
        (ctx) => {
          const input = ctx.$<HTMLTextAreaElement>("#font-typing-input")
          input.focus({ preventScroll: true })
          input.setSelectionRange(input.value.length, input.value.length)
          input.dispatchEvent(new Event("select", { bubbles: true }))
        },
      ],
      ...steps.flatMap((step) => step.actions),
      [9900, (ctx) => ctx.$("#font-typing-input").blur()],
    ],
  })
}

// ───────────── Plates ─────────────

const coverEnd = 1300 + 4200

const coverScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, {
    path: [
      [0, OFF_BOTTOM],
      [300, OFF_BOTTOM],
      [1100, { at: '[data-slot="cover-word"]', x: 0.55, y: 0.62 }],
      [1700, { at: '[data-slot="cover-word"]', x: 0.62, y: 0.95 }],
      [2600, OFF_BOTTOM],
    ],
    actions: [[1300, (ctx) => ctx.click()]],
  })

const constructionLoop = constructionPhases("d").at(-1)!.end + 1800 + 400

const constructionScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, {
    actions: [[0, (ctx) => ctx.click('[data-slot="construction-side"] [data-slot="letter-tabs"] button:nth-child(6)')]],
  })

const timelineScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, { actions: replayEntrance('[data-slot="gantt"]', 300, 6000) })

const exploded = (() => {
  const slider = '[data-slot="exploded-controls"] [data-slot="axis"] input'
  const tab = (index: number) => `[data-slot="exploded-controls"] [data-slot="letter-tabs"] button:nth-child(${index})`
  const rule = (index: number) => `[data-slot="exploded-controls"] [data-slot="toggles"] button:nth-child(${index})`
  // Cycles: e by row, d by order, o by radius; then back to e by row.
  const e: [number, number][] = [
    [0, 0],
    [300, 0],
    [1250, 1],
    [1650, 1],
    [2400, 0],
    [3250, 0],
    [4200, 1],
    [4600, 1],
    [5350, 0],
    [6200, 0],
    [7150, 1],
    [7550, 1],
    [8300, 0],
  ]
  // The controls are hidden on the canvas: the script sets them directly, so only the blocks move.
  const script: Script = (frame, setCursor) =>
    timeline(frame, setCursor, {
      tick: (t, ctx) => {
        const value = keyed(e, t).toFixed(2)
        if (ctx.$<HTMLInputElement>(slider).value !== value) ctx.input(slider, value)
      },
      actions: [
        [2700, (ctx) => ctx.click(tab(6))],
        [2750, (ctx) => ctx.click(rule(2))],
        [5650, (ctx) => ctx.click(tab(1))],
        [5700, (ctx) => ctx.click(rule(3))],
        [8600, (ctx) => ctx.click(tab(3))],
        [8650, (ctx) => ctx.click(rule(1))],
      ],
    })
  return script
})()

const passportsScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, {
    tick: (_, ctx) => {
      ctx.$$('[data-slot="passport"]').forEach((passport) => {
        const photo = passport.querySelector('[data-slot="passport-photo"]')!
        passport.toggleAttribute("data-share-active", !!ctx.hovered && photo.contains(ctx.hovered))
      })
    },
    path: [
      [0, OFF_BOTTOM],
      [400, OFF_BOTTOM],
      [1300, { at: '[data-slot="passport"]:nth-child(1) [data-slot="passport-photo"]', x: 0.6, y: 0.55 }],
      [3200, { at: '[data-slot="passport"]:nth-child(1) [data-slot="passport-photo"]', x: 0.5, y: 0.6 }],
      [3900, { at: '[data-slot="passport"]:nth-child(2) [data-slot="passport-photo"]', x: 0.6, y: 0.55 }],
      [5600, { at: '[data-slot="passport"]:nth-child(2) [data-slot="passport-photo"]', x: 0.5, y: 0.6 }],
      [6300, { at: '[data-slot="passport"]:nth-child(3) [data-slot="passport-photo"]', x: 0.6, y: 0.55 }],
      [8000, { at: '[data-slot="passport"]:nth-child(3) [data-slot="passport-photo"]', x: 0.5, y: 0.6 }],
      [8900, OFF_BOTTOM],
    ],
  })

const chartScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, { actions: replayEntrance('[data-slot="charts"]', 300, 4800) })

const kerningScript: Script = (frame, setCursor) => {
  const cell = (row: number, col: number) =>
    `[data-slot="kern-table"] [role="row"]:nth-child(${row + 2}) button:nth-of-type(${col + 1})`
  const tour: [number, number][] = [
    [0, 0],
    [1, 1],
    [2, 2],
    [2, 4],
    [3, 3],
    [4, 1],
    [5, 0],
    [5, 5],
    [1, 5],
    [0, 5],
  ]
  return timeline(frame, setCursor, {
    path: [
      [0, OFF_BOTTOM],
      [300, OFF_BOTTOM],
      ...tour.flatMap(([row, col], index) => [
        [900 + index * 560, cell(row, col)] as [number, Target],
        [1180 + index * 560, cell(row, col)] as [number, Target],
      ]),
      [
        900 + tour.length * 560 + 600,
        () => {
          const rect = frame.querySelector(cell(0, 5))!.getBoundingClientRect()
          return [window.innerWidth + 100, rect.top + rect.height / 2] as const
        },
      ],
    ],
  })
}

const performanceScript: Script = (frame, setCursor) => {
  const button = '[data-slot="benchmark"] button'
  return timeline(frame, setCursor, {
    path: [
      [0, OFF_BOTTOM],
      [500, OFF_BOTTOM],
      [1500, button],
      [5200, button],
      [6200, OFF_BOTTOM],
    ],
    actions: [
      [1800, (ctx) => ctx.click()],
      [3600, (ctx) => ctx.click()],
    ],
  })
}

/** A slow camera over `selector`: keys of [time, scale, originX, originY] in fractions of the frame. */
const camera =
  (selector: string, keys: [number, number, number, number][]): Script =>
  (frame, setCursor) =>
    timeline(frame, setCursor, {
      tick: (t, ctx) => {
        const element = ctx.$(selector)
        const at = (index: number) =>
          keyed(
            keys.map((key) => [key[0], key[index]] as [number, number]),
            t,
          )
        element.style.transformOrigin = `${at(2) * 100}% ${at(3) * 100}%`
        element.style.transform = `scale(${at(1).toFixed(4)})`
      },
    })

const posterScript = camera('[data-plate="poster"] [data-slot="poster"]', [
  [0, 1, 0.5, 0.5],
  [1200, 1, 0.5, 0.5],
  [3000, 1.9, 0.08, 0.12],
  [3800, 1.9, 0.08, 0.12],
  [5600, 1.9, 0.85, 0.98],
  [6400, 1.9, 0.85, 0.98],
  [8000, 1, 0.5, 0.5],
])

const waterfallScript: Script = (frame, setCursor) =>
  timeline(frame, setCursor, {
    tick: (t, ctx) => {
      const list = ctx.$('[data-slot="waterfall"]')
      const stage = ctx.$('[data-slot="share-stage"]')
      const travel = Math.max(0, list.offsetTop + list.scrollHeight - stage.clientHeight + 40)
      const k = keyed(
        [
          [0, 0],
          [1000, 0],
          [5600, 1],
          [6600, 1],
          [9400, 0],
        ],
        t,
      )
      const offset = Math.round(k * travel)
      list.style.transform = `translateY(${-offset}px)`
      list.style.clipPath = `inset(${offset}px -100vw 0 -100vw)`
    },
  })

const anagramsScript: Script = (frame, setCursor) => {
  // The controls are hidden on the canvas: Play, then back to opencode, pressed by the script.
  const button = (index: number) => `[data-slot="anagram-controls"] button:nth-of-type(${index})`
  return timeline(frame, setCursor, {
    actions: [
      [0, (ctx) => ctx.click(button(2))],
      [1300, (ctx) => ctx.click(button(1))],
      [5300, (ctx) => ctx.click(button(2))],
    ],
  })
}

const fieldScript: Script = (frame, setCursor) => {
  const canvas = () => frame.querySelector('[data-slot="field"] canvas')!.getBoundingClientRect()
  return timeline(frame, setCursor, {
    map: (x, y) => {
      const rect = canvas()
      return [rect.left + (x - rect.left) / 2, rect.top + (y - rect.top) / 2] as const
    },
    actions: [
      [2400, (ctx) => ctx.click()],
      [4600, (ctx) => ctx.click()],
    ],
    tick: (t, ctx) => {
      const rect = canvas()
      const p = Math.min(1, Math.max(0, (t - 300) / 6400))
      if (p <= 0 || p >= 1) {
        ctx.leave()
        return
      }
      // A slow figure across the field, entering left and leaving right.
      const x = -80 + p * (window.innerWidth + 160)
      const y = rect.top + rect.height * (0.5 + 0.34 * Math.sin(p * Math.PI * 3.2))
      ctx.move(x, y)
    },
  })
}

const loupeScript: Script = (frame, setCursor) => {
  // Stops in the word's own units (30 a letter, 42 tall): the o's counter, the p's descender, the
  // e's bar, the n's shoulder; then out above the gap after "open", where the loupe sees nothing.
  const stops: [number, number, number][] = [
    [0, -70, 21],
    [300, -70, 21],
    [1400, 12, 21],
    [2900, 33, 38],
    [4400, 70, 21],
    [5900, 104, 9],
    [7000, 118, 9],
    [7900, 118, -60],
  ]
  return timeline(frame, setCursor, {
    cursor: false,
    tick: (t, ctx) => {
      if (t <= 300 || t >= 7900) {
        ctx.leave()
        return
      }
      const svg = ctx.$('[data-slot="loupe-word"] svg').getBoundingClientRect()
      const unit = svg.height / 42
      const ux = keyed(
        stops.map((stop) => [stop[0], stop[1]] as [number, number]),
        t,
      )
      const uy = keyed(
        stops.map((stop) => [stop[0], stop[2]] as [number, number]),
        t,
      )
      ctx.move(svg.left + ux * unit, svg.top + uy * unit)
    },
  })
}

const tester = (() => {
  const field = '[data-slot="tester-field"] input'
  const size = '[data-slot="tester-controls"] [data-slot="axis"]:nth-of-type(2) input'
  const toggle = (index: number) => `[data-slot="tester-controls"] [data-slot="toggles"] button:nth-child(${index})`
  const initial = fontContent.tester.initial
  const script: Script = (frame, setCursor) => {
    const apply = (text: string) => {
      const input = frame.querySelector<HTMLInputElement>(field)!
      input.value = text
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const out = typing(1100, initial, "opencode", apply, 60)
    const back = typing(9600, "opencode", initial, apply, 55)
    let value = 10
    let ctx!: Context
    const knob: Target = () => thumb(ctx, size, value)
    // As large as the word fits the canvas: 39 columns of glyphs plus 4 of padding.
    const big = Math.min(32, Math.floor((window.innerWidth - 112) / 43))
    const sizes: [number, number][] = [
      [0, 10],
      [3200, 10],
      [4300, big],
      [8600, big],
      [9300, 10],
    ]
    return timeline(frame, setCursor, {
      tick: (t, context) => {
        ctx = context
        value = Math.round(keyed(sizes, t))
        if (context.$<HTMLInputElement>(size).value !== String(value)) context.input(size, value)
      },
      path: [
        [0, OFF_BOTTOM],
        [200, OFF_BOTTOM],
        [900, { at: field, x: 0.7 }],
        [2900, { at: field, x: 0.7 }],
        [3200, knob],
        [4300, knob],
        [4700, toggle(3)],
        [5000, toggle(3)],
        [5300, toggle(2)],
        [5600, toggle(2)],
        [6200, { at: '[data-slot="tester-preview"]', x: 0.2, y: 0.25 }],
        [7300, { at: '[data-slot="tester-preview"]', x: 0.75, y: 0.45 }],
        [7800, toggle(2)],
        [8200, toggle(3)],
        [8600, knob],
        [9300, knob],
        [9600, { at: field, x: 0.7 }],
        [back.end + 200, { at: field, x: 0.7 }],
        [back.end + 1100, OFF_BOTTOM],
      ],
      actions: [
        [1000, (context) => context.click()],
        ...out.actions,
        [4800, (context) => context.click()],
        [5400, (context) => context.click()],
        [7900, (context) => context.click()],
        [8300, (context) => context.click()],
        ...back.actions,
      ],
    })
  }
  return { script, duration: typing(9600, "opencode", initial, () => {}, 55).end + 1600 }
})()

const colophonScript: Script = (frame, setCursor) => {
  const button = '[data-slot="colophon-action"] [data-component="site-button"]'
  return timeline(frame, setCursor, {
    tick: (_, ctx) => {
      const element = ctx.$(button)
      element.toggleAttribute("data-share-hover", !!ctx.hovered && element.contains(ctx.hovered))
    },
    path: [
      [0, OFF_RIGHT],
      [1000, OFF_RIGHT],
      [2200, { at: button, x: 0.4, y: 0.55 }],
      [4200, { at: button, x: 0.45, y: 0.6 }],
      [5400, OFF_RIGHT],
    ],
  })
}

export const shares: Record<string, Share> = {
  hero: {
    component: Typewriter,
    tone: "paper",
    caption: "Type anything",
    duration: 10500,
    poster: 3200,
    script: heroScript,
  },
  cover: {
    component: Cover,
    tone: "paper",
    caption: "Pl. 01 — Specimen",
    duration: coverEnd + 1500,
    poster: coverEnd,
    script: coverScript,
  },
  construction: {
    component: Construction,
    tone: "ink",
    caption: "Pl. 02 — Construction",
    duration: constructionLoop,
    poster: constructionLoop - 2300,
    script: constructionScript,
  },
  timeline: {
    component: Gantt,
    tone: "paper",
    caption: "Pl. 03 — Timeline",
    duration: 9000,
    poster: 4200,
    script: timelineScript,
  },
  exploded: {
    component: Exploded,
    tone: "paper",
    caption: "Pl. 04 — Exploded view",
    duration: 9500,
    poster: 1450,
    script: exploded,
  },
  passports: {
    component: Passports,
    tone: "paper",
    caption: "Pl. 05 — Glyph passports",
    duration: 9500,
    poster: 2500,
    script: passportsScript,
  },
  modules: {
    component: Analysis,
    tone: "paper",
    caption: "Fig. 01 — Modules per glyph",
    duration: 7000,
    poster: 3500,
    script: chartScript,
  },
  scatter: {
    component: Analysis,
    tone: "paper",
    caption: "Fig. 03 — Ink against counter",
    duration: 7000,
    poster: 3500,
    script: chartScript,
  },
  heatmap: {
    component: Analysis,
    tone: "paper",
    caption: "Fig. 06 — Coverage heatmap",
    duration: 7000,
    poster: 3500,
    script: chartScript,
  },
  frequency: {
    component: Analysis,
    tone: "paper",
    caption: "Fig. 07 — Letter frequency",
    duration: 7000,
    poster: 3500,
    script: chartScript,
  },
  kerning: {
    component: Kerning,
    tone: "ink",
    caption: "Pl. 07 — Kerning",
    duration: 8500,
    poster: 2000,
    script: kerningScript,
  },
  performance: {
    component: Performance,
    tone: "paper",
    caption: "Pl. 08 — Performance",
    duration: 7000,
    poster: 6800,
    script: performanceScript,
  },
  poster: {
    component: Poster,
    tone: "blue",
    caption: "Pl. 09 — Poster",
    duration: 9000,
    poster: 0,
    script: posterScript,
  },
  waterfall: {
    component: Waterfall,
    tone: "paper",
    caption: "Pl. 10 — Waterfall",
    duration: 10000,
    poster: 0,
    script: waterfallScript,
  },
  anagrams: {
    component: Anagrams,
    tone: "ink",
    caption: "Pl. 11 — Anagrams",
    duration: 7500,
    poster: 0,
    script: anagramsScript,
  },
  field: {
    component: Field,
    tone: "paper",
    caption: "Pl. 12 — Field",
    duration: 9000,
    poster: 2700,
    script: fieldScript,
  },
  loupe: {
    component: Loupe,
    tone: "night",
    caption: "Pl. 13 — Loupe",
    duration: 8500,
    poster: 3000,
    script: loupeScript,
  },
  tester: {
    component: Tester,
    tone: "paper",
    caption: "Pl. 14 — Tester",
    duration: tester.duration,
    poster: 6800,
    script: tester.script,
  },
  colophon: {
    component: Colophon,
    tone: "ink",
    caption: "Pl. 15 — Colophon",
    duration: 6600,
    poster: 3000,
    script: colophonScript,
  },
}
