import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

type AnimatableValue = number | readonly number[]
type AnimatableTarget = Record<string, AnimatableValue>
type Ease = (progress: number) => number

type SpringTransition = {
  type: "spring"
  visualDuration: number
  restDelta: number
  restSpeed: number
}

type TweenTransition = {
  type: "tween"
  duration: number
  ease: Ease
}

type Transition = SpringTransition | TweenTransition

type ValueState = {
  scalar: boolean
  value: number[]
  target: number[]
  velocity: number[]
  from: number[]
}

type AnimationTask = (now: number) => boolean

const tasks = new Set<AnimationTask>()
let timer: ReturnType<typeof setInterval> | undefined

const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress)

export function spring(options: { visualDuration: number; restDelta?: number; restSpeed?: number }): Transition {
  return {
    type: "spring",
    visualDuration: options.visualDuration,
    restDelta: options.restDelta ?? 0.002,
    restSpeed: options.restSpeed ?? 0.002,
  }
}

export function tween(options: { duration: number; ease?: Ease }): Transition {
  return {
    type: "tween",
    duration: options.duration,
    ease: options.ease ?? smoothstep,
  }
}

export function createAnimatable<T extends AnimatableTarget>(
  initial: T,
  options: {
    transition: Transition
    enabled?: Accessor<boolean>
  },
) {
  const enabled = options.enabled ?? (() => true)
  const state = new Map<string, ValueState>()
  const [value, setValue] = createSignal(clone(initial), { equals: false })
  let target = clone(initial)
  let started = performance.now()
  let previous = started

  rebuild(initial)

  const step: AnimationTask = (now) => {
    if (!enabled()) {
      jump(target)
      return false
    }

    const delta = Math.min(0.05, (now - previous) / 1_000)
    previous = now
    const moving = options.transition.type === "spring" ? advanceSpring(delta) : advanceTween(now)
    if (!moving) {
      jump(target)
      return false
    }
    setValue(() => read())
    return true
  }

  function animate(next: T) {
    if (sameTarget(next)) return
    target = clone(next)
    if (!enabled() || !sameShape(next)) return jump(next)

    started = performance.now()
    previous = started
    for (const [key, current] of state) {
      current.from = [...current.value]
      current.target = values(next[key]!)
    }
    if (settled()) return jump(next)
    schedule(step)
  }

  function jump(next: T) {
    target = clone(next)
    unschedule(step)
    rebuild(next)
    setValue(() => clone(next))
  }

  function stop() {
    unschedule(step)
  }

  function rebuild(next: T) {
    state.clear()
    for (const [key, nextValue] of Object.entries(next)) {
      const value = values(nextValue)
      state.set(key, {
        scalar: typeof nextValue === "number",
        value,
        target: [...value],
        velocity: value.map(() => 0),
        from: [...value],
      })
    }
    started = performance.now()
    previous = started
  }

  function sameShape(next: T) {
    const entries = Object.entries(next)
    if (entries.length !== state.size) return false
    return entries.every(([key, nextValue]) => {
      const current = state.get(key)
      if (!current || current.scalar !== (typeof nextValue === "number")) return false
      return current.value.length === values(nextValue).length
    })
  }

  function sameTarget(next: T) {
    if (!sameShape(next)) return false
    return Object.entries(next).every(([key, value]) =>
      values(value).every((part, index) => part === state.get(key)!.target[index]),
    )
  }

  function settled() {
    return [...state.values()].every(
      (current) =>
        current.value.every((value, index) => value === current.target[index]) &&
        current.velocity.every((velocity) => velocity === 0),
    )
  }

  function advanceSpring(delta: number) {
    const transition = options.transition
    if (transition.type !== "spring") return false
    const frequency = (2 * Math.PI) / (Math.max(0.001, transition.visualDuration) * 1.2)
    let moving = false

    for (const current of state.values()) {
      current.value.forEach((value, index) => {
        const target = current.target[index]!
        const velocity = current.velocity[index]!
        const offset = value - target
        const decay = Math.exp(-frequency * delta)
        const nextVelocity = velocity + frequency * offset
        current.value[index] = target + (offset + nextVelocity * delta) * decay
        current.velocity[index] = (velocity - frequency * nextVelocity * delta) * decay
        moving ||=
          Math.abs(current.value[index]! - target) > transition.restDelta ||
          Math.abs(current.velocity[index]!) > transition.restSpeed
      })
    }
    return moving
  }

  function advanceTween(now: number) {
    const transition = options.transition
    if (transition.type !== "tween") return false
    const progress = Math.min(1, (now - started) / 1_000 / Math.max(0.001, transition.duration))
    const eased = transition.ease(progress)
    for (const current of state.values())
      current.value.forEach((_, index) => {
        const from = current.from[index]!
        current.value[index] = from + (current.target[index]! - from) * eased
        current.velocity[index] = 0
      })
    return progress < 1
  }

  function read() {
    return Object.fromEntries(
      [...state].map(([key, current]) => [key, current.scalar ? current.value[0]! : [...current.value]]),
    ) as T
  }

  createEffect(() => {
    if (enabled()) return
    jump(target)
  })
  onCleanup(stop)

  return { value, animate, jump }
}

function values(value: AnimatableValue) {
  return typeof value === "number" ? [value] : [...value]
}

function clone<T extends AnimatableTarget>(target: T) {
  return Object.fromEntries(
    Object.entries(target).map(([key, value]) => [key, typeof value === "number" ? value : [...value]]),
  ) as T
}

function schedule(task: AnimationTask) {
  tasks.add(task)
  if (timer) return
  timer = setInterval(tick, 16)
}

function unschedule(task: AnimationTask) {
  tasks.delete(task)
  if (tasks.size > 0 || !timer) return
  clearInterval(timer)
  timer = undefined
}

function tick() {
  const now = performance.now()
  for (const task of tasks) if (!task(now)) tasks.delete(task)
  if (tasks.size > 0 || !timer) return
  clearInterval(timer)
  timer = undefined
}
