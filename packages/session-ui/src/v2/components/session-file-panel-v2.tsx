import { Show, type JSX, type ParentProps } from "solid-js"
import "./session-review-v2.css"
import "./session-mobile-file-panel.css"

export function SessionFilePanelV2(props: {
  sidebar?: JSX.Element
  toolbar: boolean
  toolbarStart?: JSX.Element
  toolbarEnd?: JSX.Element
  children?: JSX.Element
}) {
  return (
    <div data-component="session-review-v2">
      <div data-slot="session-review-v2-body">
        {props.sidebar}
        <div data-slot="session-review-v2-preview">
          <Show when={props.toolbar}>
            <div data-slot="session-review-v2-toolbar">
              <div data-slot="session-review-v2-toolbar-group" class="session-review-v2-toolbar-group--start">
                {props.toolbarStart}
              </div>
              <Show when={props.toolbarEnd}>
                {(toolbar) => (
                  <div data-slot="session-review-v2-toolbar-group" class="session-review-v2-toolbar-group--segments">
                    {toolbar()}
                  </div>
                )}
              </Show>
            </div>
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}

export function SessionFilePanelV2Empty(props: ParentProps) {
  return <div data-slot="session-review-v2-empty">{props.children}</div>
}

export function SessionMobileFilePanel(props: ParentProps<{ browsing: boolean; header: JSX.Element }>) {
  return (
    <div data-slot="session-mobile-files" data-browsing={props.browsing} class="flex h-full min-h-0 flex-col">
      <div data-slot="session-mobile-files-header" class="relative flex h-10 shrink-0 items-center">
        {props.header}
      </div>
      <div class="min-h-0 flex-1">{props.children}</div>
    </div>
  )
}
