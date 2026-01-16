import { Show, createSignal } from "solid-js"
import type { PdfPreviewProps } from "./types"

/**
 * PDF Preview component that displays PDFs using the browser's native PDF viewer.
 */
export function PdfPreview(props: PdfPreviewProps) {
  const [error, setError] = createSignal(false)

  // Create data URL for the PDF
  const pdfDataUrl = () => `data:application/pdf;base64,${props.content}`

  const handleError = () => {
    setError(true)
  }

  return (
    <div
      data-component="pdf-preview"
      class={props.class ?? ""}
    >
      <Show
        when={!error()}
        fallback={
          <div data-slot="pdf-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="12" y1="9" x2="12.01" y2="9" />
            </svg>
            <span>Unable to preview PDF</span>
            <p>Your browser may not support inline PDF viewing, or the file may be corrupted.</p>
          </div>
        }
      >
        <object
          data={pdfDataUrl()}
          type="application/pdf"
          onError={handleError}
        >
          {/* Fallback for browsers that don't support object tag */}
          <iframe
            src={pdfDataUrl()}
            title="PDF Preview"
            onError={handleError}
          />
        </object>
      </Show>
    </div>
  )
}
