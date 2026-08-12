import { useEffect, useRef } from "react"

interface CaptureActionsMenuProps {
  readonly identifier: string
  readonly deepLink: string
  readonly issueLink: string
}

export function CaptureActionsMenu({ identifier, deepLink, issueLink }: CaptureActionsMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const details = detailsRef.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [])

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value)
    if (detailsRef.current) detailsRef.current.open = false
  }

  return (
    <details className="capture-actions" ref={detailsRef}>
      <summary aria-label="Capture actions">•••</summary>
      <div className="capture-actions-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => copy(identifier)}>Copy ID</button>
        <button type="button" role="menuitem" onClick={() => copy(deepLink)}>Copy link</button>
        <a role="menuitem" href={issueLink} target="_blank" rel="noreferrer">Report feedback</a>
      </div>
    </details>
  )
}
