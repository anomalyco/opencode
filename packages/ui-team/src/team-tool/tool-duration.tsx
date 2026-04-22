import { Show, createMemo, createSignal, onCleanup } from "solid-js"

type ToolTime = {
  start?: number
  end?: number
}

export function ToolDuration(props: { time?: ToolTime; status?: string }) {
  const [now, setNow] = createSignal(Date.now())
  const active = createMemo(() => props.status === "running")

  createMemo(() => {
    if (!active()) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(id))
  })

  const ms = createMemo(() => {
    if (!props.time?.start) return
    const end = active() ? now() : props.time.end
    if (end == null) return
    return end - props.time.start
  })

  const label = createMemo(() => {
    const value = ms()
    if (value == null || value < 0) return
    const total = Math.round(value / 1000)
    if (total < 60) return `${total}s`
    const minute = Math.floor(total / 60)
    const second = total % 60
    return `${minute}m ${second}s`
  })

  return (
    <Show when={label()} keyed>
      {(text: string) => <span data-component="tool-duration">{text}</span>}
    </Show>
  )
}
