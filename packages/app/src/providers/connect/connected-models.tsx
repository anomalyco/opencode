import { DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createSignal, Show } from "solid-js"
import { consoleProviderName } from "@/providers/catalog/console"
import { matchesModelSearch } from "@/providers/models/search"
import { useLanguage } from "@/runtime/i18n/language"
import { modelKey } from "./controller"
import { RemoteServerLabel } from "./remote"
import "@/shell/commands/dialog.css"
import "@/providers/models/select-dialog.css"

type ConnectionModel = { id: string; name: string; providerID: string }

type ConnectionGroup = { provider: { id: string; name: string }; models: ConnectionModel[] }

type Row = { id: string; model: ConnectionModel; provider: ConnectionGroup["provider"] }

/**
 * The model picker's search and rows, over only the models a new connection brought. It needs no composer: choosing a
 * model hands it back, and the connect dialog decides whether it goes to the caller's session or a new one.
 */
export function ConnectedModelPicker(props: {
  providerName: string
  /** The remote server a Console sign-in is stored on. */
  server?: string
  groups: ConnectionGroup[]
  /** A Console workspace's providers, whose section names drop the workspace prefix. */
  workspace?: { prefix: string }
  onSelect: (model: ConnectionModel) => void
}) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")

  const rows = createMemo(() => {
    const search = query().trim()

    return props.groups.flatMap((group) =>
      group.models.flatMap((model): Row[] =>
        !search || matchesModelSearch(search, [model.name, model.id, group.provider.name])
          ? [{ id: modelKey(model), model, provider: group.provider }]
          : [],
      ),
    )
  })

  const providerName = (provider: Row["provider"]) => {
    const workspace = props.workspace

    return workspace ? consoleProviderName(workspace, provider.name) : provider.name
  }

  return (
    <>
      <div class="sr-only">
        <DialogTitle>{language.t("provider.connect.models.title", { provider: props.providerName })}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          topFade={false}
          // Without the picker's check column, the search icon, section headers and names share one inset.
          class={[
            "[&_[data-slot=text-input-v2-leading-icon]]:ms-0.5 [&_[data-slot=search-list-row]]:!ps-2.5 [&_[data-slot=search-list-header]]:!ps-4",
            props.groups.length > 1 ? "" : "[&_[data-slot=search-list-results]]:!pt-1.5",
          ].join(" ")}
          query={query()}
          onQuery={setQuery}
          trailing={<Show when={props.server}>{(server) => <RemoteServerLabel server={server()} class="me-2" />}</Show>}
          placeholder={language.t("provider.connect.models.search", { provider: props.providerName })}
          label={language.t("provider.connect.models.list", { provider: props.providerName })}
          items={rows()}
          key={(row) => row.id}
          // One provider needs no header; a Console workspace or a multi-provider plan names each one.
          section={props.groups.length > 1 ? (row) => row.provider.id : undefined}
          header={
            props.groups.length > 1
              ? (row) => (
                  <span data-slot="model-dialog-header-label" class="flex min-w-0 items-center gap-1.5">
                    <span class="min-w-0 truncate">{providerName(row.provider)}</span>
                  </span>
                )
              : undefined
          }
          empty={language.t("dialog.model.empty")}
          onSelect={(row) => props.onSelect(row.model)}
        >
          {(row, attrs) => (
            <button type="button" {...attrs} data-option-key={row().id}>
              <span data-slot="model-dialog-name">
                <span class="min-w-0 truncate">
                  <SearchHighlight text={row().model.name} />
                </span>
              </span>
            </button>
          )}
        </SearchList>
      </DialogBody>
    </>
  )
}
