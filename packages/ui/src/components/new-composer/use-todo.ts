import { createEffect, createMemo, createSignal, on } from "solid-js"
import { useElementHeight } from "@opencode-ai/ui/hooks"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import type { TodoItem } from "./types"

export const COLLAPSED_HEIGHT = 78

interface Props {
  todos: () => TodoItem[]
  show: () => boolean
  blocked: () => boolean
  collapsed?: () => boolean | undefined
  onCollapsed?: (value: boolean) => void
  shellHeight: () => number
  trayHeight: () => number
  trayOverlap: number
}

export function useTodo(props: Props) {
  const [collapsed, setCollapsedInner] = createSignal(props.collapsed?.() ?? false)
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>()

  createEffect(
    on(
      () => props.collapsed?.(),
      (next) => {
        if (next === undefined) return
        setCollapsedInner(next)
      },
      { defer: true },
    ),
  )

  const setCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(collapsed()) : value
    setCollapsedInner(next)
    props.onCollapsed?.(next)
  }

  const toggle = () => setCollapsed((prev) => !prev)

  const open = createMemo(() => props.todos().length > 0 && props.show() && !props.blocked())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const collapse = useSpring(() => (collapsed() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })

  const raw = useElementHeight(contentRef, 200)
  const full = useSpring(() => Math.max(COLLAPSED_HEIGHT, raw()), { visualDuration: 0.3, bounce: 0 })
  const visible = createMemo(() => {
    const max = full()
    const cut = max - collapse() * (max - COLLAPSED_HEIGHT)
    return cut * progress()
  })

  const overlap = createMemo(() => 36 * progress())
  const shut = createMemo(() => 1 - progress())
  const hide = createMemo(() => Math.max(collapse(), shut()))

  const bottom = createMemo(() => props.trayHeight() - props.trayOverlap + props.shellHeight() - overlap())
  const totalHeight = createMemo(
    () => visible() - overlap() + props.shellHeight() + props.trayHeight() - props.trayOverlap,
  )

  return {
    contentRef: setContentRef,
    collapsed,
    setCollapsed,
    toggle,
    progress,
    collapse,
    visible,
    shut,
    hide,
    bottom,
    totalHeight,
  }
}
