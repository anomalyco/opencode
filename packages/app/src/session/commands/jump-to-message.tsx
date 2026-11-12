import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogTitle, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { SearchHighlight, SearchList, type SearchListHandle } from "@opencode/ui/search-list"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { getRelativeTime } from "@/shell/time"
import "@/shell/commands/dialog.css"
import "@/shell/palette-menu.css"
import "@/shell/search-list.css"

export type JumpPrompt = { id: string; text: string; created: number }

export function JumpToMessage(props: {
  prompts: JumpPrompt[]
  initialQuery?: string
  status?: string
  opening?: boolean
  onJump: (prompt: JumpPrompt) => void
  onRetry?: () => void
  onClose: () => void
}) {
  const language = useLanguage()

  const [query, setQuery] = createSignal(props.initialQuery ?? "")

  const timestamp = createMemo(
    () =>
      new Intl.DateTimeFormat(language.intl(), {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
  )

  const prompts = createMemo(() =>
    props.prompts
      .toSorted((a, b) => b.created - a.created)
      .map((prompt) => ({
        prompt,
        text: prompt.text.replace(/\s+/g, " ").trim(),
      })),
  )

  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase()

    return prompts().flatMap(({ prompt, text }) => {
      const match = text.toLowerCase().indexOf(needle)

      if (match < 0) return []
      const prefix = Math.max(0, match - 16)

      const space = text.indexOf(" ", prefix)

      const start = prefix && space >= prefix && space < match ? space + 1 : prefix

      const end = Math.min(text.length, Math.max(start + 90, match + needle.length + 16))

      return [
        {
          prompt,
          snippet: (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
        },
      ]
    })
  })

  let list!: SearchListHandle<ReturnType<typeof rows>[number]>

  return (
    <Dialog class="command-palette command-palette-compact fork-dialog" fit>
      <div class="sr-only">
        <DialogTitle>{language.t("dialog.jump.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={language.t("common.search.placeholder")}
          label={language.t("dialog.jump.title")}
          ref={(handle) => (list = handle)}
          field={(field) => (
            <>
              <div class="palette-menu-search" data-slot="search-list-search">
                <TextInput
                  {...field}
                  type="search"
                  appearance="base"
                  class="!w-full"
                  leadingIcon={<Icon name="magnifying-glass" />}
                  value={query()}
                  readOnly={props.opening}
                  placeholder={language.t("common.search.placeholder")}
                  aria-label={language.t("dialog.jump.title")}
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                  autofocus
                  showClearButton={!props.opening && !!query()}
                  clearIcon="circle-xmark"
                  clearLabel={language.t("common.clear")}
                  onClearClick={() => {
                    list.setActive(undefined)
                    setQuery("")
                  }}
                />
              </div>
              <div class="fork-dialog-section flex items-center justify-between gap-2">
                <DialogTitleGroup
                  description={rows().length && props.status ? props.status : language.t("dialog.jump.description")}
                />
                <Show when={props.onRetry}>
                  {(retry) => (
                    <Button class="shrink-0" size="small" variant="neutral" onClick={retry()}>
                      {language.t("common.retry")}
                    </Button>
                  )}
                </Show>
              </div>
            </>
          )}
          items={rows()}
          key={(row) => row.prompt.id}
          empty={props.status ?? language.t(prompts().length ? "dialog.jump.noMatches" : "dialog.jump.empty")}
          onSelect={(row) => props.onJump(row.prompt)}
          onClose={props.onClose}
        >
          {(item, row) => (
            <button type="button" disabled={props.opening} tabIndex={-1} class="search-list-row" {...row}>
              <span class="search-list-row-text">
                <span class="search-list-title" data-weight="regular" dir="auto">
                  <SearchHighlight text={item().snippet} />
                </span>
              </span>
              <Tooltip class="shrink-0" placement="top" value={timestamp().format(item().prompt.created)}>
                <time dir="auto" class="search-list-trailing" dateTime={new Date(item().prompt.created).toISOString()}>
                  {getRelativeTime(new Date(item().prompt.created).toISOString(), language.t, language.intl())}
                </time>
              </Tooltip>
            </button>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
