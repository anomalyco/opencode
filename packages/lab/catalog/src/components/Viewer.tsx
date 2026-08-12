import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { Facet, Filter, Screen, Taxonomy, TaxonomyGroup, Variant } from "../catalog"
import { facetValues, frameFor, label, taxonomyLabel } from "../catalog"
import { TerminalFrame } from "./TerminalFrame"
import { CaptureSetSwitcher } from "./CaptureSetSwitcher"
import { CaptureContextMenu } from "./CaptureContextMenu"
import { feedbackIssueUrl } from "../feedback"
import { CaptureActionsMenu } from "./CaptureActionsMenu"
import { annotationUrl, readAnnotationDraft, readAnnotations, type Annotation, type AnnotationDocument } from "../annotations"
import { AnnotationEditor } from "./AnnotationEditor"

interface ViewerProps {
  readonly screen: Screen
  readonly identifier: string
  readonly deepLink: string
  readonly variant: Variant
  readonly variants: ReadonlyArray<Variant>
  readonly screenTaxonomy: ReadonlyArray<TaxonomyGroup>
  readonly uiElementTaxonomy: ReadonlyArray<TaxonomyGroup>
  readonly position: number
  readonly total: number
  readonly active: boolean
  readonly onClose: () => void
  readonly onNavigate: (direction: 1 | -1) => void
  readonly onVariant: (direction: 1 | -1) => void
  readonly onVariantSelect: (id: string) => void
  readonly onFacet: (filter: Filter) => void
  readonly onTaxonomy: (taxonomy: Taxonomy, value: string) => void
}

const facetOrder: ReadonlyArray<Facet> = ["surface", "pattern", "feature", "state"]

export function Viewer({
  screen,
  identifier,
  deepLink,
  variant,
  variants,
  screenTaxonomy,
  uiElementTaxonomy,
  position,
  total,
  active,
  onClose,
  onNavigate,
  onVariant,
  onVariantSelect,
  onFacet,
  onTaxonomy,
}: ViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const frame = frameFor(screen, variant.id)
  if (!frame) throw new Error(`Capture ${screen.id} is unavailable in set ${variant.id}`)
  const issueLink = feedbackIssueUrl({ title: screen.title, identifier, deepLink, variant: variant.id })
  const storageKey = `catalog-annotations:${identifier}:${variant.id}`
  const [annotating, setAnnotating] = useState(() => window.location.hash.startsWith("#annotations="))
  const [annotations, setAnnotations] = useState<ReadonlyArray<Annotation>>(() => {
    const linked = readAnnotations(new URL(window.location.href), identifier, variant.id)
    if (linked.length > 0) return linked.filter((annotation) => annotation.row < frame.rows && annotation.column < frame.cols)
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return []
      return readAnnotationDraft(stored).filter(
        (annotation) => annotation.row < frame.rows && annotation.column < frame.cols,
      )
    } catch {
      return []
    }
  })
  const document: AnnotationDocument = { version: 1, identifier, variant: variant.id, annotations }
  const annotatedLink = annotationUrl(deepLink, document)
  const completeAnnotations = annotations.filter((annotation) => annotation.note.trim() !== "")
  const issueDocument = { ...document, annotations: completeAnnotations }
  const annotationIssueLink = feedbackIssueUrl({
    title: screen.title,
    identifier,
    deepLink: annotationUrl(deepLink, issueDocument),
    variant: variant.id,
    annotations: completeAnnotations,
    document: issueDocument,
  })

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(annotations))
    if (annotating) window.history.replaceState(null, "", annotations.length > 0 ? annotatedLink : deepLink)
  }, [annotatedLink, annotating, annotations, deepLink, storageKey])

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const editing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    if (editing && event.key !== "Escape") return
    if (event.key === "Escape") {
      event.preventDefault()
      if (annotating) {
        setAnnotating(false)
        return
      }
      onClose()
      return
    }
    if (event.key.toLowerCase() === "a" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      setAnnotating((value) => !value)
      return
    }
    if (annotating) return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      onNavigate(event.key === "ArrowLeft" ? -1 : 1)
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      onVariant(event.key === "ArrowUp" ? -1 : 1)
    }
  })

  useEffect(() => {
    if (!active) return
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [active])

  return (
    <dialog
      ref={dialogRef}
      className="viewer"
      aria-label={screen.title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="viewer-header">
        <button type="button" className="viewer-button" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
        <span className="viewer-position">
          <button
            type="button"
            className="viewer-button"
            onClick={() => onNavigate(-1)}
            aria-label="Previous flow step"
          >
            ←
          </button>
          {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}
          <button type="button" className="viewer-button" onClick={() => onNavigate(1)} aria-label="Next flow step">
            →
          </button>
        </span>
        <div className="viewer-actions">
          <button
            type="button"
            className={`viewer-button${annotating ? " active" : ""}`}
            onClick={() => setAnnotating((value) => !value)}
            title="Toggle annotation mode (A)"
          >
            Annotate
            {annotations.length > 0 ? <span className="viewer-button-count">{annotations.length}</span> : undefined}
          </button>
          <CaptureActionsMenu identifier={identifier} deepLink={deepLink} issueLink={issueLink} />
          <CaptureSetSwitcher sets={variants} active={variant} onSelect={onVariantSelect} />
        </div>
      </header>
      <div className="viewer-body">
        <div className="viewer-stage">
          <figure className="viewer-figure">
            <CaptureContextMenu identifier={identifier} deepLink={deepLink} issueLink={issueLink}>
              <div className="viewer-image-wrap">
                <TerminalFrame frame={frame} label={`${screen.title}, ${variant.label}`} />
                {annotating ? (
                  <AnnotationEditor
                    cols={frame.cols}
                    rows={frame.rows}
                    annotations={annotations}
                    onAdd={(row, column, note) => {
                      if (annotations.length >= 24) return
                      const annotation = { id: crypto.randomUUID(), row, column, note }
                      setAnnotations([...annotations, annotation])
                    }}
                    onChange={(id, note) =>
                      setAnnotations(annotations.map((annotation) => annotation.id === id ? { ...annotation, note } : annotation))
                    }
                    onDelete={(id) => setAnnotations(annotations.filter((annotation) => annotation.id !== id))}
                    onDone={() => {
                      setAnnotating(false)
                    }}
                    issueLink={annotationIssueLink}
                  />
                ) : undefined}
              </div>
            </CaptureContextMenu>
            <figcaption className="viewer-caption">
              <h3>{screen.title}</h3>
              <div className="viewer-label-groups">
                <section>
                  <h4>Screens</h4>
                  <div className="viewer-facets">
                    {screen.screenLabels.map((value) => (
                      <button key={value} type="button" onClick={() => onTaxonomy("screen", value)}>
                        {taxonomyLabel(screenTaxonomy, value)}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h4>UI Elements</h4>
                  <div className="viewer-facets">
                    {screen.uiElements.map((value) => (
                      <button key={value} type="button" onClick={() => onTaxonomy("ui-element", value)}>
                        {taxonomyLabel(uiElementTaxonomy, value)}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h4>Labels</h4>
                  <div className="viewer-facets">
                    {facetOrder.flatMap((facet) =>
                      facetValues(screen, facet).map((value) => (
                        <button key={`${facet}:${value}`} type="button" onClick={() => onFacet({ facet, value })}>
                          {label(value)}
                        </button>
                      )),
                    )}
                  </div>
                </section>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>
    </dialog>
  )
}
