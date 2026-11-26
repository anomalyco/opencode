import { Badge } from "@opencode/ui/badge"
import { DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createSignal, Show } from "solid-js"
import { consoleProviderName } from "@/providers/catalog/console"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { matchesModelSearch } from "@/providers/models/search"
import { useLanguage } from "@/runtime/i18n/language"
import { modelKey, type createProviderDialogController } from "./controller"
import "@/shell/commands/dialog.css"
import "@/providers/models/select-dialog.css"

type Controller = ReturnType<typeof createProviderDialogController>
type ConnectionGroup = ReturnType<Controller["connectionGroups"]>[number]
type ConnectionModel = ConnectionGroup["models"][number]
type Row = { id: string; model: ConnectionModel; provider: ConnectionGroup["provider"] }

/**
 * The model picker's search and rows, over only the models a new connection brought. It needs no composer: choosing a
 * model hands it back, and the connect dialog decides whether it goes to the caller's session or a new one.
 */
export function ConnectedModelPicker(props: {
  provider: { id: string; name: string }
  groups: ConnectionGroup[]
  /** A Console workspace's providers, whose names drop the workspace in favor of a badge. */
  workspace?: { prefix: string; workspace: string }
  selected?: string
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
        <DialogTitle>{language.t("provider.connect.models.title", { provider: props.provider.name })}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          topFade={false}
          class={props.groups.length > 1 ? undefined : "[&_[data-slot=search-list-results]]:!pt-1.5"}
          query={query()}
          onQuery={setQuery}
          placeholder={language.t("dialog.model.search.placeholder")}
          label={language.t("provider.connect.models.list", { provider: props.provider.name })}
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
              <span data-slot="model-dialog-check">
                <Show when={props.selected === row().id}>
                  <Icon name="check" />
                </Show>
              </span>
              <span data-slot="model-dialog-name">
                <span class="min-w-0 truncate">
                  <SearchHighlight text={row().model.name} />
                </span>
              </span>
            </button>
          )}
        </SearchList>
        <div class="h-px bg-v2-border-border-muted" />
        <div class="flex min-h-10 items-center gap-2 px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
          <ProviderModelIcon provider={props.provider} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {language.t("provider.connect.models.title", { provider: props.provider.name })}
          </span>
          <Show when={props.workspace}>{(group) => <Badge class="shrink-0">{group().workspace}</Badge>}</Show>
        </div>
      </DialogBody>
    </>
  )
}
