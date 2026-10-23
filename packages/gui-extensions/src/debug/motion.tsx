import { onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"

// Where the panel was dragged to, as an offset from its bottom-right home; kept per device.
const key = "opencode.motion.panel"

// The Motion workspace, docked above the debug bar's right end until its header is dragged. knobs loads once it opens.
export default function Motion(props: { title: string; onClose: () => void }) {
  let container!: HTMLDivElement
  let unmount: (() => void) | undefined
  let disposed = false
  const offset = load()

  const place = () => (container.style.transform = `translate(${offset.x}px, ${offset.y}px)`)

  // Moves by at most what keeps the whole panel in the window, reading layout once rather than every frame.
  const bounds = () => {
    const rect = container.getBoundingClientRect()

    return {
      x: [offset.x - rect.left, offset.x + window.innerWidth - rect.right],
      y: [offset.y - rect.top, offset.y + window.innerHeight - rect.bottom],
    }
  }

  const clamp = (limits: ReturnType<typeof bounds>, x: number, y: number) => {
    offset.x = Math.min(Math.max(x, limits.x[0]), Math.max(limits.x[0], limits.x[1]))
    offset.y = Math.min(Math.max(y, limits.y[0]), Math.max(limits.y[0], limits.y[1]))
    place()
  }

  const settle = () => {
    clamp(bounds(), offset.x, offset.y)
    save(offset)
  }

  const grab = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return

    const header = event.target.closest<HTMLElement>(".knobs-panel > header")

    if (!header || event.target.closest("button, input, [role=tab]")) return
    event.preventDefault()
    const limits = bounds()
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y }
    header.setPointerCapture(event.pointerId)

    const move = (moved: PointerEvent) => clamp(limits, moved.clientX - start.x, moved.clientY - start.y)

    const drop = () => {
      header.removeEventListener("pointermove", move)
      header.removeEventListener("pointerup", drop)
      header.removeEventListener("pointercancel", drop)
      save(offset)
    }

    header.addEventListener("pointermove", move)
    header.addEventListener("pointerup", drop)
    header.addEventListener("pointercancel", drop)
  }

  onMount(() => {
    place()
    const observer = new ResizeObserver(settle)
    observer.observe(container)
    window.addEventListener("resize", settle)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", settle)
    })
  })

  onCleanup(() => {
    disposed = true
    unmount?.()
  })

  void import("@opencode/ui/motion-tuning-panel").then(({ mountMotionPanel }) => {
    if (!disposed) unmount = mountMotionPanel(container, { title: props.title, onClose: props.onClose })
  })

  return (
    <Portal>
      <div
        ref={container}
        class="pointer-events-auto fixed bottom-10 right-3 z-50 max-h-[calc(100vh-6rem)] w-[320px] overflow-auto p-0.5 [&_.knobs-panel>header]:cursor-grab [&_.knobs-panel>header]:touch-none"
        onPointerDown={grab}
      />
    </Portal>
  )
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}")

    return { x: Number(saved.x) || 0, y: Number(saved.y) || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function save(offset: { x: number; y: number }) {
  try {
    localStorage.setItem(key, JSON.stringify(offset))
  } catch {}
}
