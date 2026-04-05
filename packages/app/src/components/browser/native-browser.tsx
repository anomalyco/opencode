import { createEffect, onCleanup, onMount, createSignal } from "solid-js"
import { usePlatform } from "@/context/platform"

type Props = {
  url: string
  label: string
}

export function NativeBrowser(props: Props) {
  const platform = usePlatform()
  let anchorRef: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let isMounted = false

  const [dimensions, setDimensions] = createSignal({ x: 0, y: 0, w: 0, h: 0 })

  const getPosition = () => {
    if (!anchorRef) return null
    const rect = anchorRef.getBoundingClientRect()
    return {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    }
  }

  const createBrowser = async (url: string) => {
    const pos = getPosition()
    if (!pos) return
    try {
      await platform.createBrowser?.({
        label: props.label,
        url,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
      })
    } catch (err) {
      console.error("Failed to create browser:", err)
    }
  }

  const closeBrowser = async () => {
    await platform.closeBrowser?.(props.label)
  }

  const resizeBrowser = async () => {
    const pos = getPosition()
    if (!pos) return
    const d = dimensions()
    if (pos.x === d.x && pos.y === d.y && pos.w === d.w && pos.h === d.h) return
    setDimensions(pos)
    await platform.resizeBrowser?.({
      label: props.label,
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
    })
  }

  onMount(() => {
    if (!anchorRef) return

    resizeObserver = new ResizeObserver(() => {
      void resizeBrowser()
    })
    resizeObserver.observe(anchorRef)

    void createBrowser(props.url)
    isMounted = true

    onCleanup(() => {
      resizeObserver?.disconnect()
      void closeBrowser()
    })
  })

  createEffect(() => {
    if (!isMounted || !props.url) return
    void platform.navigateBrowser?.(props.label, props.url)
  })

  return <div ref={anchorRef} class="size-full" />
}
