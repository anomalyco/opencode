import { useEffect, useRef, useState } from "react"
import { AnimatePresence, m, useReducedMotion } from "motion/react"

interface IdChipProps {
  readonly id: string
  readonly className?: string
}

export function IdChip({ id, className = "" }: IdChipProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const reducedMotion = useReducedMotion()
  const transition = { duration: reducedMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] as const }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <m.button
      type="button"
      className={`id-chip ${className}`.trim()}
      data-copied={copied ? "" : undefined}
      title={`Copy ${id}`}
      aria-label={`Copy identifier ${id}`}
      onClick={copy}
      whileTap={reducedMotion ? undefined : { scale: 0.97 }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {copied ? (
          <m.svg
            key="check"
            className="id-chip-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.65, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.65, rotate: 20 }}
            transition={transition}
          >
            <m.path
              d="m2 6.2 2.4 2.3L10 3"
              fill="none"
              stroke="currentColor"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={transition}
            />
          </m.svg>
        ) : (
          <m.svg
            key="copy"
            className="id-chip-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.65 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.65 }}
            transition={transition}
          >
            <path d="M4.5 3.5v-2h6v6h-2" fill="none" stroke="currentColor" />
            <rect x="1.5" y="4.5" width="6" height="6" fill="none" stroke="currentColor" />
          </m.svg>
        )}
      </AnimatePresence>
      <span className="id-chip-text">
        <span className="id-chip-measure" aria-hidden="true">{id}</span>
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={copied ? "copied" : "value"}
            className="id-chip-value"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
            transition={transition}
          >
            {copied ? "copied" : id}
          </m.span>
        </AnimatePresence>
      </span>
    </m.button>
  )
}
