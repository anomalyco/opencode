import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

interface CaptureContextMenuProps {
  readonly identifier: string
  readonly deepLink: string
  readonly issueLink: string
  readonly children: ReactNode
}

export function CaptureContextMenu({ identifier, deepLink, issueLink, children }: CaptureContextMenuProps) {
  const [position, setPosition] = useState<{ readonly x: number; readonly y: number }>()
  const targetRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!position) return
    const close = () => setPosition(undefined)
    window.addEventListener("pointerdown", close)
    window.addEventListener("blur", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("blur", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [position])

  useEffect(() => {
    if (!position) return
    menuRef.current?.focus()
  }, [position])

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value)
    setPosition(undefined)
  }

  return (
    <span
      ref={targetRef}
      className="capture-context-target"
      onContextMenu={(event) => {
        event.preventDefault()
        setPosition({
          x: Number.isFinite(event.clientX) ? event.clientX : 8,
          y: Number.isFinite(event.clientY) ? event.clientY : 8,
        })
      }}
    >
      {children}
      {position
        ? createPortal(
            <div
              ref={menuRef}
              className="capture-context-menu"
              role="menu"
              tabIndex={-1}
              style={{
                left: Math.max(8, Math.min(position.x, window.innerWidth - 176)),
                top: Math.max(8, Math.min(position.y, window.innerHeight - 84)),
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPosition(undefined)
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={() => copy(identifier)}>
                Copy ID
              </button>
              <button type="button" role="menuitem" onClick={() => copy(deepLink)}>
                Copy deep link
              </button>
              <a role="menuitem" href={issueLink} target="_blank" rel="noreferrer">
                Report issue
              </a>
            </div>,
            targetRef.current?.closest("dialog") ?? document.body,
          )
        : undefined}
    </span>
  )
}
