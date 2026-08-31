import Drawer from "@corvu/drawer"
import type { ParentProps } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import "./status/status-drawer.css"

export function MobilePanelDrawer(
  props: ParentProps<{
    title: string
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocus?: () => HTMLElement | undefined
  }>,
) {
  const language = useLanguage()
  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      side="bottom"
      finalFocusEl={props.returnFocus?.()}
      // Menu focus handoff must not dismiss the drawer during its opening transition.
      closeOnOutsideFocus={false}
    >
      {/* Preserve Corvu's content and dismissal lifecycle across reopenings. */}
      <Drawer.Portal forceMount>
        <Drawer.Overlay data-slot="mobile-status-overlay" />
        <Drawer.Content forceMount data-slot="mobile-status-drawer" dir={language.direction()}>
          <div data-slot="mobile-status-drag-handle" aria-hidden="true">
            <span />
          </div>
          <div data-slot="mobile-status-header" data-corvu-no-drag>
            <Drawer.Label>{props.title}</Drawer.Label>
            <Drawer.Close data-slot="mobile-status-close" aria-label={language.t("common.close")}>
              {language.t("common.close")}
            </Drawer.Close>
          </div>
          <div data-slot="mobile-status-content" data-corvu-no-drag>
            {props.children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}
