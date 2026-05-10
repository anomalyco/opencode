/** @jsxImportSource solid-js */
import { Icon } from "@opencode-ai/ui/icon"
import { createEffect } from "solid-js"

type BrowserPanelToolbarProps = {
  canGoBack: boolean
  canGoForward: boolean
  count: number
  countRef?: (element: HTMLDivElement) => void
  draftUrl: string
  inspectDisabled: boolean
  inspectMode: boolean
  inspectButtonRef?: (element: HTMLButtonElement) => void
  isLoading: boolean
  open: boolean
  onBack: () => void
  onClose: () => void
  onDraftUrlChange: (value: string) => void
  onForward: () => void
  onInspect: () => void
  onNavigate: () => void
  onOpen: () => void
  onReload: () => void
  onScreenshot: () => void
  screenshotCaptured: boolean
  screenshotButtonRef?: (element: HTMLButtonElement) => void
}

export function BrowserPanelToolbar(props: BrowserPanelToolbarProps) {
  let screenshotButton: HTMLButtonElement | undefined
  let inspectButton: HTMLButtonElement | undefined

  createEffect(() => {
    screenshotButton?.setAttribute("aria-label", props.screenshotCaptured ? "Screenshot captured" : "Take screenshot")
    screenshotButton?.setAttribute("title", props.screenshotCaptured ? "Screenshot captured" : "Take screenshot")
    screenshotButton?.classList.toggle("browser-panel-button-captured", props.screenshotCaptured)
    inspectButton?.setAttribute("aria-pressed", props.inspectMode ? "true" : "false")
  })

  return (
    <div class="browser-panel-toolbar">
      <div class="browser-panel-toolbar-group">
        <button
          type="button"
          class="browser-panel-button"
          onClick={props.onBack}
          disabled={!props.open || !props.canGoBack}
          aria-label="Go back"
          title="Go back"
        >
          <Icon size="small" name="arrow-left" />
        </button>
        <button
          type="button"
          class="browser-panel-button"
          onClick={props.onForward}
          disabled={!props.open || !props.canGoForward}
          aria-label="Go forward"
          title="Go forward"
        >
          <Icon size="small" name="arrow-right" />
        </button>
        <button
          type="button"
          class="browser-panel-button"
          onClick={props.onReload}
          disabled={!props.open || props.isLoading}
          aria-label={props.isLoading ? "Page loading" : "Reload page"}
          title={props.isLoading ? "Page loading" : "Reload page"}
        >
          <Icon size="small" name="reset" />
        </button>
      </div>

      <div class="browser-panel-toolbar-address">
        <input
          aria-label="Browser URL"
          class="browser-panel-input"
          type="url"
          name="browser-url"
          autocomplete="off"
          value={props.draftUrl}
          placeholder="Enter a URL…"
          onInput={(event) => props.onDraftUrlChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            props.onNavigate()
          }}
        />
        <button
          type="button"
          class="browser-panel-button browser-panel-button-primary"
          onClick={props.onOpen}
          aria-label="Navigate to URL"
          title="Navigate to URL"
        >
          <Icon size="small" name="enter" />
        </button>
      </div>

      <div class="browser-panel-toolbar-group browser-panel-toolbar-group-end">
        <button
          type="button"
          class={`browser-panel-button${props.screenshotCaptured ? " browser-panel-button-captured" : ""}`}
          ref={(element) => {
            screenshotButton = element
            props.screenshotButtonRef?.(element)
          }}
          onClick={props.onScreenshot}
          disabled={!props.open}
          aria-label={props.screenshotCaptured ? "Screenshot captured" : "Take screenshot"}
          title={props.screenshotCaptured ? "Screenshot captured" : "Take screenshot"}
        >
          <Icon size="small" name="photo" />
        </button>
        <button
          type="button"
          class={`browser-panel-button${props.inspectMode ? " browser-panel-button-active" : ""}`}
          ref={(element) => {
            inspectButton = element
            props.inspectButtonRef?.(element)
          }}
          onClick={props.onInspect}
          disabled={!props.open || props.inspectDisabled}
          aria-pressed={props.inspectMode}
          aria-label="Annotate page"
          title="Annotate page"
        >
          <Icon size="small" name="window-cursor" />
        </button>
        <button
          type="button"
          class="browser-panel-button"
          disabled
          aria-label="More browser actions"
          title="More browser actions unavailable"
        >
          <Icon size="small" name="dot-grid" />
        </button>
        {props.isLoading ? (
          <div class="browser-panel-status" role="status" aria-live="polite">
            Page loading
          </div>
        ) : null}
        <div ref={props.countRef} class="browser-panel-count" aria-live="polite">
          {props.count === 0 ? "No annotations" : props.count === 1 ? "1 annotation" : `${props.count} annotations`}
        </div>
        <button
          type="button"
          class="browser-panel-button"
          onClick={props.onClose}
          disabled={!props.open}
          aria-label="Close browser panel"
          title="Close browser panel"
        >
          <Icon size="small" name="close" />
        </button>
      </div>
    </div>
  )
}
