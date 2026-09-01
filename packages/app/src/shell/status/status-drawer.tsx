import { lazy, Suspense } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { MobilePanelDrawer } from "../mobile-panel-drawer"
import "./status-drawer.css"

const Body = lazy(async () => {
  const { StatusPopoverBody } = await import("./body")
  return { default: StatusPopoverBody }
})

export function StatusDrawer(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: () => HTMLElement | undefined
}) {
  const language = useLanguage()

  return (
    <MobilePanelDrawer
      title={language.t("status.popover.trigger")}
      open={props.open}
      onOpenChange={props.onOpenChange}
      returnFocus={props.returnFocus}
    >
      <Suspense
        fallback={
          <div data-slot="mobile-status-loading" role="status">
            {language.t("common.loading")}
          </div>
        }
      >
        <Body shown={props.open} embedded />
      </Suspense>
    </MobilePanelDrawer>
  )
}
