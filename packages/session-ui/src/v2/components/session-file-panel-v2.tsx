import { Show, type JSX, type ParentProps } from "solid-js"
import "./session-review-v2.css"

export function SessionFilePanelV2(props: {
  sidebar?: JSX.Element
  sidebarToggle?: JSX.Element
  sidebarToggleGap?: 2 | 10
  sidebarCollapsed?: boolean
  toolbar: boolean
  toolbarStart?: JSX.Element
  toolbarEnd?: JSX.Element
  children?: JSX.Element
}) {
  return (
    <div
      data-component="session-review-v2"
      data-sidebar-toggle={props.sidebarToggle ? "" : undefined}
      data-sidebar-toggle-gap={props.sidebarToggleGap}
      data-sidebar-collapsed={props.sidebarCollapsed ? "" : undefined}
    >
      <div data-slot="session-review-v2-sidebar-toggle">{props.sidebarToggle}</div>
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
