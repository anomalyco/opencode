import { Dialog, DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { SearchList } from "@opencode/ui/search-list"
import { Switch } from "@opencode/ui/switch"
import { TruncatedText } from "@opencode/ui/truncated-text"
import fuzzysort from "fuzzysort"
import { createMemo, createSignal, Show } from "solid-js"
import type { NewSessionExtensionList } from "./list"
import "@/shell/commands/dialog.css"
import "@/shell/search-list.css"

type Copy = { title: string; placeholder: string; empty: string; searchEmpty: string }

/**
 * Opens a searchable list with a switch per entry. The MCPs and skills dialogs are this with their own copy; `copy` is
 * read when the dialog renders, so it follows the language.
 */
export function useNewSessionExtensionListDialog(input: {
  list: NewSessionExtensionList
  copy: () => Copy
  status?: boolean
  onDone: () => void
}) {
  const dialog = useDialog()

  return () =>
    void dialog.show(
      () => <NewSessionExtensionListDialog list={input.list} status={input.status} {...input.copy()} />,
      input.onDone,
    )
}

function NewSessionExtensionListDialog(props: Copy & { list: NewSessionExtensionList; status?: boolean }) {
  const [query, setQuery] = createSignal("")

  const results = createMemo(() => {
    const current = query().trim()

    if (!current) return props.list.items()

    return fuzzysort.go(current, props.list.items(), { keys: ["name"] }).map((result) => result.obj)
  })

  return (
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{props.title}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={props.placeholder}
          items={results()}
          key={(item) => item.id}
          empty={props.list.items().length > 0 ? props.searchEmpty : props.empty}
          onSelect={(item) => props.list.toggle(item.id, !props.list.enabled(item))}
        >
          {(item, row) => (
            <div {...row} data-option-key={item().id} data-size="compact">
              <span class="mcp-dialog-lead">
                <Show when={props.status}>
                  <span class="mcp-dialog-status" aria-hidden="true">
                    <span class="mcp-status-dot" data-status={item().status} />
                  </span>
                </Show>
                <TruncatedText text={item().name} class="mcp-dialog-name" />
              </span>
              <div class="mcp-trailing" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={props.list.enabled(item())}
                  disabled={props.list.pending(item().id)}
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
