import { useI18n } from "@opencode/ui/context/i18n"
import { Menu } from "@opencode/ui/menu"
import { useLocale } from "@kobalte/core/i18n"
import { Show, type JSX, type ParentProps } from "solid-js"
import "./session-review-v2.css"

/** The edge of the panel the sidebar sits on: the inline start or end. */
export type SessionFilePanelV2SidebarSide = "start" | "end"

export function SessionFilePanelV2(props: {
  sidebar?: JSX.Element
  sidebarToggle?: JSX.Element
  sidebarToggleGap?: 2 | 10
  sidebarCollapsed?: boolean
  /** Defaults to `start`. */
  sidebarSide?: SessionFilePanelV2SidebarSide
  /** Offers "Sidebar position" on right-click of the sidebar and its toggle. */
  onSidebarSideChange?: (side: SessionFilePanelV2SidebarSide) => void
  toolbar: boolean
  toolbarStart?: JSX.Element
  toolbarEnd?: JSX.Element
  children?: JSX.Element
}) {
  const side = () => props.sidebarSide ?? "start"

  return (
    <div
      data-component="session-review-v2"
      data-sidebar-toggle={props.sidebarToggle ? "" : undefined}
      data-sidebar-toggle-gap={props.sidebarToggleGap}
      data-sidebar-collapsed={props.sidebarCollapsed ? "" : undefined}
      data-sidebar-side={side()}
    >
      <div data-slot="session-review-v2-sidebar-toggle">
        <SessionFilePanelV2SideMenu side={side()} onChange={props.onSidebarSideChange} keyboard>
          {props.sidebarToggle}
        </SessionFilePanelV2SideMenu>
      </div>
      <div data-slot="session-review-v2-body">
        <SessionFilePanelV2SideMenu side={side()} onChange={props.onSidebarSideChange}>
          {props.sidebar}
        </SessionFilePanelV2SideMenu>
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

function SessionFilePanelV2SideMenu(
  props: ParentProps<{
    side: SessionFilePanelV2SidebarSide
    onChange?: (side: SessionFilePanelV2SidebarSide) => void
    keyboard?: boolean
  }>,
) {
  const i18n = useI18n()
  const locale = useLocale()
  const rtl = () => locale.direction() === "rtl"
  const physical = () => ((props.side === "end") !== rtl() ? "right" : "left")
  const logical = (value: string): SessionFilePanelV2SidebarSide => ((value === "right") !== rtl() ? "end" : "start")

  return (
    <Show when={props.onChange} fallback={props.children}>
      {(onChange) => (
        <Menu.Context modal={false}>
          <Menu.Context.Trigger
            as="div"
            data-slot="session-review-v2-side-menu-trigger"
            on:contextmenu={{
              capture: true,
              handleEvent(event: MouseEvent) {
                const element = event.target

                // Text fields keep the system menu with Cut, Copy and Paste.
                if (element instanceof HTMLElement && element.closest("input, textarea, [contenteditable]")) {
                  event.stopPropagation()
                }
              },
            }}
            onKeyDown={(event) => {
              if (!props.keyboard) return

              if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return

              if (event.key !== "F10" || !event.shiftKey) return

              const target = event.target

              if (!(target instanceof HTMLElement)) return
              event.preventDefault()

              const bounds = target.getBoundingClientRect()

              target.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: rtl() ? bounds.right : bounds.left,
                  clientY: bounds.bottom,
                }),
              )
            }}
          >
            {props.children}
          </Menu.Context.Trigger>
          <Menu.Context.Portal>
            <Menu.Context.Content>
              <Menu.Sub gutter={4} overflowPadding={24}>
                <Menu.SubTrigger>{i18n.t("ui.sessionReviewV2.sidebarPosition")}</Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent>
                    <Menu.RadioGroup value={physical()} onChange={(value) => onChange()(logical(value))}>
                      <Menu.RadioItem value="left" closeOnSelect>
                        {i18n.t("ui.sessionReviewV2.sidebarPosition.left")}
                      </Menu.RadioItem>
                      <Menu.RadioItem value="right" closeOnSelect>
                        {i18n.t("ui.sessionReviewV2.sidebarPosition.right")}
                      </Menu.RadioItem>
                    </Menu.RadioGroup>
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            </Menu.Context.Content>
          </Menu.Context.Portal>
        </Menu.Context>
      )}
    </Show>
  )
}

export function SessionFilePanelV2Empty(props: ParentProps) {
  return <div data-slot="session-review-v2-empty">{props.children}</div>
}
