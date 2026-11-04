import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import fuzzysort from "fuzzysort"
import type { AlertOptions, ConfirmOptions, PromptOptions, SelectOptions } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup } from "@opencode/ui/dialog"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import "@/shell/commands/dialog.css"
import "@/shell/palette-menu.css"

// The dialogs behind `Dialogs.confirm`, `alert`, `prompt` and `select`. Each answers through `done`; the host closes
// the dialog and settles the plugin's promise.

/** `Dialogs.confirm`: the app's confirm dialog. A destructive action focuses Cancel, as the app's own do. */
export function PluginConfirmDialog(props: { options: ConfirmOptions; done: (confirmed: boolean) => void }) {
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.description} />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus={!!props.options.danger} onClick={() => props.done(false)}>
          {props.options.cancel ?? language.t("common.cancel")}
        </Button>
        <Button
          variant={props.options.danger ? "danger" : "contrast"}
          autofocus={!props.options.danger}
          onClick={() => props.done(true)}
        >
          {props.options.confirm ?? language.t("ui.common.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function PluginAlertDialog(props: { options: AlertOptions; done: () => void }) {
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.description} />
      </DialogHeader>
      <DialogFooter>
        <Button variant="contrast" autofocus onClick={() => props.done()}>
          {props.options.ok ?? language.t("common.ok")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** `Dialogs.prompt`: one text field. Submitting needs a value, so the dialog never answers with "". */
export function PluginPromptDialog(props: { options: PromptOptions; done: (value: string | undefined) => void }) {
  const language = useLanguage()
  const [store, setStore] = createStore({ value: props.options.value ?? "", selected: false })

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.description} />
      </DialogHeader>
      <form
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()

          if (store.value) props.done(store.value)
        }}
      >
        <DialogBody class="px-4">
          <TextInput
            type={props.options.secret ? "password" : "text"}
            appearance="large"
            class="!w-full self-stretch"
            value={store.value}
            placeholder={props.options.placeholder}
            aria-label={props.options.title}
            autofocus
            autocomplete="off"
            spellcheck={false}
            // The initial text is selected once, so typing replaces it.
            onFocus={(event) => {
              if (store.selected) return
              setStore("selected", true)
              event.currentTarget.select()
            }}
            onInput={(event) => setStore("value", event.currentTarget.value)}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.done(undefined)}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={!store.value}>
            {props.options.submit ?? language.t("common.submit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

/** `Dialogs.select`: a searchable list in the command palette's dialog. Rows are keyed by their index. */
export function PluginSelectDialog<T>(props: { options: SelectOptions<T>; done: (value: T | undefined) => void }) {
  const language = useLanguage()
  const [store, setStore] = createStore({ query: "" })

  const rows = createMemo(() =>
    props.options.options.map((option, index) => ({
      key: String(index),
      option,
      title: option.title,
      description: option.description ?? "",
    })),
  )

  const results = createMemo(() => {
    const query = store.query.trim()

    if (!query) return rows()

    return fuzzysort.go(query, rows(), { keys: ["title", "description"] }).map((result) => result.obj)
  })

  return (
    <Dialog class="command-palette command-palette-compact" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{props.options.title}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={store.query}
          onQuery={(query) => setStore("query", query)}
          placeholder={props.options.placeholder ?? language.t("common.search.placeholder")}
          label={props.options.title}
          items={results()}
          key={(row) => row.key}
          section={(row) => row.option.group ?? ""}
          header={(row) => row.option.group || undefined}
          empty={language.t("palette.empty")}
          ref={(handle) => {
            const current = rows().find((row) => row.option.value === props.options.current)

            if (current) handle.setActive(current.key)
          }}
          onSelect={(row) => props.done(row.option.value)}
          onClose={() => props.done(undefined)}
        >
          {(row, attrs) => (
            <button type="button" class="command-palette-row group" data-size="compact" {...attrs}>
              <div class="command-palette-row-main">
                <div class="command-palette-row-text">
                  <span class="command-palette-title palette-menu-title" dir="auto">
                    <SearchHighlight text={row().title} />
                  </span>
                  <Show when={row().description}>
                    {(description) => (
                      <span class="command-palette-description" dir="auto">
                        <SearchHighlight text={description()} />
                      </span>
                    )}
                  </Show>
                </div>
              </div>
            </button>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
