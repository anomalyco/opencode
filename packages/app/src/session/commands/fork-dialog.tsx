import { Component, createMemo, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useData } from "@/runtime/server/current"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useFilteredList } from "@opencode/ui/hooks"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionFork } from "@/session/fork"
import "@/shell/search-list.css"

interface ForkableMessage {
  id: string
  text: string
  time: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogFork: Component = () => {
  const params = useParams()
  const data = useData()
  const dialog = useDialog()
  const language = useLanguage()
  const fork = useSessionFork()

  const messages = createMemo((): ForkableMessage[] => {
    const sessionID = params.id

    if (!sessionID) return []

    const msgs = data.session.message.list(sessionID)
    const result: ForkableMessage[] = []

    for (const message of msgs) {
      if (message.type !== "user" || !message.text) continue

      result.push({
        id: message.id,
        text: message.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const handleSelect = (item: ForkableMessage | undefined) => {
    const sessionID = params.id

    if (!item || !sessionID) return

    void fork({ sessionID, messageID: item.id }).then((opened) => {
      if (opened) dialog.close()
    })
  }

  const list = useFilteredList({
    items: messages,
    key: (x) => x.id,
    filterKeys: ["text"],
    onSelect: handleSelect,
  })

  let resultsRef: HTMLDivElement | undefined

  const onKeyDown = (event: KeyboardEvent) => {
    // The pointer leaving the rows clears the highlight, so Enter then forks from the newest match.
    if (event.key === "Enter" && !event.isComposing && !list.active()) {
      event.preventDefault()
      handleSelect(list.flat()[0])

      return
    }

    list.onKeyDown(event)
    const active = list.active()

    if (!active) return
    resultsRef?.querySelector(`[data-option-key="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  return (
    <Dialog class="search-list-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("command.session.fork")}
          description={language.t("dialog.fork.description")}
        />
      </DialogHeader>
      <DialogBody class="search-list-body">
        <div class="search-list-search">
          <TextInput
            type="search"
            appearance="base"
            class="!w-full"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={language.t("common.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            autofocus
            aria-label={language.t("common.search.placeholder")}
            showClearButton={!!list.filter()}
            clearIcon="circle-xmark"
            clearLabel={language.t("common.clear")}
            onClearClick={() => list.clear()}
          />
        </div>
        <div class="search-list-scroll" data-scrollable ref={(el) => (resultsRef = el)}>
          <Show
            when={list.flat().length > 0}
            fallback={
              <div class="search-list-empty">
                {language.t(messages().length > 0 ? "dialog.fork.search.empty" : "dialog.fork.empty")}
              </div>
            }
          >
            <div role="listbox" class="search-list-results">
              <For each={list.flat()}>
                {(item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={list.active() === item.id}
                    data-option-key={item.id}
                    data-active={list.active() === item.id ? "" : undefined}
                    class="search-list-row"
                    onMouseMove={() => list.setActive(item.id)}
                    onMouseLeave={() => list.setActive("")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(item)}
                  >
                    <span class="search-list-row-text">
                      <span class="search-list-title" data-weight="regular">
                        {item.text}
                      </span>
                    </span>
                    <span class="search-list-trailing">{item.time}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
