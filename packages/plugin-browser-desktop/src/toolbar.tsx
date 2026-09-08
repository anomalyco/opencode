import type { Context } from "@opencode/plugin/desktop"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { InlineForm, Text, Toolbar } from "@opencode/ui/layout"
import { createEffect, For, Show } from "solid-js"
import { createStore } from "solid-js/store"

export function BrowserToolbar(props: {
  context: Context
  tab: Browser.Tab
  error?: string
  command(action: Browser.Action): void
}) {
  const [state, setState] = createStore({ address: "", editing: false })
  createEffect(() => {
    if (!state.editing) setState("address", props.tab.url)
  })
  return (
    <>
      <Toolbar>
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <IconButton
              variant="ghost"
              size="large"
              disabled={!props.tab[direction === "back" ? "canGoBack" : "canGoForward"]}
              aria-label={props.context.i18n.t(direction === "back" ? "common.goBack" : "common.goForward")}
              onClick={() => props.command({ type: direction, tabID: props.tab.id })}
              icon={<Icon name={direction === "back" ? "chevron-left" : "chevron-right"} size="small" />}
            />
          )}
        </For>
        <IconButton
          variant="ghost"
          size="large"
          aria-label={props.context.i18n.t(props.tab.loading ? "prompt.action.stop" : "error.page.action.reload")}
          onClick={() => props.command({ type: props.tab.loading ? "stop" : "reload", tabID: props.tab.id })}
          icon={
            <Show when={props.tab.loading} fallback={<Icon name="reset" size="small" />}>
              <Loader />
            </Show>
          }
        />
        <InlineForm
          onSubmit={() => {
            if (state.address.trim()) props.command({ type: "navigate", tabID: props.tab.id, url: state.address })
          }}
        >
          <TextInput
            value={state.address}
            placeholder={props.context.i18n.t("session.browser.address.placeholder")}
            aria-label={props.context.i18n.t("session.browser.address")}
            onFocus={() => setState("editing", true)}
            onBlur={() => setState({ editing: false, address: props.tab.url })}
            onInput={(event) => setState("address", event.currentTarget.value)}
          />
        </InlineForm>
      </Toolbar>
      <Show when={props.error}>
        <Text tone="error">{props.error}</Text>
      </Show>
    </>
  )
}
