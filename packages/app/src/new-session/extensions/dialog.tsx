import { Dialog, DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { SearchList } from "@opencode/ui/search-list"
import { Switch } from "@opencode/ui/switch"
import { TruncatedText } from "@opencode/ui/truncated-text"
import fuzzysort from "fuzzysort"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { NewSessionExtensionList } from "./controller"
import "@/shell/commands/dialog.css"
import "@/shell/search-list.css"

type Kind = "mcp" | "skill"

/** Opens the dialog that chooses which MCP servers, or which skills, the draft's session starts with. */
export function useNewSessionExtensionsDialog(input: {
  mcps: NewSessionExtensionList
  skills: NewSessionExtensionList
  onDone: () => void
}) {
  const dialog = useDialog()

  return (kind: Kind) =>
    void dialog.show(
      () => <NewSessionExtensionsDialog kind={kind} list={kind === "mcp" ? input.mcps : input.skills} />,
      input.onDone,
    )
}

function NewSessionExtensionsDialog(props: { kind: Kind; list: NewSessionExtensionList }) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const mcp = props.kind === "mcp"

  const results = createMemo(() => {
    const current = query().trim()

    if (!current) return props.list.items()

    return fuzzysort.go(current, props.list.items(), { keys: ["name"] }).map((result) => result.obj)
  })

  return (
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{language.t(mcp ? "dialog.mcp.title" : "settings.extensions.tab.skills")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={language.t(mcp ? "dialog.mcp.search.placeholder" : "session.new.skills.search.placeholder")}
          items={results()}
          key={(item) => item.id}
          empty={language.t(
            props.list.items().length > 0
              ? mcp
                ? "dialog.mcp.search.empty"
                : "session.new.skills.search.empty"
              : mcp
                ? "dialog.mcp.empty"
                : "session.new.skills.empty",
          )}
          onSelect={(item) => props.list.toggle(item.id, !props.list.enabled(item))}
        >
          {(item, row) => (
            <div {...row} data-option-key={item().id} data-size="compact">
              <span class="mcp-dialog-lead">
                <Show when={mcp}>
                  <span class="mcp-dialog-status" aria-hidden="true">
                    <span class="mcp-status-dot" data-status={item().status} />
                  </span>
                </Show>
                <TruncatedText text={item().name} class="mcp-dialog-name" />
              </span>
              <div class="mcp-trailing" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={props.list.enabled(item())}
                  disabled={props.list.pending()}
                  onChange={(enabled) => props.list.toggle(item().id, enabled)}
                >
                  <span class="sr-only">{item().name}</span>
                </Switch>
              </div>
            </div>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
