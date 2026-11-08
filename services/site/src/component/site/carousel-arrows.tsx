import "./carousel-arrows.css"

/**
 * Previous and next buttons for a carousel (the changelog's media, the product cards): 24px targets
 * with 12px chevrons in the muted text colour. An end the carousel has reached is aria-disabled, so
 * the button keeps focus there; the chevrons point the way the page reads.
 */
export function CarouselArrows(props: {
  previous: string
  next: string
  onPrevious: () => void
  onNext: () => void
  atStart?: boolean
  atEnd?: boolean
  controls?: string
  "data-slot"?: string
}) {
  return (
    <span data-component="carousel-arrows" data-slot={props["data-slot"]}>
      <button
        type="button"
        aria-label={props.previous}
        data-tip={props.previous}
        aria-controls={props.controls}
        aria-disabled={props.atStart ? "true" : undefined}
        onClick={() => !props.atStart && props.onPrevious()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={props.next}
        data-tip={props.next}
        aria-controls={props.controls}
        aria-disabled={props.atEnd ? "true" : undefined}
        onClick={() => !props.atEnd && props.onNext()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" />
        </svg>
      </button>
    </span>
  )
}
