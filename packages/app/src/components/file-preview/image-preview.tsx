import { createSignal, createEffect, Show } from "solid-js"
import type { ImagePreviewProps } from "./types"

/**
 * Image Preview component that displays images with zoom controls.
 * Supports zoom in/out and displays images with proper aspect ratio.
 */
export function ImagePreview(props: ImagePreviewProps) {
  const [scale, setScale] = createSignal(1)
  const [error, setError] = createSignal(false)

  // Reset error state when src changes
  createEffect(() => {
    props.src
    setError(false)
  })

  const handleLoad = () => {
    // Image loaded successfully
  }

  const handleZoomIn = () => {
    setScale((s) => Math.min(s + 0.25, 3))
  }

  const handleZoomOut = () => {
    setScale((s) => Math.max(s - 0.25, 0.25))
  }

  const handleReset = () => {
    setScale(1)
  }

  const handleError = () => {
    setError(true)
  }

  return (
    <div
      data-component="image-preview"
      class={`${props.class ?? ""} flex flex-col h-full min-h-0`}
    >
      {/* Zoom controls */}
      <div data-slot="image-controls">
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom out"
          disabled={scale() <= 0.25}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8z" />
          </svg>
        </button>
        <span data-slot="zoom-level">{Math.round(scale() * 100)}%</span>
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom in"
          disabled={scale() >= 3}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3a.5.5 0 0 1 .5.5v4h4a.5.5 0 0 1 0 1h-4v4a.5.5 0 0 1-1 0v-4h-4a.5.5 0 0 1 0-1h4v-4A.5.5 0 0 1 8 3z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleReset}
          title="Reset zoom"
          class="reset-btn"
        >
          Reset
        </button>
      </div>

      {/* Image container - uses grid for reliable centering and sizing */}
      <div
        data-slot="image-container"
        style={{
          "flex": "1",
          "display": "grid",
          "place-items": "center",
          "overflow": "auto",
          "padding": "1rem",
          "min-height": "300px",
        }}
      >
        <Show
          when={!error()}
          fallback={
            <div data-slot="image-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21,15 16,10 5,21" />
              </svg>
              <span>Failed to load image</span>
            </div>
          }
        >
          <img
            src={props.src}
            alt={props.alt ?? "Preview"}
            style={{
              "max-width": "min(100%, 500px)",
              "max-height": "calc(100vh - 200px)",
              width: "auto",
              height: "auto",
              "object-fit": "contain",
              transform: `scale(${scale()})`,
              "transform-origin": "center center",
              "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.15)",
            }}
            onLoad={handleLoad}
            onError={handleError}
          />
        </Show>
      </div>
    </div>
  )
}
