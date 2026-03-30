import { useIsRouting, useLocation } from "@solidjs/router"
import { batch, createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"

type Mem = Performance & {
  memory?: {
    usedJSHeapSize: number
    jsHeapSizeLimit: number
  }
}

type Evt = PerformanceEntry & {
  interactionId?: number
  processingStart?: number
}

type Shift = PerformanceEntry & {
  hadRecentInput: boolean
  value: number
}

type Obs = PerformanceObserverInit & {
  durationThreshold?: number
}

const span = 5000

const ms = (n?: number, d = 0) => {
  if (n === undefined || Number.isNaN(n)) return
  return `${n.toFixed(d)}ms`
}

const time = (n?: number) => {
  if (n === undefined || Number.isNaN(n)) return
  return `${Math.round(n)}`
}

const mb = (n?: number) => {
  if (n === undefined || Number.isNaN(n)) return
  const v = n / 1024 / 1024
  return `${v >= 1024 ? v.toFixed(0) : v.toFixed(1)}MB`
}

const bad = (n: number | undefined, limit: number, low = false) => {
  if (n === undefined || Number.isNaN(n)) return false
  return low ? n < limit : n > limit
}

const session = (path: string) => path.includes("/session")

function Cell(props: { bad?: boolean; dim?: boolean; label: string; tip: string; value: string; wide?: boolean }) {
  return (
    <Tooltip value={props.tip} placement="top">
      <div
        classList={{
          "flex min-h-[42px] w-full min-w-0 flex-col items-center justify-center rounded-[8px] px-0.5 py-1 text-center": true,
          "col-span-2": !!props.wide,
        }}
      >
        <div class="text-[10px] leading-none font-black uppercase tracking-[0.04em] opacity-70">{props.label}</div>
        <div
          classList={{
            "text-[13px] leading-none font-bold tabular-nums sm:text-[14px]": true,
            "text-text-on-critical-base": !!props.bad,
            "opacity-70": !!props.dim,
          }}
        >
          {props.value}
        </div>
      </div>
    </Tooltip>
  )
}

export function DebugBar() {
  const language = useLanguage()
  const location = useLocation()
  const routing = useIsRouting()
  const [state, setState] = createStore({
    cls: undefined as number | undefined,
    delay: undefined as number | undefined,
    fps: undefined as number | undefined,
    gap: undefined as number | undefined,
    heap: {
      limit: undefined as number | undefined,
      used: undefined as number | undefined,
    },
    inp: undefined as number | undefined,
    jank: undefined as number | undefined,
    long: {
      block: undefined as number | undefined,
      count: undefined as number | undefined,
      max: undefined as number | undefined,
    },
    nav: {
      dur: undefined as number | undefined,
      pending: false,
    },
  })

  const na = () => language.t("debugBar.na")
  const heap = () => (state.heap.limit ? (state.heap.used ?? 0) / state.heap.limit : undefined)
  const heapv = () => {
    const value = heap()
    if (value === undefined) return na()
    return `${Math.round(value * 100)}%`
  }
  const longv = () => (state.long.count === undefined ? na() : `${time(state.long.block) ?? na()}/${state.long.count}`)
  const navv = () => (state.nav.pending ? "..." : (time(state.nav.dur) ?? na()))

  let prev = ""
  let start = 0
  let init = false
  let one = 0
  let two = 0

  createEffect(() => {
    const busy = routing()
    const next = `${location.pathname}${location.search}`

    if (!init) {
      init = true
      prev = next
      return
    }

    if (busy) {
      if (one !== 0) cancelAnimationFrame(one)
      if (two !== 0) cancelAnimationFrame(two)
      one = 0
      two = 0
      if (start !== 0) return
      start = performance.now()
      if (session(prev)) setState("nav", { dur: undefined, pending: true })
      return
    }

    if (start === 0) {
      prev = next
      return
    }

    const at = start
    const from = prev
    start = 0
    prev = next

    if (!(session(from) || session(next))) return

    if (one !== 0) cancelAnimationFrame(one)
    if (two !== 0) cancelAnimationFrame(two)
    one = requestAnimationFrame(() => {
      one = 0
      two = requestAnimationFrame(() => {
        two = 0
        setState("nav", { dur: performance.now() - at, pending: false })
      })
    })
  })

  onMount(() => {
    const obs: PerformanceObserver[] = []
    const fps: Array<{ at: number; dur: number }> = []
    const long: Array<{ at: number; dur: number }> = []
    const seen = new Map<number | string, { at: number; delay: number; dur: number }>()
    let hasLong = false
    let poll: number | undefined
    let raf = 0
    let last = 0
    let snap = 0

    const trim = (list: Array<{ at: number; dur: number }>, span: number, at: number) => {
      while (list[0] && at - list[0].at > span) list.shift()
    }

    const syncFrame = (at: number) => {
      trim(fps, span, at)
      const total = fps.reduce((sum, entry) => sum + entry.dur, 0)
      const gap = fps.reduce((max, entry) => Math.max(max, entry.dur), 0)
      const jank = fps.filter((entry) => entry.dur > 32).length
      batch(() => {
        setState("fps", total > 0 ? (fps.length * 1000) / total : undefined)
        setState("gap", gap > 0 ? gap : undefined)
        setState("jank", jank)
      })
    }

    const syncLong = (at = performance.now()) => {
      if (!hasLong) return
      trim(long, span, at)
      const block = long.reduce((sum, entry) => sum + Math.max(0, entry.dur - 50), 0)
      const max = long.reduce((hi, entry) => Math.max(hi, entry.dur), 0)
      setState("long", { block, count: long.length, max })
    }

    const syncInp = (at = performance.now()) => {
      for (const [key, entry] of seen) {
        if (at - entry.at > span) seen.delete(key)
      }
      let delay = 0
      let inp = 0
      for (const entry of seen.values()) {
        delay = Math.max(delay, entry.delay)
        inp = Math.max(inp, entry.dur)
      }
      batch(() => {
        setState("delay", delay > 0 ? delay : undefined)
        setState("inp", inp > 0 ? inp : undefined)
      })
    }

    const syncHeap = () => {
      const mem = (performance as Mem).memory
      if (!mem) return
      setState("heap", { limit: mem.jsHeapSizeLimit, used: mem.usedJSHeapSize })
    }

    const reset = () => {
      fps.length = 0
      long.length = 0
      seen.clear()
      last = 0
      snap = 0
      batch(() => {
        setState("fps", undefined)
        setState("gap", undefined)
        setState("jank", undefined)
        setState("delay", undefined)
        setState("inp", undefined)
        if (hasLong) setState("long", { block: 0, count: 0, max: 0 })
      })
    }

    const watch = (type: string, init: Obs, fn: (entries: PerformanceEntry[]) => void) => {
      if (typeof PerformanceObserver === "undefined") return false
      if (!(PerformanceObserver.supportedEntryTypes ?? []).includes(type)) return false
      const ob = new PerformanceObserver((list) => fn(list.getEntries()))
      try {
        ob.observe(init)
        obs.push(ob)
        return true
      } catch {
        ob.disconnect()
        return false
      }
    }

    if (
      watch("layout-shift", { buffered: true, type: "layout-shift" }, (entries) => {
        const add = entries.reduce((sum, entry) => {
          const item = entry as Shift
          if (item.hadRecentInput) return sum
          return sum + item.value
        }, 0)
        if (add === 0) return
        setState("cls", (value) => (value ?? 0) + add)
      })
    ) {
      setState("cls", 0)
    }

    if (
      watch("longtask", { buffered: true, type: "longtask" }, (entries) => {
        const at = performance.now()
        long.push(...entries.map((entry) => ({ at: entry.startTime, dur: entry.duration })))
        syncLong(at)
      })
    ) {
      hasLong = true
      setState("long", { block: 0, count: 0, max: 0 })
    }

    watch("event", { buffered: true, durationThreshold: 16, type: "event" }, (entries) => {
      for (const raw of entries) {
        const entry = raw as Evt
        if (entry.duration < 16) continue
        const key =
          entry.interactionId && entry.interactionId > 0
            ? entry.interactionId
            : `${entry.name}:${Math.round(entry.startTime)}`
        const prev = seen.get(key)
        const delay = Math.max(0, (entry.processingStart ?? entry.startTime) - entry.startTime)
        seen.set(key, {
          at: entry.startTime,
          delay: Math.max(prev?.delay ?? 0, delay),
          dur: Math.max(prev?.dur ?? 0, entry.duration),
        })
        if (seen.size <= 200) continue
        const first = seen.keys().next().value
        if (first !== undefined) seen.delete(first)
      }
      syncInp()
    })

    const loop = (at: number) => {
      if (document.visibilityState !== "visible") {
        raf = 0
        return
      }

      if (last === 0) {
        last = at
        raf = requestAnimationFrame(loop)
        return
      }

      fps.push({ at, dur: at - last })
      last = at

      if (at - snap >= 250) {
        snap = at
        syncFrame(at)
      }

      raf = requestAnimationFrame(loop)
    }

    const stop = () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
      if (poll === undefined) return
      clearInterval(poll)
      poll = undefined
    }

    const start = () => {
      if (document.visibilityState !== "visible") return
      if (poll === undefined) {
        poll = window.setInterval(() => {
          syncLong()
          syncInp()
          syncHeap()
        }, 1000)
      }
      if (raf !== 0) return
      raf = requestAnimationFrame(loop)
    }

    const vis = () => {
      if (document.visibilityState !== "visible") {
        stop()
        return
      }
      reset()
      start()
    }

    syncHeap()
    start()
    document.addEventListener("visibilitychange", vis)

    onCleanup(() => {
      if (one !== 0) cancelAnimationFrame(one)
      if (two !== 0) cancelAnimationFrame(two)
      stop()
      document.removeEventListener("visibilitychange", vis)
      for (const ob of obs) ob.disconnect()
    })
  })

  return (
    <aside
      aria-label={language.t("debugBar.ariaLabel")}
      class="pointer-events-auto fixed bottom-3 right-3 z-50 w-[308px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border-base bg-surface-raised-stronger-non-alpha p-0.5 text-text-strong shadow-[var(--shadow-lg-border-base)] sm:bottom-4 sm:right-4 sm:w-[324px]"
    >
      <div class="grid grid-cols-5 gap-px font-mono">
        <Cell
          label={language.t("debugBar.nav.label")}
          tip={language.t("debugBar.nav.tip")}
          value={navv()}
          bad={bad(state.nav.dur, 400)}
          dim={state.nav.dur === undefined && !state.nav.pending}
        />
        <Cell
          label={language.t("debugBar.fps.label")}
          tip={language.t("debugBar.fps.tip")}
          value={state.fps === undefined ? na() : `${Math.round(state.fps)}`}
          bad={bad(state.fps, 50, true)}
          dim={state.fps === undefined}
        />
        <Cell
          label={language.t("debugBar.frame.label")}
          tip={language.t("debugBar.frame.tip")}
          value={time(state.gap) ?? na()}
          bad={bad(state.gap, 50)}
          dim={state.gap === undefined}
        />
        <Cell
          label={language.t("debugBar.jank.label")}
          tip={language.t("debugBar.jank.tip")}
          value={state.jank === undefined ? na() : `${state.jank}`}
          bad={bad(state.jank, 8)}
          dim={state.jank === undefined}
        />
        <Cell
          label={language.t("debugBar.long.label")}
          tip={language.t("debugBar.long.tip", { max: ms(state.long.max) ?? na() })}
          value={longv()}
          bad={bad(state.long.block, 200)}
          dim={state.long.count === undefined}
        />
        <Cell
          label={language.t("debugBar.delay.label")}
          tip={language.t("debugBar.delay.tip")}
          value={time(state.delay) ?? na()}
          bad={bad(state.delay, 100)}
          dim={state.delay === undefined}
        />
        <Cell
          label={language.t("debugBar.inp.label")}
          tip={language.t("debugBar.inp.tip")}
          value={time(state.inp) ?? na()}
          bad={bad(state.inp, 200)}
          dim={state.inp === undefined}
        />
        <Cell
          label={language.t("debugBar.cls.label")}
          tip={language.t("debugBar.cls.tip")}
          value={state.cls === undefined ? na() : state.cls.toFixed(2)}
          bad={bad(state.cls, 0.1)}
          dim={state.cls === undefined}
        />
        <Cell
          label={language.t("debugBar.mem.label")}
          tip={
            state.heap.used === undefined
              ? language.t("debugBar.mem.tipUnavailable")
              : language.t("debugBar.mem.tip", {
                  used: mb(state.heap.used) ?? na(),
                  limit: mb(state.heap.limit) ?? na(),
                })
          }
          value={heapv()}
          bad={bad(heap(), 0.8)}
          dim={state.heap.used === undefined}
          wide
        />
      </div>
    </aside>
  )
}
