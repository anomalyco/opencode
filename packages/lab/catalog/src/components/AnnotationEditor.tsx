import { useEffect, useRef, useState } from "react"
import type { Annotation } from "../annotations"

interface AnnotationEditorProps {
  readonly cols: number
  readonly rows: number
  readonly annotations: ReadonlyArray<Annotation>
  readonly onAdd: (row: number, column: number, note: string) => void
  readonly onChange: (id: string, note: string) => void
  readonly onDelete: (id: string) => void
  readonly issueLink: string
  readonly onDone: () => void
}

interface Draft {
  readonly id?: string
  readonly row: number
  readonly column: number
  readonly note: string
}

export function AnnotationEditor(props: AnnotationEditorProps) {
  const [draft, setDraft] = useState<Draft>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const complete = props.annotations.filter((annotation) => annotation.note.trim() !== "")

  useEffect(() => {
    if (!draft) return
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(draft.note.length, draft.note.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [draft?.id, draft?.row, draft?.column])

  const save = () => {
    if (!draft?.note.trim()) return
    if (draft.id) props.onChange(draft.id, draft.note.trim())
    else props.onAdd(draft.row, draft.column, draft.note.trim())
    setDraft(undefined)
  }

  const edit = (annotation: Annotation) =>
    setDraft({ id: annotation.id, row: annotation.row, column: annotation.column, note: annotation.note })

  return (
    <>
      <div
        className="annotation-layer"
        aria-label="Click the terminal to add an annotation"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          const column = Math.min(
            props.cols - 1,
            Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * props.cols)),
          )
          const row = Math.min(
            props.rows - 1,
            Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * props.rows)),
          )
          setDraft({ row, column, note: "" })
        }}
      >
        {props.annotations.map((annotation, index) => (
          <button
            key={annotation.id}
            type="button"
            className={`annotation-pin${annotation.id === draft?.id ? " selected" : ""}`}
            style={{
              left: `${((annotation.column + 0.5) / props.cols) * 100}%`,
              top: `${((annotation.row + 0.5) / props.rows) * 100}%`,
            }}
            aria-label={`Edit annotation ${index + 1}, row ${annotation.row + 1}, column ${annotation.column + 1}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => edit(annotation)}
          >
            {index + 1}
          </button>
        ))}
        {draft ? (
          <div
            className={`annotation-composer${draft.row > props.rows / 2 ? " above" : ""}`}
            style={{
              left: `clamp(9rem, ${((draft.column + 0.5) / props.cols) * 100}%, calc(100% - 9rem))`,
              top: `${((draft.row + 0.5) / props.rows) * 100}%`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              <span>{draft.id ? "Edit annotation" : "New annotation"}</span>
              <small>
                R{draft.row + 1} · C{draft.column + 1}
              </small>
            </header>
            <textarea
              ref={textareaRef}
              name="annotation-note"
              aria-label="Annotation note"
              value={draft.note}
              maxLength={2_000}
              rows={2}
              placeholder="What should change?"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  save()
                }
                if (event.key === "Escape") {
                  setDraft(undefined)
                }
              }}
            />
            <footer>
              {draft.id ? (
                <button
                  type="button"
                  className="annotation-composer-delete"
                  onClick={() => {
                    if (draft.id) props.onDelete(draft.id)
                    setDraft(undefined)
                  }}
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
              <button type="button" className="annotation-composer-save" disabled={!draft.note.trim()} onClick={save}>
                {draft.id ? "Save" : "Add"}
              </button>
            </footer>
          </div>
        ) : undefined}
      </div>
      <aside className="annotation-panel" aria-label="Capture annotations">
        <header>
          <div>
            <strong>Annotations</strong>
            <span>
              {props.annotations.length === 0 ? "Click anywhere on the terminal" : `${props.annotations.length} placed`}
            </span>
          </div>
          <button type="button" onClick={props.onDone}>
            Done
          </button>
        </header>
        <div className="annotation-list">
          {props.annotations.map((annotation, index) => (
            <button key={annotation.id} type="button" className="annotation-list-row" onClick={() => edit(annotation)}>
              <span className="annotation-list-pin">{index + 1}</span>
              <span>
                <small>
                  Row {annotation.row + 1} · Column {annotation.column + 1}
                </small>
                <strong>{annotation.note}</strong>
              </span>
            </button>
          ))}
        </div>
        <footer>
          <a
            className="annotation-issue"
            href={complete.length === 0 ? undefined : props.issueLink}
            target="_blank"
            rel="noreferrer"
            aria-disabled={complete.length === 0}
          >
            Open GitHub issue
          </a>
          <span>
            {complete.length === 0
              ? "Add a note to continue"
              : `${complete.length} note${complete.length === 1 ? "" : "s"} will be included`}
          </span>
        </footer>
      </aside>
    </>
  )
}
