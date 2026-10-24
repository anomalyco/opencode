import { Component, createMemo, For, Show, onCleanup } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useData } from "@/runtime/server/current"
import { useComposerState } from "@/composer/persistence"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useFilteredList } from "@opencode/ui/hooks"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@opencode/util/encode"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServer } from "@/runtime/server/current"
import { sessionHref } from "@/shell/routes/session"
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
  const navigate = useNavigate()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const prompt = useComposerState()
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  let pending = false
  let active = true
  onCleanup(() => {
    active = false
  })

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

  const handleSelect = async (item: ForkableMessage | undefined) => {
    if (!item || pending) return

    const sessionID = params.id

    if (!sessionID) return
    const message = data.session.message.get(sessionID, item.id)

    if (message?.type !== "user") return
    const directory = location().directory
    pending = true

    try {
      const original = await serverSDK.attachments.hydrate(sessionID, message).catch(() => {
        showToast({ title: language.t("common.requestFailed") })
      })

      // Closing the dialog while originals load cancels the fork.
      if (!original || !active) return

      const restored = extractPromptFromMessage(original, {
        directory,
        attachmentName: language.t("common.attachment"),
        sessionTitle: (id) => data.session.get(id)?.title,
      })

      const context = extractPromptContext(original, { directory })
      const dir = base64Encode(directory)

      await serverSDK.api.session
        .fork({ sessionID, before: item.id })
        .then((forked) => {
          data.session.remember(forked)
          dialog.close()
          const target = prompt.capture({ dir, id: forked.id })
          target.set(restored)
          target.context.replace([...context.comments, ...context.files])
          navigate(sessionHref(server.key, forked.id))
        })
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          showToast({ title: language.t("common.requestFailed"), description: message })
        })
    } finally {
      pending = false
    }
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
