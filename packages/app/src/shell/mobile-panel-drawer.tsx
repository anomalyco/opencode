import type { ParentProps } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { MobileDrawer, MobileDrawerClose, MobileDrawerContent, MobileDrawerLabel } from "./mobile-drawer"
import "./mobile-panel-drawer.css"

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
    <MobileDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      returnFocus={props.returnFocus}
      // Menu focus handoff must not dismiss the drawer during its opening transition.
      closeOnOutsideFocus={false}
    >
      <MobileDrawerContent>
        <div data-slot="mobile-panel" data-corvu-no-drag>
          <div data-slot="mobile-panel-header">
            <MobileDrawerLabel>{props.title}</MobileDrawerLabel>
            <MobileDrawerClose
              as={Button}
              variant="ghost"
              data-slot="mobile-panel-close"
              aria-label={language.t("common.close")}
            >
              {language.t("common.close")}
            </MobileDrawerClose>
          </div>
          <div data-slot="mobile-panel-content">{props.children}</div>
        </div>
      </MobileDrawerContent>
    </MobileDrawer>
  )
}
