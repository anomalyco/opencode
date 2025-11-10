import { createSignal, onCleanup, splitProps } from "solid-js"
import type { JSX } from "solid-js/jsx-runtime"
import { IconCheckCircle, IconHashtag } from "../icons"

interface AnchorProps extends JSX.HTMLAttributes<HTMLDivElement> {
  id: string
}
export function AnchorIcon(props: AnchorProps) {
  const [local, rest] = splitProps(props, ["id", "children"])
  const [copied, setCopied] = createSignal(false)

  return (
    <div {...rest} data-element-anchor title="Link to this message" data-status={copied() ? "copied" : ""}>
      <a
        href={`#${local.id}`}
        onClick={(e) => {
          e.preventDefault()

          const anchor = e.currentTarget
          const hash = anchor.getAttribute("href") || ""
          const { origin, pathname, search } = window.location

          navigator.clipboard
            .writeText(`${origin}${pathname}${search}${hash}`)
            .catch((err) => console.error("Copy failed", err))

          setCopied(true)
          setTimeout(() => setCopied(false), 3000)
        }}
      >
        {local.children}
        <IconHashtag width={18} height={18} />
        <IconCheckCircle width={18} height={18} />
      </a>
      <span data-element-tooltip>Copied!</span>
    </div>
  )
}

export function createOverflow() {
  const [overflow, setOverflow] = createSignal(false)
  return {
    get status() {
      return overflow()
    },
    ref(el: HTMLElement) {
      const ro = new ResizeObserver(() => {
        if (el.scrollHeight > el.clientHeight + 1) {
          setOverflow(true)
        }
        return
      })
      ro.observe(el)

      onCleanup(() => {
        ro.disconnect()
      })
    },
  }
}

export function formatDuration(ms: number): string {
  const ONE_SECOND = 1000
  const ONE_MINUTE = 60 * ONE_SECOND

  if (ms >= ONE_MINUTE) {
    const minutes = Math.floor(ms / ONE_MINUTE)
    return minutes === 1 ? `1min` : `${minutes}mins`
  }

  if (ms >= ONE_SECOND) {
    const seconds = Math.floor(ms / ONE_SECOND)
    return `${seconds}s`
  }

  return `${ms}ms`
}
