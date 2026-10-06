import { createEffect, on, Show, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { DrawerContext } from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { MobileDrawer, MobileDrawerClose, MobileDrawerContent, MobileDrawerLabel } from "./mobile-drawer"
import "./mobile-panel-drawer.css"

type DrawerView = { title: string; content: JSX.Element; trigger: HTMLElement }

export function MobilePanelDrawer(
  props: ParentProps<{
    title: string
    hideHeader?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    onContentPresentChange?: (present: boolean) => void
    initialFocus?: () => HTMLElement | undefined
    returnFocus?: () => HTMLElement | undefined
    onFinalFocus?: (event: Event) => void
  }>,
) {
  const language = useLanguage()
  const [store, setStore] = createStore<{ view?: DrawerView }>({})
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) setStore("view", undefined)
      },
    ),
  )

  const navigation = {
    close: () => props.onOpenChange(false),
    open: (view: DrawerView) => setStore("view", view),
    back: () => {
      const trigger = store.view?.trigger
      setStore("view", undefined)
      trigger?.focus()
    },
  }

  return (
    <DrawerContext.Provider value={navigation}>
      <MobileDrawer
        open={props.open}
        onOpenChange={props.onOpenChange}
        onContentPresentChange={props.onContentPresentChange}
        initialFocus={props.initialFocus}
        returnFocus={props.returnFocus}
        onFinalFocus={props.onFinalFocus}
        // Menu focus handoff must not dismiss the drawer during its opening transition.
        closeOnOutsideFocus={false}
      >
        <MobileDrawerContent>
          <div data-slot="mobile-panel" data-corvu-no-drag>
            <Show
              when={!props.hideHeader}
              fallback={<MobileDrawerLabel class="sr-only">{store.view?.title ?? props.title}</MobileDrawerLabel>}
            >
              <div data-slot="mobile-panel-header">
                <MobileDrawerLabel>{store.view?.title ?? props.title}</MobileDrawerLabel>
                <MobileDrawerClose
                  as={Button}
                  variant="ghost"
                  data-slot="mobile-panel-close"
                  aria-label={language.t("common.close")}
                >
                  {language.t("common.close")}
                </MobileDrawerClose>
              </div>
            </Show>
            <div data-slot="mobile-panel-content">
              <div hidden={!!store.view}>{props.children}</div>
              <Show when={store.view}>
                {(view) => (
                  <>
                    <Button
                      variant="ghost"
                      icon="arrow-left"
                      class="mb-2 !justify-start"
                      aria-label={language.t("common.goBack")}
                      onClick={navigation.back}
                    >
                      {props.title}
                    </Button>
                    {view().content}
                  </>
                )}
              </Show>
            </div>
          </div>
        </MobileDrawerContent>
      </MobileDrawer>
    </DrawerContext.Provider>
  )
}
