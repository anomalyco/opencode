import Drawer from "@corvu/drawer"
import type { ParentProps } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import "./mobile-drawer.css"

export function MobileDrawer(
  props: ParentProps<{
    open: boolean
    onOpenChange: (open: boolean) => void
    onContentPresentChange?: (present: boolean) => void
    returnFocus?: () => HTMLElement | undefined
    closeOnOutsideFocus?: boolean
  }>,
) {
  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      onContentPresentChange={props.onContentPresentChange}
      side="bottom"
      finalFocusEl={props.returnFocus?.()}
      closeOnOutsideFocus={props.closeOnOutsideFocus}
    >
      {props.children}
    </Drawer>
  )
}

export const MobileDrawerTrigger = Drawer.Trigger

export function MobileDrawerContent(props: ParentProps) {
  const language = useLanguage()
  return (
    <Drawer.Portal forceMount>
      <Drawer.Overlay data-slot="mobile-drawer-overlay" />
      <Drawer.Content forceMount data-slot="mobile-drawer-content" dir={language.direction()}>
        <div data-slot="mobile-drawer-handle" aria-hidden="true">
          <span />
        </div>
        {props.children}
      </Drawer.Content>
    </Drawer.Portal>
  )
}

export const MobileDrawerLabel = Drawer.Label
export const MobileDrawerClose = Drawer.Close
