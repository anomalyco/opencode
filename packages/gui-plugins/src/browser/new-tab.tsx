import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { createUniqueId, For, onCleanup, onMount, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { ADDRESS_SUGGESTIONS, type AddressPage } from "./address-machine"
import { AddressField, BrowserNavigation, PageRow, type AddressControls } from "./address-field"
import { bare } from "./history/page"
import type definition from "./index"
import type { Model } from "./model"

// The New tab page has no tab: its field shows a blank page, and what the person enters opens in a new tab.
const BLANK: AddressPage = { tabID: undefined, url: "", loading: false, generation: 0, error: undefined }

/** The browser bar across the top of the side panel's New tab page, as a blank browser tab draws it. */
export function NewTabBar(props: {
  model: Model
  open: (url: string) => void
  /** Hands the New tab view the field that takes the keyboard when the person opens the New tab. */
  autofocus: (control: { focus(): void }) => () => void
}) {
  const plugin = usePlugin<typeof definition>()
  let field: AddressControls | undefined

  onMount(() => {
    if (field) onCleanup(props.autofocus(field))
  })

  return (
    <div
      data-component="browser-bar"
      class="h-11 shrink-0 flex items-center gap-2 px-3 border-b-[0.5px] border-v2-border-border-muted"
    >
      <BrowserNavigation back={false} forward={false} loading={false} reloadable={false} go={() => {}} reload={() => {}} />
      <AddressField
        model={props.model}
        page={() => BLANK}
        icon={() => undefined}
        failed={() => false}
        disabled={() => false}
        navigate={(url) => props.open(url)}
        controls={(controls) => {
          field = controls
        }}
      />
      {/* The element picker and the page's options act on a page, and there is none yet. */}
      <div class="flex shrink-0 items-center gap-1">
        <IconButton
          variant="ghost-muted"
          size="large"
          disabled
          aria-label={plugin.t("inspect")}
          icon={<Icon name="select-element" />}
        />
        <IconButton
          variant="ghost-muted"
          size="large"
          disabled
          aria-label={plugin.t("options")}
          icon={<Icon name="outline-dots" />}
        />
      </div>
    </div>
  )
}

/** The pages the browser showed last, on the side panel's New tab page. */
export function NewTabRecent(props: { model: Model; open: (url: string) => void }) {
  const plugin = usePlugin<typeof definition>()
  const heading = createUniqueId()
  const recent = () => props.model.visits().slice(0, ADDRESS_SUGGESTIONS)

  return (
    <Show when={recent().length > 0}>
      <section class="flex flex-col gap-1 pt-6" aria-labelledby={heading}>
        <h2 id={heading} class="px-2 pb-1 text-[13px] font-[440] text-v2-text-text-muted">
          {plugin.t("home.recent")}
        </h2>
        <For each={recent()}>
          {(visit) => (
            <PageRow icon={visit.icon} title={visit.title} detail={bare(visit.url)} onClick={() => props.open(visit.url)} />
          )}
        </For>
      </section>
    </Show>
  )
}
