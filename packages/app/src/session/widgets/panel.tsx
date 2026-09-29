import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useWidgetsQuery } from "@/runtime/server/widgets"

// The widget asset is served by the server as a raw file. Credentials travel as
// a query token because the frame does not carry app-managed auth headers.
function assetURL(input: { base: string; id: string; asset?: string; password?: string }) {
  const url = new URL(`/api/widget/file/${encodeURIComponent(input.id)}/${input.asset ?? ""}`, input.base)
  if (input.password) url.searchParams.set("auth_token", btoa(`opencode:${input.password}`))
  return url.toString()
}

export function SessionWidgetsPanel(): JSX.Element {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const [selected, setSelected] = createSignal<string | undefined>()

  const query = useWidgetsQuery({ key: "session-widgets" })

  const widgets = createMemo(() => (query.isPending || query.isError ? [] : (query.data?.data ?? [])))
  const active = createMemo(() => widgets().find((widget) => widget.id === selected()))

  // Keep the selection valid as the widget list changes.
  createEffect(() => {
    const list = widgets()
    const current = selected()
    if (current && list.some((widget) => widget.id === current)) return
    setSelected(list[0]?.id)
  })

  const src = createMemo(() => {
    const widget = active()
    if (!widget || widget.state.status === "failed") return undefined
    return assetURL({
      base: server.url,
      id: widget.id,
      password: server.server.http.password,
    })
  })

  const activeError = createMemo(() => {
    const state = active()?.state
    if (!state || state.status !== "failed") return undefined
    return state.error
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-widgets-panel">
      <Show
        when={widgets().length > 0}
        fallback={
          <WidgetsEmpty
            loading={query.isPending}
            error={query.isError}
            hint={location().directory ? `${location().directory}/.opencode/widgets` : undefined}
            canOpen={platform.platform === "desktop" && !!platform.openPath}
            onOpen={() => {
              const directory = location().directory
              if (directory) void platform.openPath?.(`${directory}/.opencode/widgets`)
            }}
          />
        }
      >
        <div class="shrink-0 flex items-center gap-1 overflow-x-auto px-3 pt-3 pb-2">
          <For each={widgets()}>
            {(widget) => (
              <button
                type="button"
                onClick={() => setSelected(widget.id)}
                class="rounded-md px-2 h-6 text-12-regular whitespace-nowrap transition-colors"
                classList={{
                  "bg-v2-background-bg-layer-03 text-v2-text-text-base": selected() === widget.id,
                  "text-v2-text-text-muted hover:bg-v2-background-bg-layer-02": selected() !== widget.id,
                }}
                title={widget.description ?? widget.source.path}
              >
                {widget.title}
              </button>
            )}
          </For>
        </div>
        <div class="min-h-0 flex-1 px-3 pb-3">
          <Show
            when={active()?.state.status !== "failed"}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <Icon name="circle-exclamation" class="text-v2-state-fg-danger" />
                <div class="text-13-regular text-v2-text-text-base">{active()?.title}</div>
                <div class="text-12-regular text-v2-state-fg-danger">{activeError()}</div>
              </div>
            }
          >
            <Show
              when={src()}
              fallback={
                <div class="flex h-full items-center justify-center text-12-regular text-v2-text-text-muted">
                  {language.t("session.widgets.loading")}
                </div>
              }
            >
              {(value) => (
                <iframe
                  src={value()}
                  title={active()?.title}
                  // Widgets are user-authored; sandbox them while still allowing
                  // scripts so they can render their own UI.
                  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                  class="size-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base"
                />
              )}
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function WidgetsEmpty(props: {
  loading: boolean
  error: boolean
  hint?: string
  canOpen: boolean
  onOpen: () => void
}): JSX.Element {
  const language = useLanguage()
  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon name="widget" class="text-v2-text-text-muted opacity-40" />
      <div class="text-13-regular text-v2-text-text-base">
        {props.loading
          ? language.t("common.loading")
          : props.error
            ? language.t("session.widgets.loadFailed")
            : language.t("session.widgets.empty.title")}
      </div>
      <Show when={!props.loading && !props.error}>
        <div class="max-w-72 text-12-regular text-v2-text-text-muted">
          {language.t("session.widgets.empty.description")}
        </div>
        <Show when={props.hint}>
          <code class="rounded bg-v2-background-bg-layer-03 px-2 py-1 text-12-regular text-v2-text-text-base">
            {props.hint}
          </code>
        </Show>
        <Show when={props.canOpen}>
          <button type="button" onClick={props.onOpen} class="text-12-regular text-v2-text-text-accent hover:underline">
            {language.t("session.widgets.openFolder")}
          </button>
        </Show>
      </Show>
    </div>
  )
}
